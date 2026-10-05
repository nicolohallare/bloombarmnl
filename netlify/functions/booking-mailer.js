// Runs every 15 minutes and sends whatever email is owed:
//   • confirmation, once Izza confirms a request in the studio app
//   • a kind note, if she declines one
//   • a reminder the morning before the appointment
//
// Watching the database this way means the studio app never needs email
// credentials or an API key of its own — it just changes the status.

import {
  sb, json, env, sendEmail, emailShell, detailRows, esc,
  todayManila, addDays, prettyTime, TZ, IZZA_NUMBER, CHAT_APPS,
} from './lib/core.js'

const stamp = (id, field) =>
  sb(`bookings?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ [field]: new Date().toISOString() }) })

const firstName = (n) => esc(String(n || '').trim().split(' ')[0] || 'there')
const appOf     = (b) => CHAT_APPS[b.chat_app] || 'Viber or WhatsApp'

const manilaHour = () =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()))

export default async () => {
  if (!env().url || !env().key) return json({ skipped: 'not configured' })

  const out = { confirmed: 0, declined: 0, reminders: 0 }
  const select = 'id,ref,client_name,email,chat_app,service_name,booking_date,start_time,first_time,had_consultation,status_note'

  try {
    // ─── Confirmations ─────────────────────────────────────────────────────
    const toConfirm = await sb(
      `bookings?status=eq.confirmed&confirm_sent_at=is.null&email=not.is.null&select=${select}`)

    for (const b of toConfirm) {
      await sendEmail({
        to: b.email,
        replyTo: env().owner,
        subject: `Your appointment is confirmed — ${b.ref}`,
        html: emailShell(`
          <p>Hi ${firstName(b.client_name)},</p>
          <p>Good news — Izza has confirmed your appointment.</p>
          ${detailRows(b)}
          <p><strong>Before you come in</strong></p>
          <ul style="padding-left:18px;line-height:1.9;">
            <li>No coffee or alcohol for 24 hours beforehand</li>
            <li>No retinol or strong skincare for 30 days before</li>
            <li>No waxing or tinting your brows for 3 days before</li>
            <li>Come with bare brows and set aside about four hours</li>
          </ul>
          <p>Izza will send the exact address and directions on ${appOf(b)}.</p>
          <p>Need to reschedule? Message ${IZZA_NUMBER} at least 24 hours ahead.</p>
          <p style="margin-top:22px;">See you soon,<br/><strong>Izza</strong><br/>
          <span style="color:#8B7E6C;font-size:13px;">Bloom Bar MNL</span></p>
        `),
      })
      await stamp(b.id, 'confirm_sent_at')
      out.confirmed++
    }

    // ─── Declines ──────────────────────────────────────────────────────────
    const toDecline = await sb(
      `bookings?status=eq.declined&decline_sent_at=is.null&email=not.is.null&select=${select}`)

    for (const b of toDecline) {
      await sendEmail({
        to: b.email,
        replyTo: env().owner,
        subject: 'About your booking request',
        html: emailShell(`
          <p>Hi ${firstName(b.client_name)},</p>
          <p>Thank you for asking about a slot at Bloom Bar. Unfortunately Izza cannot
          take this one:</p>
          ${detailRows(b)}
          ${b.status_note ? `<p>${esc(b.status_note)}</p>` : ''}
          <p>She would still love to look after your brows — message her on ${appOf(b)} at
          <strong>${IZZA_NUMBER}</strong> and she will find you a time that works.</p>
          <p style="margin-top:22px;">Warmly,<br/><strong>Izza</strong><br/>
          <span style="color:#8B7E6C;font-size:13px;">Bloom Bar MNL</span></p>
        `),
      })
      await stamp(b.id, 'decline_sent_at')
      out.declined++
    }

    // ─── Reminders, 9am Manila the day before ──────────────────────────────
    if (manilaHour() === 9) {
      const target = addDays(todayManila(), 1)
      const due = await sb(
        `bookings?booking_date=eq.${target}&status=eq.confirmed&reminder_sent_at=is.null&select=${select}`)

      for (const b of due) {
        if (b.email) {
          await sendEmail({
            to: b.email,
            replyTo: env().owner,
            subject: `See you tomorrow at ${prettyTime(b.start_time)}`,
            html: emailShell(`
              <p>Hi ${firstName(b.client_name)},</p>
              <p>Just a reminder about your appointment tomorrow:</p>
              ${detailRows(b)}
              <p>No coffee or alcohol today, come with bare brows, and set aside
              about four hours.</p>
              <p>If anything has changed, message ${IZZA_NUMBER} as soon as you can.</p>
              <p style="margin-top:22px;">See you tomorrow,<br/><strong>Izza</strong></p>
            `),
          })
          out.reminders++
        }
        await stamp(b.id, 'reminder_sent_at')
      }
    }

    return json(out)
  } catch (e) {
    console.error('booking-mailer:', e)
    return json({ error: e.message, ...out }, 500)
  }
}

export const config = { schedule: '*/15 * * * *' }
