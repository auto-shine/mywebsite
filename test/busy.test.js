import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBusy } from '../lib/busy.js';
import { zonedToMs } from '../lib/time.js';

const TZ = 'Europe/London';
const at = (y, m, d, h = 0, mi = 0) => zonedToMs({ y, m, d, h, mi }, TZ);
const wrap = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const ev = (lines) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const RANGE = { rangeStartMs: at(2026, 10, 1), rangeEndMs: at(2027, 3, 1), tz: TZ };
const run = (ics, extra = {}) => parseBusy([ics], { ...RANGE, ...extra });
const iv = (s, e) => ({ start: s, end: e });

test('timed event in UTC', () => {
  const r = run(wrap(ev(['UID:a', 'DTSTART:20261110T090000Z', 'DTEND:20261110T110000Z'])));
  assert.deepEqual(r, [iv(Date.UTC(2026, 10, 10, 9), Date.UTC(2026, 10, 10, 11))]);
});

test('timed event with a London TZID, in summer (BST) and winter (GMT)', () => {
  const summer = run(wrap(ev(['UID:s', 'DTSTART;TZID=Europe/London:20261020T090000', 'DTEND;TZID=Europe/London:20261020T100000'])));
  assert.deepEqual(summer, [iv(Date.UTC(2026, 9, 20, 8), Date.UTC(2026, 9, 20, 9))]); // 09:00 BST = 08:00Z
  const winter = run(wrap(ev(['UID:w', 'DTSTART;TZID=Europe/London:20261110T090000', 'DTEND;TZID=Europe/London:20261110T100000'])));
  assert.deepEqual(winter, [iv(Date.UTC(2026, 10, 10, 9), Date.UTC(2026, 10, 10, 10))]);
});

test('event in a different timezone is converted correctly', () => {
  const r = run(wrap(ev(['UID:ny', 'DTSTART;TZID=America/New_York:20261110T090000', 'DTEND;TZID=America/New_York:20261110T100000'])));
  assert.deepEqual(r, [iv(Date.UTC(2026, 10, 10, 14), Date.UTC(2026, 10, 10, 15))]);
});

test('all-day event blocks the whole local day (end date is exclusive)', () => {
  const r = run(wrap(ev(['UID:ad', 'DTSTART;VALUE=DATE:20261111', 'DTEND;VALUE=DATE:20261112'])));
  assert.deepEqual(r, [iv(at(2026, 11, 11), at(2026, 11, 12))]);
});

test('multi-day all-day event (holiday)', () => {
  const r = run(wrap(ev(['UID:hol', 'DTSTART;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20261205'])));
  assert.deepEqual(r, [iv(at(2026, 12, 1), at(2026, 12, 5))]);
});

test('all-day event with no end is one day', () => {
  const r = run(wrap(ev(['UID:x', 'DTSTART;VALUE=DATE:20261111'])));
  assert.deepEqual(r, [iv(at(2026, 11, 11), at(2026, 11, 12))]);
});

test('events marked Free, cancelled events and events outside the range are ignored', () => {
  const r = run(wrap(
    ev(['UID:f', 'DTSTART:20261110T090000Z', 'DTEND:20261110T110000Z', 'TRANSP:TRANSPARENT']),
    ev(['UID:c', 'DTSTART:20261111T090000Z', 'DTEND:20261111T110000Z', 'STATUS:CANCELLED']),
    ev(['UID:o', 'DTSTART:20250101T090000Z', 'DTEND:20250101T110000Z']),
    ev(['UID:z', 'DTSTART:20261112T090000Z', 'DTEND:20261112T090000Z']), // zero length
  ));
  assert.deepEqual(r, []);
});

test('DURATION instead of DTEND, and an alarm inside the event is not mistaken for properties', () => {
  const r = run(wrap(ev([
    'UID:d', 'DTSTART:20261110T090000Z', 'DURATION:PT1H30M',
    'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:x', 'END:VALARM',
  ])));
  assert.deepEqual(r, [iv(Date.UTC(2026, 10, 10, 9), Date.UTC(2026, 10, 10, 10, 30))]);
});

test('long lines folded in the file are unfolded', () => {
  const r = run(wrap(ev(['UID:fold', 'SUMMARY:A very long title that was fol', ' ded by the calendar app', 'DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z'])));
  assert.equal(r.length, 1);
});

test('weekly recurring event (every Monday 18:00-19:00 London), across the clocks changing', () => {
  const r = run(wrap(ev([
    'UID:wk', 'DTSTART;TZID=Europe/London:20261019T180000', 'DTEND;TZID=Europe/London:20261019T190000',
    'RRULE:FREQ=WEEKLY;COUNT=4',
  ])));
  assert.equal(r.length, 4); // 19 Oct, 26 Oct, 2 Nov, 9 Nov
});

test('weekly recurrence keeps the same wall-clock time after the clocks go back (25 Oct 2026)', () => {
  const r = run(wrap(ev([
    'UID:wk2', 'DTSTART;TZID=Europe/London:20261019T090000', 'DTEND;TZID=Europe/London:20261019T100000',
    'RRULE:FREQ=WEEKLY;COUNT=3',
  ])), { rangeStartMs: at(2026, 10, 1) });
  assert.deepEqual(r.map((x) => x.start), [
    Date.UTC(2026, 9, 19, 8),  // BST
    Date.UTC(2026, 9, 26, 9),  // GMT: still 09:00 local
    Date.UTC(2026, 10, 2, 9),
  ]);
});

test('weekly with BYDAY, INTERVAL and UNTIL', () => {
  const r = run(wrap(ev([
    'UID:bd', 'DTSTART:20261102T100000Z', 'DTEND:20261102T110000Z',
    'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261130T235959Z',
  ])));
  const days = r.map((x) => new Date(x.start).toISOString().slice(0, 10));
  assert.deepEqual(days, ['2026-11-02', '2026-11-04', '2026-11-16', '2026-11-18', '2026-11-30']);
});

test('daily recurrence with COUNT, and EXDATE removes one occurrence', () => {
  const r = run(wrap(ev([
    'UID:dly', 'DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z',
    'RRULE:FREQ=DAILY;COUNT=4', 'EXDATE:20261111T090000Z',
  ])));
  const days = r.map((x) => new Date(x.start).toISOString().slice(0, 10));
  assert.deepEqual(days, ['2026-11-10', '2026-11-12', '2026-11-13']);
});

test('moved occurrence: the original slot frees up and the new slot is busy', () => {
  const r = run(wrap(
    ev(['UID:m', 'DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z', 'RRULE:FREQ=DAILY;COUNT=3']),
    ev(['UID:m', 'RECURRENCE-ID:20261111T090000Z', 'DTSTART:20261111T150000Z', 'DTEND:20261111T160000Z']),
  ));
  assert.deepEqual(r.map((x) => new Date(x.start).toISOString()), [
    '2026-11-10T09:00:00.000Z', '2026-11-11T15:00:00.000Z', '2026-11-12T09:00:00.000Z',
  ]);
});

test('cancelled single occurrence of a recurring event is removed', () => {
  const r = run(wrap(
    ev(['UID:cx', 'DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z', 'RRULE:FREQ=DAILY;COUNT=3']),
    ev(['UID:cx', 'RECURRENCE-ID:20261111T090000Z', 'DTSTART:20261111T090000Z', 'DTEND:20261111T100000Z', 'STATUS:CANCELLED']),
  ));
  assert.equal(r.length, 2);
});

test('monthly: 2nd Tuesday and last Friday; monthly by date', () => {
  const second = run(wrap(ev(['UID:t', 'DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z', 'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3'])));
  assert.deepEqual(second.map((x) => new Date(x.start).toISOString().slice(0, 10)), ['2026-11-10', '2026-12-08', '2027-01-12']);
  const last = run(wrap(ev(['UID:l', 'DTSTART:20261127T090000Z', 'DTEND:20261127T100000Z', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3'])));
  assert.deepEqual(last.map((x) => new Date(x.start).toISOString().slice(0, 10)), ['2026-11-27', '2026-12-25', '2027-01-29']);
  const date = run(wrap(ev(['UID:d', 'DTSTART:20261031T090000Z', 'DTEND:20261031T100000Z', 'RRULE:FREQ=MONTHLY;COUNT=4'])));
  // 31st only exists in some months
  assert.deepEqual(date.map((x) => new Date(x.start).toISOString().slice(0, 10)), ['2026-10-31', '2026-12-31', '2027-01-31']);
});

test('yearly all-day event (e.g. a birthday day off)', () => {
  const r = parseBusy([wrap(ev(['UID:y', 'DTSTART;VALUE=DATE:20251225', 'DTEND;VALUE=DATE:20251226', 'RRULE:FREQ=YEARLY']))], { ...RANGE });
  assert.deepEqual(r, [iv(at(2026, 12, 25), at(2026, 12, 26))]);
});

test('weekly all-day recurring event', () => {
  const r = run(wrap(ev(['UID:ws', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102', 'RRULE:FREQ=WEEKLY;COUNT=3'])));
  assert.deepEqual(r, [
    iv(at(2026, 11, 1), at(2026, 11, 2)),
    iv(at(2026, 11, 8), at(2026, 11, 9)),
    iv(at(2026, 11, 15), at(2026, 11, 16)),
  ]);
});

test('an old recurring event that started years ago still shows up in range', () => {
  const r = run(wrap(ev(['UID:old', 'DTSTART:20200106T080000Z', 'DTEND:20200106T090000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO'])));
  const mondays = r.filter((x) => x.start >= at(2026, 11, 1) && x.start < at(2026, 12, 1));
  assert.equal(mondays.length, 5); // Mondays 2, 9, 16, 23 and 30 November
});

test('unsupported repeat patterns over-block (same weekday weekly) and warn', () => {
  const warnings = [];
  const r = run(wrap(ev(['UID:u', 'SUMMARY:Odd', 'DTSTART:20261102T090000Z', 'DTEND:20261102T100000Z', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE;BYSETPOS=-1'])), { onWarning: (m) => warnings.push(m) });
  assert.ok(r.length >= 8, `blocked ${r.length}`);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Odd/);
});

test('garbage input does not crash', () => {
  assert.deepEqual(run('not a calendar'), []);
  assert.deepEqual(run(wrap(ev(['UID:q', 'DTSTART:banana']))), []);
  assert.deepEqual(run(''), []);
});
