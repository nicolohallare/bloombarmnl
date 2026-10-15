// Web Push for Izza's studio app (the PWA on her phone).
//
// No libraries: VAPID signing (RFC 8292) and payload encryption (RFC 8291,
// aes128gcm) use Node's built-in crypto. The VAPID key pair is created on
// first use and kept in Supabase (app_secrets, service key only), so nobody
// has to generate or copy a secret.
//
// Payloads never include client names or contact details: the notification
// only says what came in and opens the Bookings tab.

import crypto from 'node:crypto'
import { sb, env } from './core.js'

const b64u   = (buf) => Buffer.from(buf).toString('base64url')
const unb64u = (s) => Buffer.from(String(s), 'base64url')

// ─── VAPID keys ──────────────────────────────────────────────────────────────
let cached = null
export async function vapidKeys() {
  if (cached) return cached
  const rows = await sb('app_secrets?key=eq.vapid&select=value&limit=1')
  if (rows?.[0]?.value) return (cached = JSON.parse(rows[0].value))

  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' })
  const keys = {
    publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])),
    jwk: { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y },
  }
  // ignore-duplicates: if two requests race, the first stored pair wins
  await sb('app_secrets', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({ key: 'vapid', value: JSON.stringify(keys) }),
  })
  const again = await sb('app_secrets?key=eq.vapid&select=value&limit=1')
  return (cached = JSON.parse(again[0].value))
}

function vapidAuth(endpoint, keys) {
  const aud = new URL(endpoint).origin
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const claims = b64u(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: `mailto:${env().owner}`,
  }))
  const key = crypto.createPrivateKey({ key: keys.jwk, format: 'jwk' })
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`
}

// ─── RFC 8291 payload encryption ─────────────────────────────────────────────
export function encrypt(payload, p256dh, auth) {
  const uaPublic = unb64u(p256dh)
  const authSecret = unb64u(auth)
  const ecdh = crypto.createECDH('prime256v1')
  const asPublic = ecdh.generateKeys()
  const shared = ecdh.computeSecret(uaPublic)

  const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len))
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = hkdf(authSecret, shared, keyInfo, 32)
  const salt = crypto.randomBytes(16)
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce)
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096)
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body])
}

// ─── Send ────────────────────────────────────────────────────────────────────
export async function sendPush(sub, message, keys) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuth(sub.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body: encrypt(JSON.stringify(message), sub.p256dh, sub.auth),
  })
  return res.status
}

// Every phone that turned alerts on. Never throws: a booking or brow check
// must not fail because a notification did.
export async function notifyStudio(message) {
  try {
    if (!env().url || !env().key) return 0
    const subs = await sb('push_subscriptions?select=id,endpoint,p256dh,auth')
    if (!subs.length) return 0
    const keys = await vapidKeys()
    let sent = 0
    await Promise.all(subs.map(async (s) => {
      try {
        const status = await sendPush(s, message, keys)
        if (status === 404 || status === 410) {           // phone unsubscribed or app removed
          await sb(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' })
        } else if (status < 300) sent++
        else console.error('push failed', status)
      } catch (e) { console.error('push error', e.message) }
    }))
    return sent
  } catch (e) {
    console.error('notifyStudio:', e.message)
    return 0
  }
}

// ─── CORS for the studio app (different domain) ──────────────────────────────
export function corsHeaders(req) {
  const origin = req.headers.get('origin') || ''
  const studio = env().studio.replace(/\/$/, '')
  const ok = origin === studio || /^https:\/\/bloombar-studio[a-z0-9-]*\.vercel\.app$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin)
  return {
    'Access-Control-Allow-Origin': ok ? origin : studio,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
}
