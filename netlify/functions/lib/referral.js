// Brow Circle: a friend arrives with ?ref=<code> (e.g. ana-3f9c2). Look the
// code up in the clients table so the brow check, booking request or gift
// request is tagged with who sent her. Never throws: a bad or unknown code
// just means no referrer.
import { sb } from './core.js'

const CODE = /^[a-z]{1,30}-[0-9a-f]{5}$/

export async function resolveReferrer(raw) {
  const code = String(raw || '').trim().toLowerCase()
  if (!CODE.test(code)) return null
  try {
    const rows = await sb(`clients?ref_code=eq.${encodeURIComponent(code)}&select=name&limit=1`)
    return rows?.[0]?.name ? { code, name: rows[0].name } : null
  } catch {
    return null
  }
}

// Add the referrer to a row that was just saved. Separate from the insert so a
// missing column (SQL 06 not run) can never block a request.
export async function tagReferrer(table, id, ref) {
  if (!ref) return
  try {
    await sb(`${table}?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ referred_by: ref.name, ref_code: ref.code }) })
  } catch (e) {
    console.error('tagReferrer:', e.message)
  }
}
