// Turns the raw iCalendar (.ics) text coming back from iCloud into "busy" time ranges.
// Handles timed and all-day events, time zones, recurring events (daily/weekly/monthly/yearly),
// excluded dates, moved or cancelled single occurrences, and events marked "Free".

import { addDays, daysBetween, partsInZone, weekdayOf, zonedToMs } from './time.js';

const DAY_MS = 86400000;
const BYDAY_MAP = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

function unfold(text) {
  return String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function splitProperty(line) {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) { colon = i; break; }
  }
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rawParams] = left.split(';');
  const params = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

function validZone(tz, fallback) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

function parseIcsDate(value, params, defaultTz) {
  const v = value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { allDay: true, date: { y: +m[1], m: +m[2], d: +m[3] } };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const local = { y: +m[1], m: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6] };
  if (m[7] === 'Z') {
    return { allDay: false, ms: Date.UTC(local.y, local.m - 1, local.d, local.h, local.mi, local.s), local, tz: 'UTC' };
  }
  const tz = params.TZID ? validZone(params.TZID, defaultTz) : defaultTz;
  return { allDay: false, ms: zonedToMs(local, tz), local, tz };
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const [w, d, h, mi, s] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x || 0));
  return sign * (((w * 7 + d) * 24 + h) * 3600 + mi * 60 + s) * 1000;
}

function parseRule(text) {
  const rule = {};
  for (const part of text.split(';')) {
    const [k, v] = part.split('=');
    if (k) rule[k.toUpperCase()] = v;
  }
  return rule;
}

function readEvents(icsText, defaultTz) {
  const events = [];
  let cur = null;
  let nested = 0;
  for (const line of unfold(icsText)) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') { cur = []; nested = 0; continue; }
    if (!cur) continue;
    if (upper === 'END:VEVENT') {
      const ev = buildEvent(cur, defaultTz);
      if (ev) events.push(ev);
      cur = null;
      continue;
    }
    if (upper.startsWith('BEGIN:')) { nested++; continue; }
    if (upper.startsWith('END:')) { nested--; continue; }
    if (nested > 0) continue; // inside a VALARM etc.
    const prop = splitProperty(line);
    if (prop) cur.push(prop);
  }
  return events;
}

function buildEvent(props, defaultTz) {
  const first = (n) => props.find((p) => p.name === n);
  const all = (n) => props.filter((p) => p.name === n);

  const dtstart = first('DTSTART');
  if (!dtstart) return null;
  const start = parseIcsDate(dtstart.value, dtstart.params, defaultTz);
  if (!start) return null;

  let end = null;
  const dtend = first('DTEND');
  const dur = first('DURATION');
  if (dtend) end = parseIcsDate(dtend.value, dtend.params, defaultTz);
  let durationMs = null;
  if (!end && dur) durationMs = parseDuration(dur.value);

  const ev = {
    uid: first('UID')?.value ?? '',
    status: (first('STATUS')?.value ?? '').toUpperCase(),
    transparent: (first('TRANSP')?.value ?? '').toUpperCase() === 'TRANSPARENT',
    summary: first('SUMMARY')?.value ?? '',
    start,
    allDay: start.allDay,
    rule: first('RRULE') ? parseRule(first('RRULE').value) : null,
    exdates: [],
    recurrenceId: null,
  };

  if (start.allDay) {
    let endDate = end?.date;
    if (!endDate) {
      const days = durationMs ? Math.max(1, Math.round(durationMs / DAY_MS)) : 1;
      endDate = addDays(start.date, days);
    }
    ev.spanDays = Math.max(1, daysBetween(start.date, endDate));
  } else {
    ev.durationMs = end ? Math.max(0, end.ms - start.ms) : Math.max(0, durationMs ?? 0);
    ev.tz = start.tz;
  }

  for (const p of all('EXDATE')) {
    for (const v of p.value.split(',')) {
      const parsed = parseIcsDate(v, p.params, defaultTz);
      if (parsed) ev.exdates.push(parsed);
    }
  }
  const rid = first('RECURRENCE-ID');
  if (rid) ev.recurrenceId = parseIcsDate(rid.value, rid.params, defaultTz);
  return ev;
}

// ---------- recurrence ----------

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parseByDay(text) {
  if (!text) return null;
  return text.split(',').map((s) => {
    const m = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(s.trim().toUpperCase());
    return m ? { n: m[1] ? Number(m[1]) : 0, dow: BYDAY_MAP[m[2]] } : null;
  }).filter(Boolean);
}

const SUPPORTED_KEYS = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST']);

function nthWeekdayOfMonth(y, m, dow, n) {
  const last = daysInMonth(y, m);
  const matches = [];
  for (let d = 1; d <= last; d++) if (weekdayOf({ y, m, d }) === dow) matches.push(d);
  const idx = n > 0 ? n - 1 : matches.length + n;
  return matches[idx] ?? null;
}

// Yields local calendar dates for each occurrence, in order, until `limit`.
function* occurrenceDates(startDate, rawRule, limit, flags) {
  let rule = rawRule;
  const unsupported = Object.keys(rule).some((k) => !SUPPORTED_KEYS.has(k));
  if (
    unsupported ||
    !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.FREQ) ||
    (rule.FREQ === 'YEARLY' && rule.BYDAY)
  ) {
    // Over-block rather than risk a double booking: same weekday, every week.
    flags.unsupported = true;
    rule = { FREQ: 'WEEKLY', INTERVAL: '1' };
  }
  const freq = rule.FREQ;
  const iv = Math.max(1, Number(rule.INTERVAL || 1));
  const byday = parseByDay(rule.BYDAY);
  const bd = byday;
  const bymonthday = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;
  const bymonth = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : null;
  const beyond = (d) => daysBetween(limit, d) > 0;
  const notBefore = (d) => daysBetween(startDate, d) >= 0;

  if (freq === 'DAILY') {
    for (let i = 0; ; i += iv) {
      const d = addDays(startDate, i);
      if (beyond(d)) return;
      if (bymonth && !bymonth.includes(d.m)) continue;
      if (byday && !byday.some((b) => b.dow === weekdayOf(d))) continue;
      yield d;
    }
  } else if (freq === 'WEEKLY') {
    const dows = (bd ? bd.map((b) => b.dow) : [weekdayOf(startDate)]).sort((a, b) => a - b);
    const weekStart = addDays(startDate, -(weekdayOf(startDate) - 1));
    for (let w = 0; ; w += iv) {
      const base = addDays(weekStart, 7 * w);
      if (beyond(base)) return;
      for (const dow of dows) {
        const d = addDays(base, dow - 1);
        if (!notBefore(d)) continue;
        if (beyond(d)) return;
        yield d;
      }
    }
  } else if (freq === 'MONTHLY') {
    for (let i = 0; ; i += iv) {
      const total = startDate.m - 1 + i;
      const y = startDate.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      if (beyond({ y, m, d: 1 })) return;
      if (bymonth && !bymonth.includes(m)) continue;
      const last = daysInMonth(y, m);
      let days = [];
      if (bymonthday) {
        days = bymonthday.map((x) => (x > 0 ? x : last + 1 + x)).filter((x) => x >= 1 && x <= last);
      } else if (byday) {
        for (const b of byday) {
          if (b.n) {
            const d = nthWeekdayOfMonth(y, m, b.dow, b.n);
            if (d) days.push(d);
          } else {
            for (let d = 1; d <= last; d++) if (weekdayOf({ y, m, d }) === b.dow) days.push(d);
          }
        }
      } else if (startDate.d <= last) {
        days = [startDate.d];
      }
      days = [...new Set(days)].sort((a, b) => a - b);
      for (const d of days) {
        const date = { y, m, d };
        if (!notBefore(date)) continue;
        if (beyond(date)) return;
        yield date;
      }
    }
  } else if (freq === 'YEARLY') {
    for (let i = 0; ; i += iv) {
      const y = startDate.y + i;
      if (beyond({ y, m: 1, d: 1 })) return;
      const months = (bymonth ?? [startDate.m]).slice().sort((a, b) => a - b);
      for (const m of months) {
        const last = daysInMonth(y, m);
        const days = (bymonthday ?? [startDate.d])
          .map((x) => (x > 0 ? x : last + 1 + x))
          .filter((x) => x >= 1 && x <= last)
          .sort((a, b) => a - b);
        for (const d of days) {
          const date = { y, m, d };
          if (!notBefore(date)) continue;
          if (beyond(date)) return;
          yield date;
        }
      }
    }
  }
}

function untilMs(untilText, defaultTz) {
  const p = parseIcsDate(untilText, {}, defaultTz);
  if (!p) return Infinity;
  if (p.allDay) return zonedToMs({ ...addDays(p.date, 1) }, defaultTz) - 1; // whole last day
  return p.ms;
}

function occurrenceInterval(ev, date, tz) {
  if (ev.allDay) {
    return {
      start: zonedToMs(date, tz),
      end: zonedToMs(addDays(date, ev.spanDays), tz),
      key: dateKeyOf(date),
    };
  }
  const l = ev.start.local;
  const start = zonedToMs({ ...date, h: l.h, mi: l.mi, s: l.s }, ev.tz);
  return { start, end: start + ev.durationMs, key: String(start) };
}

function dateKeyOf({ y, m, d }) {
  return `${y}-${m}-${d}`;
}

export function parseBusy(icsTexts, { rangeStartMs, rangeEndMs, tz, onWarning = () => {} }) {
  const events = icsTexts.flatMap((t) => readEvents(t, tz));

  // Single occurrences that were moved or cancelled replace the generated occurrence.
  const overridden = new Set();
  for (const ev of events) {
    if (ev.recurrenceId) {
      const r = ev.recurrenceId;
      overridden.add(`${ev.uid}|${r.allDay ? dateKeyOf(r.date) : r.ms}`);
    }
  }

  const busy = [];
  const push = (start, end) => {
    if (end > start && start < rangeEndMs && end > rangeStartMs) busy.push({ start, end });
  };

  for (const ev of events) {
    if (ev.status === 'CANCELLED' || ev.transparent) continue;

    const evTz = ev.allDay ? tz : ev.tz;
    if (!ev.rule) {
      if (ev.allDay) {
        push(zonedToMs(ev.start.date, tz), zonedToMs(addDays(ev.start.date, ev.spanDays), tz));
      } else {
        push(ev.start.ms, ev.start.ms + ev.durationMs);
      }
      continue;
    }

    const startDate = ev.allDay
      ? ev.start.date
      : { y: ev.start.local.y, m: ev.start.local.m, d: ev.start.local.d };
    const limitParts = partsInZone(rangeEndMs, evTz);
    const limit = addDays({ y: limitParts.y, m: limitParts.m, d: limitParts.d }, 1);
    const count = ev.rule.COUNT ? Number(ev.rule.COUNT) : Infinity;
    const until = ev.rule.UNTIL ? untilMs(ev.rule.UNTIL, evTz) : Infinity;
    const flags = { unsupported: false };

    const exMs = new Set(ev.exdates.filter((e) => !e.allDay).map((e) => e.ms));
    const exDays = new Set(ev.exdates.map((e) => dateKeyOf(e.allDay ? e.date : e.local)));

    let n = 0;
    for (const date of occurrenceDates(startDate, ev.rule, limit, flags)) {
      const occ = occurrenceInterval(ev, date, evTz);
      if (occ.start > until) break;
      n++;
      if (n > count) break;
      const skip =
        exMs.has(occ.start) ||
        (ev.allDay ? exDays.has(dateKeyOf(date)) : false) ||
        overridden.has(`${ev.uid}|${occ.key}`);
      if (!skip) push(occ.start, occ.end);
    }
    if (flags.unsupported) {
      onWarning(`Recurring event "${ev.summary}" uses a repeat pattern that isn't fully supported; blocking the same weekday every week to be safe.`);
    }
  }

  busy.sort((a, b) => a.start - b.start);
  return busy;
}
