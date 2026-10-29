import { randomUUID } from 'node:crypto';
import { addDays, icsUtc, partsInZone, zonedToMs } from './time.js';

// Escape user-supplied text for an iCalendar value. Prevents line-break/field injection.
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// Lines must be folded at 75 bytes (continuation lines start with a space).
export function foldLine(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // the leading space counts
    }
    current += ch;
    bytes += b;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

// A fixed-time reminder at 6pm (business time) on the evening before a job day.
export function eveningBeforeMs(startMs, tz, hour = 18) {
  const p = partsInZone(startMs, tz);
  const dayBefore = addDays({ y: p.y, m: p.m, d: p.d }, -1);
  return zonedToMs({ ...dayBefore, h: hour }, tz);
}

// One calendar file per time block (a two-day job becomes two events).
// Each event gets two alerts: 6pm the evening before, and `alarmMinutes` before the start.
export function buildEvents({
  segments, summary, location, description, alarmMinutes = 60, eveningBeforeHour = 18,
  tz = 'Europe/London', nowMs = Date.now(),
}) {
  return segments.map((seg, i) => {
    const uid = `${randomUUID()}@auto-shine.co.uk`;
    const title = segments.length > 1 ? `${summary} (day ${i + 1}/${segments.length})` : summary;
    const evening = eveningBeforeHour === null ? [] : [
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:AutoShine job tomorrow',
      `TRIGGER;VALUE=DATE-TIME:${icsUtc(eveningBeforeMs(seg.start, tz, eveningBeforeHour))}`,
      'END:VALARM',
    ];
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AutoShine//Booking//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${icsUtc(nowMs)}`,
      `DTSTART:${icsUtc(seg.start)}`,
      `DTEND:${icsUtc(seg.end)}`,
      `SUMMARY:${escapeText(title)}`,
      `LOCATION:${escapeText(location)}`,
      `DESCRIPTION:${escapeText(description)}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      ...evening,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:AutoShine job',
      `TRIGGER:-PT${alarmMinutes}M`,
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return {
      filename: `${uid.split('@')[0]}.ics`,
      ics: lines.map(foldLine).join('\r\n') + '\r\n',
    };
  });
}
