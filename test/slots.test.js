import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKING_RULES, WORKING_HOURS } from '../lib/config.js';
import { findSlots, isSlotFree, planFor, segmentsAt } from '../lib/slots.js';
import { zonedToMs } from '../lib/time.js';

const TZ = 'Europe/London';
const at = (y, m, d, h = 0, mi = 0) => zonedToMs({ y, m, d, h, mi }, TZ);
const busy = (start, end) => ({ start, end });
// Monday 2 Nov 2026, 07:00. With 24h notice the first bookable moment is Tuesday 07:00.
const NOW = at(2026, 11, 2, 7);
const slots = (plan, events = [], extra = {}) =>
  findSlots({ busy: events, plan, hours: WORKING_HOURS, rules: { ...BOOKING_RULES, ...extra.rules }, tz: TZ, nowMs: extra.nowMs ?? NOW });
const day = (result, key) => result.find((d) => d.date === key)?.times ?? [];

const EFD_Z1 = planFor({ service: 'EFD', zone: 'Z1' });

test('plans: durations, add-on time, full-day jobs, travel buffers per zone', () => {
  assert.deepEqual(planFor({ service: 'EFD', zone: 'Z1' }), { fullDay: false, days: 1, minutes: 180, bufferMinutes: 30 });
  assert.equal(planFor({ service: 'EFD', zone: 'Z2', extraMinutes: 45 }).minutes, 225);
  assert.equal(planFor({ service: 'EFD', zone: 'Z3' }).bufferMinutes, 60);
  const cc = planFor({ service: 'CC', zone: 'Z2', extraMinutes: 999 });
  assert.equal(cc.fullDay, true);
  assert.equal(cc.days, 2);
  assert.equal(cc.minutes, 0); // add-ons don't extend a full-day job
});

test('empty calendar: EFD can start every hour 08:00-15:00 (must finish by 18:00)', () => {
  const r = slots(EFD_Z1);
  assert.deepEqual(day(r, '2026-11-03'), ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00']);
});

test('24 hour notice: nothing today, and nothing before 07:00 tomorrow', () => {
  const r = slots(EFD_Z1);
  assert.deepEqual(day(r, '2026-11-02'), []);
  const later = slots(EFD_Z1, [], { nowMs: at(2026, 11, 2, 12) }); // Mon midday -> earliest Tue 12:00
  assert.deepEqual(day(later, '2026-11-03'), ['12:00', '13:00', '14:00', '15:00']);
});

test('Sundays are closed, Saturdays open', () => {
  const r = slots(EFD_Z1);
  assert.deepEqual(day(r, '2026-11-08'), []);
  assert.equal(day(r, '2026-11-07').length, 8);
  assert.ok(!r.some((d) => d.date === '2026-11-08'));
});

test('a booking keeps a travel gap either side (bigger gap for farther zones)', () => {
  const event = [busy(at(2026, 11, 3, 10), at(2026, 11, 3, 12, 15))];
  assert.deepEqual(day(slots(planFor({ service: 'EFD', zone: 'Z1' }), event), '2026-11-03'), ['13:00', '14:00', '15:00']); // needs 12:45
  assert.deepEqual(day(slots(planFor({ service: 'EFD', zone: 'Z3' }), event), '2026-11-03'), ['14:00', '15:00']);          // needs 13:15
});

test('a job that ends exactly at the start of the gap is allowed', () => {
  // Z1 buffer 30. Event 13:30-14:30; a 3h job 08:00-11:00 ends well before; 10:00-13:00 ends 30 min before = ok.
  const event = [busy(at(2026, 11, 3, 13, 30), at(2026, 11, 3, 14, 30))];
  const times = day(slots(EFD_Z1, event), '2026-11-03');
  assert.ok(times.includes('10:00'));
  assert.ok(!times.includes('11:00'));
  assert.ok(!times.includes('12:00'));
});

test('an all-day event (day off / holiday) blocks the day, including full-day jobs', () => {
  const off = [busy(at(2026, 11, 4), at(2026, 11, 5))];
  assert.deepEqual(day(slots(EFD_Z1, off), '2026-11-04'), []);
  assert.deepEqual(day(slots(planFor({ service: 'PC1', zone: 'Z1' }), off), '2026-11-04'), []);
});

test('full-day jobs start at 08:00 only, and any clash in the day blocks them', () => {
  const pc1 = planFor({ service: 'PC1', zone: 'Z1' });
  assert.deepEqual(day(slots(pc1), '2026-11-03'), ['08:00']);
  assert.deepEqual(day(slots(pc1, [busy(at(2026, 11, 3, 17), at(2026, 11, 3, 17, 30))]), '2026-11-03'), []);
  assert.deepEqual(day(slots(pc1, [busy(at(2026, 11, 3, 6), at(2026, 11, 3, 7, 40))]), '2026-11-03'), []); // inside the 30 min lead gap
  assert.deepEqual(day(slots(pc1, [busy(at(2026, 11, 3, 6), at(2026, 11, 3, 7, 30))]), '2026-11-03'), ['08:00']);
});

test('two-day ceramic coating needs two working days in a row; skips Sunday', () => {
  const cc = planFor({ service: 'CC', zone: 'Z1' });
  const r = slots(cc);
  assert.deepEqual(day(r, '2026-11-07'), ['08:00']); // Sat + Mon
  const segs = segmentsAt({ date: { y: 2026, m: 11, d: 7 }, startMinutes: 480, plan: cc, hours: WORKING_HOURS, tz: TZ });
  assert.equal(segs.length, 2);
  assert.equal(segs[1].start, at(2026, 11, 9, 8)); // Monday, not Sunday
  // Monday blocked -> Saturday no longer offered
  const r2 = slots(cc, [busy(at(2026, 11, 9, 12), at(2026, 11, 9, 13))]);
  assert.deepEqual(day(r2, '2026-11-07'), []);
  assert.deepEqual(day(r2, '2026-11-05'), ['08:00']); // Thu + Fri still fine
});

test('travel gap after a two-day job applies after the last day', () => {
  const cc = planFor({ service: 'CC', zone: 'Z1' }); // buffer 30
  const clash = [busy(at(2026, 11, 4, 18, 15), at(2026, 11, 4, 19))];   // Wed 18:15 clashes with Tue+Wed job (ends 18:00 +30)
  const fine = [busy(at(2026, 11, 4, 18, 30), at(2026, 11, 4, 19))];
  assert.ok(!day(slots(cc, clash), '2026-11-03').includes('08:00'));
  assert.ok(day(slots(cc, fine), '2026-11-03').includes('08:00'));
});

test('long add-on time pushes the last start earlier', () => {
  const longer = planFor({ service: 'EFD', zone: 'Z1', extraMinutes: 60 + 45 }); // 4h45
  const times = day(slots(longer), '2026-11-03');
  assert.equal(times.at(-1), '13:00'); // 13:00 + 4h45 = 17:45
  assert.ok(!times.includes('14:00'));
});

test('booking window ends after maxDaysAhead', () => {
  const r = slots(EFD_Z1);
  const last = r.at(-1).date;
  assert.ok(last <= '2027-01-01', last);
  assert.ok(!r.some((d) => d.date > '2027-01-01'));
});

test('clock change: 08:00 in October (BST) and in November (GMT) are the right instants', () => {
  const bst = segmentsAt({ date: { y: 2026, m: 10, d: 20 }, startMinutes: 480, plan: EFD_Z1, hours: WORKING_HOURS, tz: TZ });
  assert.equal(bst[0].start, Date.UTC(2026, 9, 20, 7));
  const gmt = segmentsAt({ date: { y: 2026, m: 10, d: 26 }, startMinutes: 480, plan: EFD_Z1, hours: WORKING_HOURS, tz: TZ });
  assert.equal(gmt[0].start, Date.UTC(2026, 9, 26, 8));
  assert.equal(gmt[0].end - gmt[0].start, 3 * 3600000);
});

test('segmentsAt refuses starts outside opening hours and invalid full-day starts', () => {
  const d = { y: 2026, m: 11, d: 3 };
  assert.equal(segmentsAt({ date: d, startMinutes: 7 * 60, plan: EFD_Z1, hours: WORKING_HOURS, tz: TZ }), null);
  assert.equal(segmentsAt({ date: d, startMinutes: 16 * 60, plan: EFD_Z1, hours: WORKING_HOURS, tz: TZ }), null);
  assert.equal(segmentsAt({ date: d, startMinutes: 9 * 60, plan: planFor({ service: 'PC1', zone: 'Z1' }), hours: WORKING_HOURS, tz: TZ }), null);
  assert.equal(segmentsAt({ date: { y: 2026, m: 11, d: 8 }, startMinutes: 480, plan: EFD_Z1, hours: WORKING_HOURS, tz: TZ }), null); // Sunday
});

test('isSlotFree agrees with the slot list and rejects junk', () => {
  const events = [busy(at(2026, 11, 3, 10), at(2026, 11, 3, 12))];
  const args = { busy: events, plan: EFD_Z1, hours: WORKING_HOURS, rules: BOOKING_RULES, tz: TZ, nowMs: NOW };
  assert.equal(isSlotFree({ ...args, date: '2026-11-03', time: '13:00' }), true);
  assert.equal(isSlotFree({ ...args, date: '2026-11-03', time: '10:00' }), false);
  assert.equal(isSlotFree({ ...args, date: '2026-11-03', time: '09:30' }), false); // not a start time we offer
  assert.equal(isSlotFree({ ...args, date: '2026-02-31', time: '09:00' }), false);
  assert.equal(isSlotFree({ ...args, date: '2026-11-03', time: '25:00' }), false);
  assert.equal(isSlotFree({ ...args, date: 'tomorrow', time: '09:00' }), false);
});
