// Small, dependency-free timezone helpers (uses the built-in Intl database).
// Instants are epoch milliseconds. Calendar dates are plain {y, m, d} objects.

const formatters = new Map();

function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

// Wall-clock parts of an instant in a timezone.
export function partsInZone(ms, tz) {
  const parts = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const date = { y: parts.year, m: parts.month, d: parts.day };
  return { ...date, h: parts.hour, mi: parts.minute, s: parts.second, dow: weekdayOf(date) };
}

function offsetAt(ms, tz) {
  const p = partsInZone(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// Wall-clock time in a timezone -> instant.
export function zonedToMs({ y, m, d, h = 0, mi = 0, s = 0 }, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  const off1 = offsetAt(guess, tz);
  let ms = guess - off1;
  const off2 = offsetAt(ms, tz);
  if (off2 !== off1) ms = guess - off2;
  return ms;
}

export function addDays({ y, m, d }, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// 1 = Monday ... 7 = Sunday
export function weekdayOf({ y, m, d }) {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function daysBetween(a, b) {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function dateKey({ y, m, d }) {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
  if (!m) return null;
  const date = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  // reject impossible dates such as 2026-02-31
  const back = addDays(date, 0);
  return back.y === date.y && back.m === date.m && back.d === date.d ? date : null;
}

export function timeLabel(minutesOfDay) {
  return `${pad(Math.floor(minutesOfDay / 60))}:${pad(minutesOfDay % 60)}`;
}

export function parseTimeLabel(label) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(label));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// ICS-style UTC stamp: 20261102T090000Z
export function icsUtc(ms) {
  const t = new Date(ms);
  return (
    `${pad(t.getUTCFullYear(), 4)}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`
  );
}
