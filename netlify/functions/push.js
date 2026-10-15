// /api/push — phone alerts for Izza's studio app
//   GET              → { publicKey }  the app needs it to subscribe
//   POST { subscription, label, test? } → save this phone; test:true sends a test alert
//   DELETE { endpoint }                 → this phone stops getting alerts
// Called from the studio app on Vercel, hence CORS.

import { sb, json, oops } from './lib/core.js'
import { vapidKeys, sendPush, corsHeaders } from './lib/push.js'

const MAX_PHONES = 10

export default async (req) => {
  const cors = corsHeaders(req)
  const reply = (data, status = 200) => {
    const r = json(data, status)
    for (const [k, v] of Object.entries(cors)) r.headers.set(k, v)
    return r
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  try {
    if (req.method === 'GET') {
      const { publicKey } = await vapidKeys()
      return reply({ publicKey })
    }

    let body = {}
    try { body = await req.json() } catch { return reply({ error: 'Bad request' }, 400) }

    if (req.method === 'DELETE') {
      const endpoint = String(body.endpoint || '')
      if (endpoint) await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' })
      return reply({ ok: true })
    }

    if (req.method === 'POST') {
      const s = body.subscription || {}
      const endpoint = String(s.endpoint || '')
      const p256dh = String(s.keys?.p256dh || '')
      const auth = String(s.keys?.auth || '')
      if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return reply({ error: 'Not a valid subscription' }, 400)

      const existing = await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&select=id`)
      if (!existing.length) {
        const count = await sb('push_subscriptions?select=id')
        if (count.length >= MAX_PHONES) return reply({ error: 'Too many phones have alerts on. Turn one off first.' }, 409)
      }
      await sb('push_subscriptions?on_conflict=endpoint', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ endpoint, p256dh, auth, label: String(body.label || '').slice(0, 80) || null }),
      })

      if (body.test) {
        const keys = await vapidKeys()
        const status = await sendPush({ endpoint, p256dh, auth }, {
          title: 'Bloom Bar alerts are on',
          body: 'You will get a notification like this for each new brow check and booking request.',
          url: '/?screen=bookings', tag: 'test',
        }, keys)
        if (status >= 300) return reply({ error: `The phone's push service refused the test (${status}).` }, 502)
      }
      return reply({ ok: true })
    }

    return reply({ error: 'Method not allowed' }, 405)
  } catch (e) {
    console.error('push:', e)
    return reply({ error: 'Could not update alerts right now.' }, 500)
  }
}

export const config = { path: '/api/push' }
