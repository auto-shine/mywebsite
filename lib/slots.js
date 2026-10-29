import { SERVICES, ZONES } from './config.js';
import { addDays, dateKey, parseDateKey, parseTimeLabel, partsInZone, timeLabel, weekdayOf, zonedToMs } from './time.js';

const MIN = 60000;

// How long a job takes and how much travel gap it needs.
export function planFor({ service, zone, extraMinutes = 0 }) {
  const svc = SERVICES[service];
  const z = ZONES.find((x) => x.id === zone);
  return {
    fullDay: svc.fullDay,
    days: svc.days,
    minutes: svc.fullDay ? 0 : svc.minutes + extraMinutes,
    bufferMinutes: z.bufferMinutes,
  };
}

function windowFor(date, hours, tz) {
  const h = hours[weekdayOf(date)];
  if (!h) return null;
  return {
    open: zonedToMs({ ...date, h: h[0] }, tz),
    close: zonedToMs({ ...date, h: h[1] }, tz),
    openMinutes: h[0] * 60,
    closeMinutes: h[1] * 60,
  };
}

function nextWorkingDate(date, hours) {
  let d = date;
  for (let i = 0; i < 14; i++) {
    d = addDays(d, 1);
    if (hours[weekdayOf(d)]) return d;
  }
  return null;
}

// The time block(s) a job occupies when it starts on `date` at `startMinutes` after midnight.
// Returns null if the job can't fit (outside opening hours, or not a valid full-day start).
export function segmentsAt({ date, startMinutes, plan, hours, tz }) {
  const win = windowFor(date, hours, tz);
  if (!win) return null;

  if (!plan.fullDay) {
    if (startMinutes < win.openMinutes) return null;
    if (startMinutes + plan.minutes > win.closeMinutes) return null;
    const start = zonedToMs({ ...date, h: Math.floor(startMinutes / 60), mi: startMinutes % 60 }, tz);
    return [{ date, start, end: start + plan.minutes * MIN }];
  }

  if (startMinutes !== win.openMinutes) return null;
  const segs = [{ date, start: win.open, end: win.close }];
  let d = date;
  for (let i = 1; i < plan.days; i++) {
    d = nextWorkingDate(d, hours);
    if (!d) return null;
    const w = windowFor(d, hours, tz);
    segs.push({ date: d, start: w.open, end: w.close });
  }
  return segs;
}

// Travel buffer applies to the first start and last end only.
function conflicts(segs, busy, bufferMinutes) {
  const buf = bufferMinutes * MIN;
  return segs.some((seg, i) => {
    const start = seg.start - (i === 0 ? buf : 0);
    const end = seg.end + (i === segs.length - 1 ? buf : 0);
    return busy.some((b) => b.start < end && b.end > start);
  });
}

// Returns [{ date: 'YYYY-MM-DD', times: ['08:00', ...] }] for days that have at least one free start time.
export function findSlots({ busy, plan, hours, rules, tz, nowMs, onlyDate = null }) {
  const today = (() => {
    const p = partsInZone(nowMs, tz);
    return { y: p.y, m: p.m, d: p.d };
  })();
  const earliest = nowMs + rules.minNoticeHours * 60 * MIN;
  const out = [];

  for (let i = 0; i <= rules.maxDaysAhead; i++) {
    const date = addDays(today, i);
    const key = dateKey(date);
    if (onlyDate && key !== onlyDate) continue;
    const win = windowFor(date, hours, tz);
    if (!win) continue;

    const candidates = [];
    if (plan.fullDay) {
      candidates.push(win.openMinutes);
    } else {
      for (let t = win.openMinutes; t + plan.minutes <= win.closeMinutes; t += rules.slotStepMinutes) {
        candidates.push(t);
      }
    }

    const times = [];
    for (const startMinutes of candidates) {
      const segs = segmentsAt({ date, startMinutes, plan, hours, tz });
      if (!segs) continue;
      if (segs[0].start < earliest) continue;
      if (conflicts(segs, busy, plan.bufferMinutes)) continue;
      times.push(timeLabel(startMinutes));
    }
    if (times.length) out.push({ date: key, times });
  }
  return out;
}

// Is this exact date + time still free? (Used again at booking time.)
export function isSlotFree({ date, time, busy, plan, hours, rules, tz, nowMs }) {
  const parsed = parseDateKey(date);
  const minutes = parseTimeLabel(time);
  if (!parsed || minutes === null) return false;
  const day = findSlots({ busy, plan, hours, rules, tz, nowMs, onlyDate: date });
  return day.some((d) => d.date === date && d.times.includes(time));
}
