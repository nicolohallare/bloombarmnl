// POST /api/book
// Takes a booking request, holds the slot, emails the client and Izza.
// Every rule the browser enforces is re-checked here — the page is only a UI.

import {
  sb, json, oops, env, sendEmail, emailShell, detailRows,
  todayManila, addDays, weekdayOf, prettyDate, prettyTime, makeRef,
  LEAD_DAYS, HORIZON,
} from './lib/core.js'

const clean = (v, max = 400) => String(v ?? '').trim().slice(0, max)

export default async (req) => {
  if (req.method !== 'POST') return oops('Method not allowed', 405)

  try {
    if (!env().url || !env().key) return oops('Booking is not configured yet.', 503)

    let body
    try { body = await req.json() } catch { return oops('Bad request') }

    // Honeypot: a real person never fills this in, bots fill everything.
    if (clean(body.website)) return json({ ok: true, ref: 'BB-OK' })

    const name    = clean(body.name, 120)
    const contact = clean(body.contact, 60)
    const email   = clean(body.email, 160).toLowerCase()
    const date    = clean(body.date, 10)
    const time    = clean(body.time, 8)
    const svcId   = clean(body.serviceId, 64)

    if (name.length < 2)                      return oops('Please enter your name.')
    if (contact.replace(/\D/g, '').length < 7) return oops('Please enter a mobile number we can reach you on.')
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return oops('That email address does not look right.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))     return oops('Please choose a date.')
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time))  return oops('Please choose a time.')

    const startTime = time.length === 5 ? `${time}:00` : time
    const today     = todayManila()
    if (date < addDays(today, LEAD_DAYS)) return oops('Please choose a date at least a couple of days from now.')
    if (date > addDays(today, HORIZON))   return oops('That date is too far ahead to book online.')

    // ── The slot has to be real ────────────────────────────────────────────
    const [svcRows, ruleRows, blockedRows] = await Promise.all([
      sb(`booking_services?id=eq.${svcId}&active=eq.true&select=id,name,duration_min&limit=1`),
      sb(`booking_availability?active=eq.true&weekday=eq.${weekdayOf(date)}&start_time=eq.${startTime}&select=id&limit=1`),
      sb(`booking_blocked_dates?date=eq.${date}&select=id&limit=1`),
    ])

    const service = svcRows?.[0]
    if (!service)            return oops('Please choose a treatment.')
    if (!ruleRows?.length)   return oops('That time is not one of Izza’s bookable slots.')
    if (blockedRows?.length) return oops('Izza is away that day. Please pick another date.')

    // ── Light abuse guard ──────────────────────────────────────────────────
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const ident = email ? `email=eq.${encodeURIComponent(email)}` : `contact=eq.${encodeURIComponent(contact)}`
    const recent = await sb(`bookings?${ident}&created_at=gte.${since}&select=id`)
    if (recent.length >= 3) return oops('You already have a few requests in. Please message Izza on Viber or WhatsApp instead.', 429)

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
      email:            email || null,
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
          return oops('Sorry — someone just took that slot. Please pick another time.', 409)
        }
        if (msg.includes('ref')) continue        // reference collision, try again
        throw e
      }
    }
    if (!booking) return oops('Could not save your request. Please try again.', 500)

    // ── Emails (never block the booking) ───────────────────────────────────
    const { owner, site } = env()

    if (email) {
      await sendEmail({
        to: email,
        replyTo: owner,
        subject: `Booking request received — ${booking.ref}`,
        html: emailShell(`
          <p>Hi ${name.split(' ')[0]},</p>
          <p>Thank you for requesting a slot at Bloom Bar. Here is what you asked for:</p>
          ${detailRows(booking)}
          <p><strong>This slot is held for you while Izza confirms it.</strong> She works with only
          two clients a day and checks requests between appointments, so you will hear back within
          a day — by email and on the number you gave us.</p>
          ${booking.first_time && !booking.had_consultation ? `
            <p style="background:#F7F5F0;border-radius:12px;padding:14px 16px;">
              Since this is your first visit, Izza will ask for a photo of your bare brows first.
              You can send one ahead on Viber or WhatsApp at <strong>+63 908 819 0053</strong> to speed things up.
            </p>` : ''}
          <p>Need to change anything? Just reply to this email or message +63 908 819 0053.</p>
          <p style="margin-top:22px;">See you soon,<br/><strong>Izza</strong><br/>
          <span style="color:#8B7E6C;font-size:13px;">Bloom Bar MNL</span></p>
        `),
      })
    }

    await sendEmail({
      to: owner,
      replyTo: email || undefined,
      subject: `New booking request — ${name}, ${prettyDate(date)}`,
      html: emailShell(`
        <p style="font-size:17px;"><strong>New booking request</strong></p>
        ${detailRows(booking)}
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;line-height:1.9;">
          <tr><td style="color:#8B7E6C;width:110px;">Name</td><td><strong>${name}</strong></td></tr>
          <tr><td style="color:#8B7E6C;">Contact</td><td>${contact}</td></tr>
          <tr><td style="color:#8B7E6C;">Email</td><td>${email || '—'}</td></tr>
          <tr><td style="color:#8B7E6C;">First time</td><td>${booking.first_time ? 'Yes' : 'No'}</td></tr>
          <tr><td style="color:#8B7E6C;">Consulted</td><td>${booking.had_consultation ? 'Yes' : 'Not yet'}</td></tr>
          <tr><td style="color:#8B7E6C;">Found you via</td><td>${booking.source || '—'}</td></tr>
        </table>
        ${booking.notes ? `<p style="margin-top:14px;"><span style="color:#8B7E6C;">Notes</span><br/>${booking.notes}</p>` : ''}
        <p style="margin-top:22px;">Open your studio app to confirm or decline this request.</p>
        <p style="margin-top:6px;"><a href="${site}" style="color:#A88860;">${site.replace(/^https?:\/\//, '')}</a></p>
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
    return oops('Something went wrong saving your request. Please message Izza on Viber or WhatsApp.', 500)
  }
}

export const config = { path: '/api/book' }
