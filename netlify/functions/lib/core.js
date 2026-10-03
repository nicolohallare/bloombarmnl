// ─── Shared helpers for the booking functions ────────────────────────────────
// No npm dependencies on purpose: the site has no build step, and Node 18+
// gives us fetch natively. Keeps deploys boring.

export const TZ        = 'Asia/Manila'
export const LEAD_DAYS = 2     // earliest a client can book from today
export const HORIZON   = 90    // furthest ahead, in days

// ─── Env ─────────────────────────────────────────────────────────────────────
export const env = () => ({
  url:      process.env.SUPABASE_URL,
  key:      process.env.SUPABASE_SERVICE_KEY,
  resend:   process.env.RESEND_API_KEY,
  from:     process.env.BOOKING_FROM_EMAIL  || 'Bloom Bar MNL <bookings@bloombarmnl.com>',
  owner:    process.env.OWNER_EMAIL         || 'bloombarmnl@gmail.com',
  site:     process.env.SITE_URL            || 'https://bloombarmnl.com',
})

// ─── Supabase REST ───────────────────────────────────────────────────────────
// Service-role key — only ever runs here on the server, never in the browser.
export async function sb(path, options = {}) {
  const { url, key } = env()
  if (!url || !key) throw new Error('Supabase env vars are not set')

  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey:          key,
      Authorization:   `Bearer ${key}`,
      'Content-Type':  'application/json',
      ...(options.headers || {}),
    },
  })

  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }

  if (!res.ok) {
    const err = new Error(body?.message || `Supabase ${res.status}`)
    err.status = res.status
    err.code   = body?.code
    err.detail = body
    throw err
  }
  return body
}

// ─── Dates ───────────────────────────────────────────────────────────────────
// Everything is handled as plain 'YYYY-MM-DD' strings in Manila time. No
// timestamps, no UTC drift, no off-by-one-day bugs.

export const todayManila = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date())

export const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

export const weekdayOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()   // 0 = Sunday
}

export const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

// '09:00:00' → '9:00 AM'
export const prettyTime = (t) => {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr   = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`
}

// '2026-10-15' → 'Thursday, 15 October 2026'
export const prettyDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

// ─── Booking reference ───────────────────────────────────────────────────────
// Human-friendly, no ambiguous characters (no O/0, I/1).
export const makeRef = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return `BB-${out}`
}

// ─── Responses ───────────────────────────────────────────────────────────────
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export const oops = (message, status = 400) => json({ error: message }, status)

// ─── Email via Resend ────────────────────────────────────────────────────────
// Returns true if sent. Never throws: a booking must not fail because an
// email did. Missing API key simply skips sending.
export async function sendEmail({ to, subject, html, replyTo }) {
  const { resend, from } = env()
  if (!resend) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    })
    if (!res.ok) console.error('Resend failed:', res.status, await res.text())
    return res.ok
  } catch (e) {
    console.error('Resend error:', e.message)
    return false
  }
}

// ─── Email shell ─────────────────────────────────────────────────────────────
export const emailShell = (bodyHtml) => `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#DEDACF;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#DEDACF;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:18px;overflow:hidden;">
        <tr><td style="padding:30px 28px 10px;text-align:center;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:23px;letter-spacing:5px;color:#1A1612;">BLOOMBAR</div>
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:9px;letter-spacing:3px;color:#A88860;margin-top:5px;text-transform:uppercase;">Beauty Studio</div>
        </td></tr>
        <tr><td style="padding:14px 28px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#1A1612;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 28px 26px;border-top:1px solid #DEDACF;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.7;color:#8B7E6C;">
          Valle Verde, Pasig City &middot; Strictly by appointment<br/>
          +63 908 819 0053 &middot; bloombarmnl@gmail.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

export const detailRows = (b) => `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F7F5F0;border-radius:12px;padding:16px 18px;margin:18px 0;">
    <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:2;color:#1A1612;">
      <strong>${b.service_name}</strong><br/>
      ${prettyDate(b.booking_date)}<br/>
      ${prettyTime(b.start_time)}<br/>
      <span style="color:#8B7E6C;font-size:12px;">Reference ${b.ref}</span>
    </td></tr>
  </table>`
