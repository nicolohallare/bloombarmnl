// POST /api/visit  (sent with navigator.sendBeacon from /js/visit.js)
// A simple first-party visit counter: one row per page view with a random
// visitor id, the page, and where the visit started. No cookies, no names,
// no IP addresses stored. Read back as monthly totals by the studio app.

import { sb, env } from './lib/core.js'
import { classify } from './lib/source.js'

const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|embedly|vercel|netlify/i
const PAGES = /^\/[a-z0-9\-\/]{0,60}$/

export default async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  try {
    if (!env().url || !env().key) return new Response(null, { status: 204 })
    if (BOTS.test(req.headers.get('user-agent') || '')) return new Response(null, { status: 204 })

    let v = {}
    try { v = JSON.parse(await req.text()) } catch { return new Response(null, { status: 400 }) }

    const visitor = String(v.visitor || '')
    let page = String(v.page || '/').toLowerCase().replace(/\.html$/, '').replace(/\/index$/, '/')
    if (page.length > 1) page = page.replace(/\/$/, '')
    if (!/^[a-z0-9-]{8,40}$/.test(visitor) || !PAGES.test(page)) return new Response(null, { status: 400 })

    await sb('site_visits', {
      method: 'POST',
      body: JSON.stringify({ visitor, page, source: classify(v.first || {}), landing: !!v.landing }),
    })
    return new Response(null, { status: 204 })
  } catch (e) {
    console.error('visit:', e.message)          // e.g. table not created yet
    return new Response(null, { status: 204 })
  }
}

export const config = { path: '/api/visit' }
