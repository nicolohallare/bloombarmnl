// Where a visitor came from, worked out from the first page of their visit:
// ad click ids, utm_source, or the referring site. Used for the site visit
// counter and stored on brow checks and booking requests, so the studio app
// can show which channels lead to real bookings.

export const SOURCES = [
  'Google Ads', 'Google', 'AI assistant', 'Instagram', 'Facebook',
  'TikTok', 'Other search', 'Other site', 'Direct',
]

const has = (host, ...names) => names.some(n => host === n || host.endsWith('.' + n))

export function classify(v = {}) {
  const utm = String(v.utm || '').toLowerCase().trim()
  const medium = String(v.medium || '').toLowerCase().trim()
  let host = ''
  try { host = v.ref ? new URL(v.ref).hostname.toLowerCase() : '' } catch { host = String(v.ref || '').toLowerCase() }

  if (v.ad || (utm === 'google' && /cpc|ppc|paid|ads/.test(medium))) return 'Google Ads'
  if (/chatgpt|openai|perplexity|gemini|copilot|claude/.test(utm)) return 'AI assistant'
  if (/^(ig|instagram)/.test(utm)) return 'Instagram'
  if (/^(fb|facebook)/.test(utm)) return 'Facebook'
  if (/tiktok/.test(utm)) return 'TikTok'
  if (/^(google|gbp|gmb|maps)/.test(utm)) return 'Google'

  if (!host || has(host, 'bloombarmnl.com')) return 'Direct'
  if (has(host, 'chatgpt.com', 'openai.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai')) return 'AI assistant'
  if (/(^|\.)google\.[a-z.]+$/.test(host) || has(host, 'googleusercontent.com')) return 'Google'
  if (has(host, 'instagram.com')) return 'Instagram'
  if (has(host, 'facebook.com', 'fb.com', 'messenger.com')) return 'Facebook'
  if (has(host, 'tiktok.com')) return 'TikTok'
  if (has(host, 'bing.com', 'duckduckgo.com', 'yahoo.com', 'ecosia.org', 'brave.com')) return 'Other search'
  return 'Other site'
}
