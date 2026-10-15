// POST /api/consult
// A free brow check: the client sends a photo of their bare brows and how to
// reach them. Izza messages them on Viber or WhatsApp; booking a date comes
// later, once they have talked. No date, no slot, email optional.

import {
  sb, json, oops, env, sendEmail, emailShell, esc,
  uploadPhoto, signPhoto, removePhoto, PHOTO_MAX_BYTES,
  IZZA_NUMBER, CHAT_APPS,
} from './lib/core.js'
import { notifyStudio } from './lib/push.js'

const clean = (v, max = 400) => String(v ?? '').trim().slice(0, max)
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const INTERESTS = ['Microblading', 'Combination Brows', 'Powder Brows', 'Not sure yet']

function readPhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''))
  return m ? { type: m[1], bytes: Buffer.from(m[2], 'base64') } : null
}

const makeRef = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return `BC-${out}`
}

export default async (req) => {
  if (req.method !== 'POST') return oops('Method not allowed', 405)

  let photoPath = null
  let saved = false
  try {
    if (!env().url || !env().key) return oops('This form is not available right now.', 503)

    let body
    try { body = await req.json() } catch { return oops('Bad request') }

    // Honeypot: a real person never fills this in.
    if (clean(body.website)) return json({ ok: true, ref: 'BC-OK' })

    const name     = clean(body.name, 120)
    const contact  = clean(body.contact, 60)
    const chatApp  = clean(body.chatApp, 12).toLowerCase()
    const email    = clean(body.email, 160).toLowerCase()
    const interest = INTERESTS.includes(clean(body.interest, 40)) ? clean(body.interest, 40) : 'Not sure yet'

    if (name.length < 2)                       return oops('Please enter your name.')
    if (contact.replace(/\D/g, '').length < 7) return oops('Please enter your mobile number.')
    if (!CHAT_APPS[chatApp])                   return oops('Please choose Viber or WhatsApp.')
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return oops('That email address does not look right.')

    const photo = readPhoto(body.photo)
    if (!photo)                               return oops('Please add a photo of your bare brows.')
    if (photo.bytes.length > PHOTO_MAX_BYTES) return oops('That photo is too large. Please choose a smaller one.')

    // Light abuse guard: a handful per number per day is plenty.
    const since  = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const recent = await sb(`consult_requests?contact=eq.${encodeURIComponent(contact)}&created_at=gte.${since}&select=id`)
    if (recent.length >= 3) return oops('We already have your photo. Izza will message you soon.', 429)

    // ── Store the photo ────────────────────────────────────────────────────
    const day = new Date().toISOString().slice(0, 10)
    photoPath = `consults/${day}/${crypto.randomUUID()}.${PHOTO_TYPES[photo.type]}`
    await uploadPhoto(photoPath, photo.bytes, photo.type)
    const photoUrl = await signPhoto(photoPath)

    const gaId = clean(body.gaClientId, 50)
    const row = {
      client_name:  name,
      contact,
      chat_app:     chatApp,
      email:        email || null,
      interest,
      notes:        clean(body.notes, 1000) || null,
      source:       clean(body.source, 60) || null,
      photo_path:   photoPath,
      photo_url:    photoUrl,
      ga_client_id: /^\d{1,20}\.\d{1,20}$/.test(gaId) ? gaId : null,
    }

    let consult = null
    for (let attempt = 0; attempt < 3 && !consult; attempt++) {
      try {
        const inserted = await sb('consult_requests', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ ...row, ref: makeRef() }),
        })
        consult = inserted?.[0]
      } catch (e) {
        if (JSON.stringify(e.detail || e.message || '').includes('ref')) continue   // reference collision
        throw e
      }
    }
    if (!consult) throw new Error('could not save consult')
    saved = true

    // ── Phone alert in Izza's studio app (no names in the alert) ────────────
    await notifyStudio({
      title: 'New brow check',
      body: `${interest} · photo sent, reply on ${CHAT_APPS[chatApp]}`,
      url: '/?screen=bookings', tag: consult.ref,
    })

    // ── Emails (never block the request) ───────────────────────────────────
    const { owner, studio } = env()
    const app = CHAT_APPS[chatApp]

    await sendEmail({
      to: owner,
      replyTo: email || undefined,
      subject: `New brow check — ${name}`,
      attachments: [{ filename: `${consult.ref}-brows.${PHOTO_TYPES[photo.type]}`, content: photo.bytes.toString('base64') }],
      html: emailShell(`
        <p style="font-size:17px;"><strong>New free brow check</strong></p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;line-height:1.9;">
          <tr><td style="color:#8B7E6C;width:120px;">Name</td><td><strong>${esc(name)}</strong></td></tr>
          <tr><td style="color:#8B7E6C;">Mobile</td><td>${esc(contact)}</td></tr>
          <tr><td style="color:#8B7E6C;">Message on</td><td><strong>${app}</strong></td></tr>
          <tr><td style="color:#8B7E6C;">Interested in</td><td>${esc(interest)}</td></tr>
          ${email ? `<tr><td style="color:#8B7E6C;">Email</td><td>${esc(email)}</td></tr>` : ''}
          <tr><td style="color:#8B7E6C;">Found you via</td><td>${esc(row.source) || '—'}</td></tr>
          <tr><td style="color:#8B7E6C;">Reference</td><td>${consult.ref}</td></tr>
        </table>
        ${row.notes ? `<p style="margin-top:14px;"><span style="color:#8B7E6C;">Their message</span><br/>${esc(row.notes)}</p>` : ''}
        <p style="margin-top:14px;color:#8B7E6C;font-size:13px;">Their brow photo is attached.</p>
        <p style="margin-top:22px;">Message them on ${app} from Bookings → Brow checks.</p>
        <p style="margin-top:6px;"><a href="${studio}" style="display:inline-block;background:#1A1612;color:#FFFFFF;text-decoration:none;padding:10px 20px;border-radius:999px;font-size:14px;">Open studio app</a></p>
      `),
    })

    if (email) {
      await sendEmail({
        to: email,
        replyTo: owner,
        subject: 'We got your brow photo',
        html: emailShell(`
          <p>Hi ${esc(name.split(' ')[0])},</p>
          <p>Thank you for sending your brows. Izza will look at your photo and message you on
          <strong>${app}</strong> at <strong>${esc(contact)}</strong>, usually within a day, to talk
          through what would suit you.</p>
          <p>Can’t wait? Message her on ${app} at <strong>${IZZA_NUMBER}</strong> and mention
          reference <strong>${consult.ref}</strong>.</p>
          <p style="margin-top:22px;">Talk soon,<br/><strong>Izza</strong><br/>
          <span style="color:#8B7E6C;font-size:13px;">Bloom Bar MNL</span></p>
        `),
      })
    }

    return json({ ok: true, ref: consult.ref })
  } catch (e) {
    console.error('consult:', e)
    if (photoPath && !saved) await removePhoto(photoPath)
    return oops('Something went wrong sending your photo. Please message Izza on Viber or WhatsApp.', 500)
  }
}

export const config = { path: '/api/consult' }
