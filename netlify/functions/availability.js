// GET /api/availability?month=YYYY-MM
// Returns the bookable services and which slots are actually open that month.
// Public, read-only, no personal data ever leaves here.

import {
  sb, json, oops, env,
  todayManila, addDays, weekdayOf, daysInMonth, prettyTime,
  LEAD_DAYS, HORIZON,
} from './lib/core.js'

export default async (req) => {
  try {
    if (!env().url || !env().key) return oops('Booking is not configured yet.', 503)

    const url   = new URL(req.url)
    const month = url.searchParams.get('month') || todayManila().slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) return oops('Bad month')

    const today   = todayManila()
    const minDate = addDays(today, LEAD_DAYS)
    const maxDate = addDays(today, HORIZON)

    // Real last day of the month — '2026-02-31' would be rejected by Postgres
    const last  = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
    const first = `${month}-01`

    // Everything we need, in parallel
    const [services, rules, blocked, held] = await Promise.all([
      sb('booking_services?active=eq.true&select=id,name,blurb,duration_min,price,show_price,first_time_ok&order=sort_order'),
      sb('booking_availability?active=eq.true&select=weekday,start_time'),
      sb(`booking_blocked_dates?date=gte.${first}&date=lte.${last}&select=date`),
      sb(`bookings?booking_date=gte.${first}&booking_date=lte.${last}&status=in.(pending,confirmed)&select=booking_date,start_time`),
    ])

    const blockedSet = new Set(blocked.map(b => b.date))
    const heldSet    = new Set(held.map(b => `${b.booking_date} ${b.start_time}`))

    // weekday → sorted list of start times
    const byWeekday = {}
    for (const r of rules) (byWeekday[r.weekday] ||= []).push(r.start_time)
    for (const k of Object.keys(byWeekday)) byWeekday[k].sort()

    const days = []
    for (let d = 1; d <= daysInMonth(month); d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`
      if (date < minDate || date > maxDate) continue
      if (blockedSet.has(date)) continue

      const times = byWeekday[weekdayOf(date)] || []
      const slots = times
        .filter(t => !heldSet.has(`${date} ${t}`))
        .map(t => ({ time: t, label: prettyTime(t) }))

      if (slots.length) days.push({ date, slots })
    }

    return json({ month, minDate, maxDate, services, days })
  } catch (e) {
    console.error('availability:', e)
    return oops('Could not load availability right now.', 500)
  }
}

export const config = { path: '/api/availability' }
