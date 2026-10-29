// iCloud (Apple Calendar) connection over CalDAV.
//
// Required environment variables (set in Netlify > Site configuration > Environment variables):
//   ICLOUD_USERNAME        your Apple ID email
//   ICLOUD_APP_PASSWORD    an app-specific password (appleid.apple.com > Sign-In and Security)
//   ICLOUD_CALENDAR_NAME   the calendar new bookings are written to (e.g. "Work")
// Optional:
//   ICLOUD_BUSY_CALENDARS  comma-separated calendars that block availability
//                          (defaults to just the booking calendar)

import { parseBusy } from './busy.js';
import { BUSINESS } from './config.js';

const label = (cal) => (typeof cal.displayName === 'string' ? cal.displayName : '').trim();

export function createICloudCalendar(env = process.env) {
  const username = env.ICLOUD_USERNAME;
  const password = env.ICLOUD_APP_PASSWORD;
  const bookingName = (env.ICLOUD_CALENDAR_NAME || '').trim();
  const busyNames = (env.ICLOUD_BUSY_CALENDARS || bookingName)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let cache = null;

  async function connect() {
    if (cache) return cache;
    if (!username || !password || !bookingName) {
      throw new Error('Calendar is not configured (ICLOUD_USERNAME, ICLOUD_APP_PASSWORD, ICLOUD_CALENDAR_NAME).');
    }
    const { createDAVClient } = await import('tsdav');
    const client = await createDAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: { username, password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    const calendars = await client.fetchCalendars();
    const find = (name) => calendars.find((c) => label(c).toLowerCase() === name.toLowerCase());

    const booking = find(bookingName);
    if (!booking) {
      const names = calendars.map(label).filter(Boolean).join(', ');
      throw new Error(`Calendar "${bookingName}" not found. Calendars on this account: ${names}`);
    }
    const busyCals = busyNames.map((n) => {
      const c = find(n);
      if (!c) throw new Error(`Busy calendar "${n}" not found.`);
      return c;
    });
    cache = { client, booking, busyCals };
    return cache;
  }

  return {
    // All busy ranges between two instants (epoch ms), across the busy calendars.
    async fetchBusy({ fromMs, toMs }) {
      const { client, busyCals } = await connect();
      const texts = [];
      for (const calendar of busyCals) {
        const objects = await client.fetchCalendarObjects({
          calendar,
          timeRange: {
            start: new Date(fromMs - 86400000).toISOString(),
            end: new Date(toMs).toISOString(),
          },
        });
        for (const o of objects) if (typeof o.data === 'string') texts.push(o.data);
      }
      return parseBusy(texts, {
        rangeStartMs: fromMs,
        rangeEndMs: toMs,
        tz: BUSINESS.timezone,
        onWarning: (m) => console.warn(m),
      });
    },

    // events: [{ filename, ics }]
    async createEvents(events) {
      const { client, booking } = await connect();
      for (const e of events) {
        const res = await client.createCalendarObject({
          calendar: booking,
          filename: e.filename,
          iCalString: e.ics,
        });
        if (res && res.ok === false) {
          throw new Error(`Calendar rejected the booking (HTTP ${res.status}).`);
        }
      }
    },
  };
}
