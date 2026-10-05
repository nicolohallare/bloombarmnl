// POST /api/book
// Takes a booking request with a brow photo, holds the slot, and emails the
// client and Izza. Every rule the browser enforces is re-checked here — the
// page is only a UI.
//
// What happens next is a conversation: Izza messages the client on the chat
// app they picked, talks the brows through, then confirms or declines in the
// studio app. The mailer function emails the client either way.

import {
  sb, json, oops, env, sendEmail, emailShell, detailRows, esc,
  todayManila, addDays, weekdayOf, prettyDate, prettyTime, makeRef,
  uploadPhoto, signPhoto, removePhoto, PHOTO_MAX_BYTES,
  IZZA_NUMBER, CHAT_APPS, LEAD_DAYS, HORIZON,
} from './lib/core.js'

const clean = (v, max = 400) => String(v ?? '').trim().slice(0, max)

const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// "data:image/jpeg;base64,...." → { type, bytes } or null
function readPhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''))
  if (!m) return null
  const bytes = Buffer.from(m[2], 'base64')
  return { type: m[1], bytes }
}

export default async (req) => {
  if (req.method !== 'POST') return oops('Method not allowed', 405)

  let photoPath = null
  let saved     = false
  try {
    if (!env().url || !env().key) return oops('Booking is not configured yet.', 503)

    let body
    try { body = await req.json() } catch { return oops('Bad request') }

    // Honeypot: a real person never fills this in, bots fill everything.
    if (clean(body.website)) return json({ ok: true, ref: 'BB-OK' })

    const name    = clean(body.name, 120)
    const contact = clean(body.contact, 60)
    const email   = clean(body.email, 160).toLowerCase()
    const chatApp = clean(body.chatApp, 12).toLowerCase()
    const date    = clean(body.date, 10)
    const time    = clean(body.time, 8)
    const svcId   = clean(body.serviceId, 64)

    if (name.length < 2)                       return oops('Please enter your name.')
    if (contact.replace(/\D/g, '').length < 7) return oops('Please enter a mobile number we can reach you on.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return oops('Please enter your email so we can tell you when Izza confirms.')
    if (!CHAT_APPS[chatApp])                   return oops('Please choose Viber or WhatsApp.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))     return oops('Please choose a date.')
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time))  return oops('Please choose a time.')

    const photo = readPhoto(body.photo)
    if (!photo)                                return oops('Please add a photo of your brows.')
    if (photo.bytes.length > PHOTO_MAX_BYTES)  return oops('That photo is too large. Please choose a smaller one.')

    const startTime = time.length === 5 ? `${time}:00` : time
    const today     = todayManila()
    if (date < addDays(today, LEAD_DAYS)) return oops('Please choose a date at least a couple of days from now.')
    if (date > addDays(today, HORIZON))   return oops('That date is too far ahead to book online.')

    // ── The slot has to be real ────────────────────────────────────────────
    const [svcRows, ruleRows, blockedRows] = await Promise.all([
      sb(`booking_services?id=eq.${encodeURIComponent(svcId)}&active=eq.true&select=id,name,duration_min&limit=1`),
      sb(`booking_availability?active=eq.true&weekday=eq.${weekdayOf(date)}&start_time=eq.${startTime}&select=id&limit=1`),
      sb(`booking_blocked_dates?date=eq.${date}&select=id&limit=1`),
    ])

    const service = svcRows?.[0]
    if (!service)            return oops('Please choose a treatment.')
    if (!ruleRows?.length)   return oops('That time is not one of Izza’s bookable slots.')
    if (blockedRows?.length) return oops('Izza is away that day. Please pick another date.')

    // ── Light abuse guard ──────────────────────────────────────────────────
    const since  = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const recent = await sb(`bookings?email=eq.${encodeURIComponent(email)}&created_at=gte.${since}&select=id`)
    if (recent.length >= 3) return oops('You already have a few requests in. Please message Izza on Viber or WhatsApp instead.', 429)

    // ── Store the photo ────────────────────────────────────────────────────
    photoPath = `${date}/${crypto.randomUUID()}.${PHOTO_TYPES[photo.type]}`
    await uploadPhoto(photoPath, photo.bytes, photo.type)
    const photoUrl = await signPhoto(photoPath)

    // ── Hold the slot ──────────────────────────────────────────────────────
    // The partial unique index is the real guard against two people taking
    // the same slot at the same moment; we just translate the error.
    const row = {
      service_id:       service.id,
      service_name:     service.name,
      duration_min:     service.duration_min,
      booking_date:     date,
      start_time:       startTime,
      client_name:      name,
      contact,
      email,
      chat_app:         chatApp,
      photo_path:       photoPath,
      photo_url:        photoUrl,
      first_time:       !!body.firstTime,
      had_consultation: !!body.hadConsultation,
      source:           clean(body.source, 60) || null,
      notes:            clean(body.notes, 1000) || null,
      status:           'pending',
    }

    let booking = null
    for (let attempt = 0; attempt < 3 && !booking; attempt++) {
      try {
        const inserted = await sb('bookings', {
          method:  'POST',
          headers: { Prefer: 'return=representation' },
          body:    JSON.stringify({ ...row, ref: makeRef() }),
        })
        booking = inserted?.[0]
      } catch (e) {
        const msg = JSON.stringify(e.detail || e.message || '')
        if (msg.includes('bookings_slot_held')) {
          await removePhoto(photoPath)
          return oops('Sorry — someone just took that slot. Please pick another time.', 409)
        }
        if (msg.includes('ref')) continue        // reference collision, try again
        throw e
      }
    }
    if (!booking) {
      await removePhoto(photoPath)
      return oops('Could not save your request. Please try again.', 500)
    }
    saved = true

    // ── Emails (never block the booking) ───────────────────────────────────
    const { owner, studio } = env()
    const app   = CHAT_APPS[chatApp]
    const first = esc(name.split(' ')[0])

    await sendEmail({
      to: email,
      replyTo: owner,
      subject: `Booking request received — ${booking.ref}`,
      html: emailShell(`
        <p>Hi ${first},</p>
        <p>Thank you for requesting a slot at Bloom Bar. Here is what you asked for:</p>
        ${detailRows(booking)}
        <p><strong>This slot is held for you while you and Izza talk it through.</strong>
        She will message you on <strong>${app}</strong> at <strong>${esc(contact)}</strong>, usually
        within a day, to go over your brow photo and answer any questions.</p>
        <p>Once she confirms, you will get another email with everything you need to know
        before your appointment.</p>
        <p>Can’t wait? Message her first on ${app} at <strong>${IZZA_NUMBER}</strong> and
        mention reference <strong>${booking.ref}</strong>.</p>
        <p style="margin-top:22px;">See you soon,<br/><strong>Izza</strong><br/>
        <span style="color:#8B7E6C;font-size:13px;">Bloom Bar MNL</span></p>
      `),
    })

    await sendEmail({
      to: owner,
      replyTo: email,
      subject: `New booking request — ${name}, ${prettyDate(date)}`,
      attachments: [{ filename: `${booking.ref}-brows.${PHOTO_TYPES[photo.type]}`, content: photo.bytes.toString('base64') }],
      html: emailShell(`
        <p style="font-size:17px;"><strong>New booking request</strong></p>
        ${detailRows(booking)}
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;line-height:1.9;">
          <tr><td style="color:#8B7E6C;width:110px;">Name</td><td><strong>${esc(name)}</strong></td></tr>
          <tr><td style="color:#8B7E6C;">Mobile</td><td>${esc(contact)}</td></tr>
          <tr><td style="color:#8B7E6C;">Message on</td><td><strong>${app}</strong></td></tr>
          <tr><td style="color:#8B7E6C;">Email</td><td>${esc(email)}</td></tr>
          <tr><td style="color:#8B7E6C;">First time</td><td>${booking.first_time ? 'Yes' : 'No'}</td></tr>
          <tr><td style="color:#8B7E6C;">Consulted</td><td>${booking.had_consultation ? 'Yes' : 'Not yet'}</td></tr>
          <tr><td style="color:#8B7E6C;">Found you via</td><td>${esc(booking.source) || '—'}</td></tr>
        </table>
        ${booking.notes ? `<p style="margin-top:14px;"><span style="color:#8B7E6C;">Notes</span><br/>${esc(booking.notes)}</p>` : ''}
        <p style="margin-top:14px;color:#8B7E6C;font-size:13px;">Her brow photo is attached.</p>
        <p style="margin-top:22px;">Message her on ${app} to talk it through, then confirm or decline
        in Bookings. She is emailed either way.</p>
        <p style="margin-top:6px;"><a href="${studio}" style="display:inline-block;background:#1A1612;color:#FFFFFF;text-decoration:none;padding:10px 20px;border-radius:999px;font-size:14px;">Open studio app</a></p>
      `),
    })

    return json({
      ok:   true,
      ref:  booking.ref,
      date: prettyDate(booking.booking_date),
      time: prettyTime(booking.start_time),
      service: booking.service_name,
    })
  } catch (e) {
    console.error('book:', e)
    if (photoPath && !saved) await removePhoto(photoPath)
    return oops('Something went wrong saving your request. Please message Izza on Viber or WhatsApp.', 500)
  }
}

export const config = { path: '/api/book' }
