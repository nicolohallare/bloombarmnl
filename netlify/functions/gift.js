// POST /api/gift
// A gift certificate request. No payment online: Izza messages the buyer on
// Viber or WhatsApp to arrange payment (GCash, bank transfer or card), then
// issues the certificate from her studio app.

import { sb, json, oops, env, sendEmail, emailShell, esc, IZZA_NUMBER, CHAT_APPS } from './lib/core.js'
import { notifyStudio } from './lib/push.js'
import { classify } from './lib/source.js'

const clean = (v, max = 400) => String(v ?? '').trim().slice(0, max)

// What can be given, and what it costs (same as the Rates on the homepage)
export const GIFTS = {
  treatment: { label: 'Brow treatment', amount: 10000, detail: 'Microblading, Combination or Powder Brows, second session included. For brows with no existing permanent makeup' },
  retouch:   { label: 'Annual retouch', amount: 5000,  detail: 'A yearly refresh, for brows done at Bloom Bar MNL only' },
}

const peso = (n) => '₱' + Number(n).toLocaleString('en-PH')

const makeRef = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return `GR-${out}`
}

export default async (req) => {
  if (req.method !== 'POST') return oops('Method not allowed', 405)
  try {
    if (!env().url || !env().key) return oops('This form is not available right now.', 503)

    let body
    try { body = await req.json() } catch { return oops('Bad request') }
    if (clean(body.website)) return json({ ok: true, ref: 'GR-OK' })   // honeypot

    const buyer     = clean(body.name, 120)
    const contact   = clean(body.contact, 60)
    const chatApp   = clean(body.chatApp, 12).toLowerCase()
    const email     = clean(body.email, 160).toLowerCase()
    const recipient = clean(body.recipient, 120)
    const giftKey   = clean(body.gift, 20)
    const message   = clean(body.message, 200)
    const gift      = GIFTS[giftKey]

    if (!gift)                                 return oops('Please choose a gift.')
    if (buyer.length < 2)                      return oops('Please enter your name.')
    if (contact.replace(/\D/g, '').length < 7) return oops('Please enter your mobile number.')
    if (!CHAT_APPS[chatApp])                   return oops('Please choose Viber or WhatsApp.')
    if (recipient.length < 2)                  return oops("Please enter the recipient's name.")
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return oops('That email address does not look right.')

    const since  = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const recent = await sb(`gift_requests?contact=eq.${encodeURIComponent(contact)}&created_at=gte.${since}&select=id`)
    if (recent.length >= 5) return oops('We already have your requests. Izza will message you soon.', 429)

    const row = {
      buyer_name: buyer, contact, chat_app: chatApp, email: email || null,
      recipient_name: recipient, gift: giftKey, amount: gift.amount,
      message: message || null, visit_source: classify(body.visit || {}),
    }
    let saved = null
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      try {
        const inserted = await sb('gift_requests', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ ...row, ref: makeRef() }),
        })
        saved = inserted?.[0]
      } catch (e) {
        if (JSON.stringify(e.detail || e.message || '').includes('ref')) continue
        throw e
      }
    }
    if (!saved) throw new Error('could not save gift request')

    await notifyStudio({
      title: 'New gift certificate request',
      body: `${gift.label} · ${peso(gift.amount)} · reply on ${CHAT_APPS[chatApp]}`,
      url: '/?screen=bookings', tag: saved.ref,
    })

    const { owner, studio } = env()
    const app = CHAT_APPS[chatApp]
    await sendEmail({
      to: owner,
      replyTo: email || undefined,
      subject: `Gift certificate request — ${buyer}`,
      html: emailShell(`
        <p style="font-size:17px;"><strong>New gift certificate request</strong></p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;line-height:1.9;">
          <tr><td style="color:#8B7E6C;width:120px;">Gift</td><td><strong>${gift.label} · ${peso(gift.amount)}</strong></td></tr>
          <tr><td style="color:#8B7E6C;">For</td><td>${esc(recipient)}</td></tr>
          <tr><td style="color:#8B7E6C;">From</td><td>${esc(buyer)}</td></tr>
          <tr><td style="color:#8B7E6C;">Mobile</td><td>${esc(contact)} · ${app}</td></tr>
          ${email ? `<tr><td style="color:#8B7E6C;">Email</td><td>${esc(email)}</td></tr>` : ''}
          ${message ? `<tr><td style="color:#8B7E6C;">Card message</td><td>${esc(message)}</td></tr>` : ''}
          <tr><td style="color:#8B7E6C;">Reference</td><td>${saved.ref}</td></tr>
        </table>
        <p style="margin-top:22px;">Message them on ${app} to arrange payment, then issue the certificate from Bookings → Gift certificates.</p>
        <p style="margin-top:6px;"><a href="${studio}" style="display:inline-block;background:#1A1612;color:#FFFFFF;text-decoration:none;padding:10px 20px;border-radius:999px;font-size:14px;">Open studio app</a></p>
      `),
    })
    if (email) {
      await sendEmail({
        to: email, replyTo: owner,
        subject: 'Your Bloom Bar gift certificate request',
        html: emailShell(`
          <p>Hi ${esc(buyer.split(' ')[0])},</p>
          <p>Thank you for choosing a Bloom Bar gift for <strong>${esc(recipient)}</strong>: ${gift.label.toLowerCase()}, ${peso(gift.amount)}.</p>
          <p style="color:#8B7E6C;font-size:13px;">${gift.detail}.</p>
          <p>Izza will message you on <strong>${app}</strong> at <strong>${esc(contact)}</strong> to arrange payment
          (GCash, bank transfer or card), then send you the certificate to give.</p>
          <p>Questions? Message her on ${app} at <strong>${IZZA_NUMBER}</strong> and mention <strong>${saved.ref}</strong>.</p>
          <p style="margin-top:22px;">Warmly,<br/><strong>Izza</strong><br/><span style="color:#8B7E6C;font-size:13px;">Bloom Bar MNL</span></p>
        `),
      })
    }
    return json({ ok: true, ref: saved.ref })
  } catch (e) {
    console.error('gift:', e)
    return oops('Something went wrong. Please message Izza on Viber or WhatsApp.', 500)
  }
}

export const config = { path: '/api/gift' }
