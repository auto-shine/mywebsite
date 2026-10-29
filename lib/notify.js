// Instant "new booking" alerts. Two optional channels, both off unless configured:
//
//  1. EMAIL (recommended) via Resend (https://resend.com), free tier, no extra library.
//     Netlify environment variables:
//        RESEND_API_KEY     your Resend API key
//        ALERT_EMAIL_TO     where alerts go (one address, or several separated by commas)
//        ALERT_EMAIL_FROM   optional. Defaults to Resend's test sender (onboarding@resend.dev),
//                           which can only deliver to the email address the Resend account was made with.
//     The email is private to Jake, so it carries the full booking details.
//
//  2. PHONE PUSH via ntfy (https://ntfy.sh). Topics on ntfy.sh are PUBLIC to anyone who knows the
//     name, so the push deliberately contains NO name, phone number or street address.
//        NTFY_TOPIC         long random topic name
//
// Alerts never throw and never fail a booking: the calendar event is the record of the booking.

import { partsInZone } from './time.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DAYS_FULL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// 'Saturday 7 Nov' from a 'YYYY-MM-DD' date.
export function dayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${DAYS_FULL[partsInZone(Date.UTC(y, m - 1, d, 12), 'UTC').dow]} ${d} ${MONTHS[m - 1]}`;
}

export function whenLabel({ date, time, days = 1 }) {
  const [y, m, d] = date.split('-').map(Number);
  const dow = DAYS[partsInZone(Date.UTC(y, m - 1, d, 12), 'UTC').dow];
  return `${dow} ${d} ${MONTHS[m - 1]} ${time}${days > 1 ? ` (${days} days)` : ''}`;
}

export function bookingMessage({ service, size, date, time, total, isFrom, district, days = 1 }) {
  return `${service} (${size}) - ${whenLabel({ date, time, days })} - ${isFrom ? 'from ' : ''}£${total} - ${district}`;
}

// ---------- phone push (ntfy) ----------

export function createNotifier(env = process.env, fetchImpl = globalThis.fetch) {
  const topic = (env.NTFY_TOPIC || '').trim();
  const server = (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
  if (!topic) return null;
  return async function notify(message) {
    try {
      const res = await fetchImpl(`${server}/${encodeURIComponent(topic)}`, {
        method: 'POST',
        // header values must be plain ASCII; the £ sign is fine in the body
        headers: { Title: 'New AutoShine booking', Tags: 'car', Priority: '4' },
        body: message,
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) console.warn(`Booking alert not sent (ntfy replied ${res.status}).`);
    } catch (err) {
      console.warn('Booking alert not sent:', err?.message ?? err);
    }
  };
}

// ---------- email (Resend) ----------

const oneLine = (s) => String(s ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();

// Returns null when not configured. Otherwise an async function that resolves to
// { ok, status, detail }. It never throws, so a failed email can't break a booking.
export function createEmailNotifier(env = process.env, fetchImpl = globalThis.fetch) {
  const key = (env.RESEND_API_KEY || '').trim();
  const to = (env.ALERT_EMAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (!key || !to.length) return null;
  const from = (env.ALERT_EMAIL_FROM || 'AutoShine Bookings <onboarding@resend.dev>').trim();

  return async function sendEmail({ subject, text, replyTo }) {
    try {
      const body = { from, to, subject: oneLine(subject).slice(0, 200), text: String(text ?? '') };
      if (replyTo) body.reply_to = replyTo;
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return { ok: true, status: res.status, detail: '' };
      let detail = '';
      try { detail = oneLine(await res.text()).slice(0, 300); } catch { /* ignore */ }
      console.warn(`Booking email not sent (Resend replied ${res.status}): ${detail}`);
      return { ok: false, status: res.status, detail };
    } catch (err) {
      const detail = err?.message ?? String(err);
      console.warn('Booking email not sent:', detail);
      return { ok: false, status: 0, detail };
    }
  };
}

// The email Jake receives. Private channel, so full details are fine.
export function bookingEmail({ summary, when, description, replyTo }) {
  return {
    subject: `New booking: ${summary}`,
    text: [
      'New booking from your website',
      '',
      `When: ${when}`,
      '',
      description,
      '',
      'This is already in your Work calendar.',
    ].join('\n'),
    replyTo: replyTo || undefined,
  };
}
