// Every morning at 9:00 AM Manila: if any clients are due for their annual
// retouch (1 year) and haven't been messaged yet, Izza's phone gets one alert.
// Tapping it opens Clients → Retouches in the studio app, where each client has
// a one-tap Viber/WhatsApp reminder ready to send. The 6-week second session is
// paid up front and isn't followed up.
// Same rules as the app's Reminders tab (bloombar-studio src/lib/helpers.js).
// No names in the alert.

import { sb, env } from './lib/core.js'
import { notifyStudio } from './lib/push.js'

const TATTOO = /micro|powder|combo|combination|ombr/i
const TOUCHUP = /touch|retouch/i
const needsTouchup = (service) => {
  const s = String(service || '').trim()
  return !s || TOUCHUP.test(s) || TATTOO.test(s)
}

// Alert for anyone due within 3 days, or up to 60 days overdue (after that
// they stay in the app's list but stop triggering alerts).
const AHEAD = 3, OVERDUE = 60
const WAIT = { '1y': 365 }

const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000)

export function countDue(clients, reminders, today = manilaToday()) {
  const answered = new Set(reminders.filter(r => r.response).map(r => `${r.client_id}_${r.type}`))
  const counts = { '1y': 0 }
  for (const c of clients) {
    if (!c.name || !/^\d{4}-\d{2}-\d{2}/.test(c.service_date || '')) continue
    for (const type of ['1y']) {
      if (!needsTouchup(c.service)) continue
      if (c[`reminder_${type}_sent`] === 'Yes' || c[`touchup_${type}_done`] === 'Yes') continue
      if (answered.has(`${c.id}_${type}`)) continue
      const left = dayNum(c.service_date.slice(0, 10)) + WAIT[type] - dayNum(today)
      if (left <= AHEAD && left >= -OVERDUE) counts[type]++
    }
  }
  return counts
}

export default async () => {
  try {
    if (!env().url || !env().key) return new Response('not configured')
    const clients = await sb('clients?select=id,name,service,service_date,reminder_6w_sent,touchup_6w_done,reminder_1y_sent,touchup_1y_done')
    const reminders = await sb('reminders?select=client_id,type,response')
    const total = countDue(clients, reminders)['1y']
    if (!total) return new Response('none due')

    await notifyStudio({
      title: total === 1 ? '1 client is due for an annual retouch' : `${total} clients are due for an annual retouch`,
      body: 'Tap to send the reminder on Viber or WhatsApp.',
      url: '/?screen=retouches',
      tag: 'touchups',
    })
    return new Response(`alerted ${total}`)
  } catch (e) {
    console.error('touchup-alert:', e)
    return new Response('error', { status: 500 })
  }
}

// 01:00 UTC = 9:00 AM Manila
export const config = { schedule: '0 1 * * *' }
