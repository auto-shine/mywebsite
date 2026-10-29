import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS } from '../lib/config.js';
import { parseBusy } from '../lib/busy.js';
import { createBooking, getAvailability, getNextAvailable, getQuote } from '../lib/service.js';
import { zonedToMs } from '../lib/time.js';

const TZ = 'Europe/London';
const at = (y, m, d, h = 0, mi = 0) => zonedToMs({ y, m, d, h, mi }, TZ);
const NOW = at(2026, 11, 2, 7); // Monday 07:00
const north = (miles) => ({ lat: BUSINESS.origin.lat + miles / 69.05, lng: BUSINESS.origin.lng });

const POSTCODES = {
  'CV8 1AB': north(1),     // Z1
  'CV31 1AA': north(5),    // Z1
  'B95 5AA': north(14),    // Z2
  'OX16 5AA': north(24),   // Z3
  'LE1 1AA': north(45),    // out of area
};

// A fake calendar that remembers what was written and can read it back as busy time.
function fakeCalendar(initialBusy = []) {
  const written = [];
  return {
    written,
    async fetchBusy({ fromMs, toMs }) {
      const fromWritten = parseBusy(written.map((w) => w.ics), { rangeStartMs: fromMs, rangeEndMs: toMs, tz: TZ });
      return [...initialBusy, ...fromWritten];
    },
    async createEvents(events) { written.push(...events); },
  };
}
const makeDeps = (calendar = fakeCalendar()) => ({
  geocode: async (pc) => {
    if (!POSTCODES[pc]) throw Object.assign(new Error("We couldn't find that postcode."), { code: 'invalid' });
    return POSTCODES[pc];
  },
  calendar,
  now: () => NOW,
});

const unfold = (ics) => ics.replace(/\r\n /g, '');

const customer = {
  name: 'Jamie Lee', phone: '07700 900123', email: 'jamie@example.com',
  address: '12 Castle Road, Kenilworth', vehicle: 'Golf GTI', notes: 'Gate code 1234',
};
const job = { postcode: 'CV8 1AB', size: 'M', service: 'EFD', addons: [] };

test('quote: price menu per zone and size', async () => {
  const z1 = await getQuote({ postcode: 'CV8 1AB', size: 'S' }, makeDeps());
  assert.equal(z1.zone, 'Z1');
  assert.equal(z1.menu.EFD.price, 90);
  const z2 = await getQuote({ postcode: 'B95 5AA', size: 'L' }, makeDeps());
  assert.equal(z2.zone, 'Z2');
  assert.equal(z2.menu.EFD.price, 120);
  const z3 = await getQuote({ postcode: 'ox16 5aa', size: 'M', service: 'CC', addons: ['softtop'] }, makeDeps());
  assert.equal(z3.zone, 'Z3');
  assert.equal(z3.quote.total, 600 + 50);
});

test('quote: the same car costs more further out (the whole point)', async () => {
  const price = async (postcode) => (await getQuote({ postcode, size: 'S', service: 'EFD' }, makeDeps())).quote.total;
  assert.equal(await price('CV8 1AB'), 90);
  assert.equal(await price('B95 5AA'), 100);
  assert.equal(await price('OX16 5AA'), 110);
});

test('quote: outside the area gives a WhatsApp route instead of a price', async () => {
  const r = await getQuote({ postcode: 'LE1 1AA', size: 'M', service: 'EFD' }, makeDeps());
  assert.equal(r.outOfArea, true);
  assert.match(r.whatsapp, /^https:\/\/wa\.me\/447999923651\?text=/);
  assert.equal(r.quote, undefined);
});

test('quote: unknown postcode and bad postcode give friendly errors', async () => {
  await assert.rejects(() => getQuote({ postcode: 'ZZ9 9ZZ', size: 'M' }, makeDeps()), /couldn't find/);
  await assert.rejects(() => getQuote({ postcode: 'nope', size: 'M' }, makeDeps()), /postcode/i);
});

test('availability: free calendar offers slots; a busy day is skipped', async () => {
  const off = [{ start: at(2026, 11, 4), end: at(2026, 11, 5) }];
  const r = await getAvailability(job, makeDeps(fakeCalendar(off)));
  assert.equal(r.zone, 'Z1');
  assert.equal(r.quote.total, 100);
  const dates = r.slots.map((s) => s.date);
  assert.ok(dates.includes('2026-11-03'));
  assert.ok(!dates.includes('2026-11-04'));
  assert.ok(!dates.includes('2026-11-08')); // Sunday
});

test('availability: the farther zone gets bigger travel gaps', async () => {
  const cal = [{ start: at(2026, 11, 3, 10), end: at(2026, 11, 3, 12, 15) }];
  const near = await getAvailability(job, makeDeps(fakeCalendar(cal)));
  const far = await getAvailability({ ...job, postcode: 'OX16 5AA' }, makeDeps(fakeCalendar(cal)));
  const t = (r) => r.slots.find((s) => s.date === '2026-11-03').times;
  assert.deepEqual(t(near), ['13:00', '14:00', '15:00']);
  assert.deepEqual(t(far), ['14:00', '15:00']);
});

test('availability: out of area returns no slots', async () => {
  const r = await getAvailability({ ...job, postcode: 'LE1 1AA' }, makeDeps());
  assert.equal(r.outOfArea, true);
  assert.equal(r.slots, undefined);
});

test('booking: success writes the right event to the calendar and the slot disappears', async () => {
  const cal = fakeCalendar();
  const deps = makeDeps(cal);
  const res = await createBooking({ ...job, ...customer, addons: ['engine'], date: '2026-11-03', time: '09:00' }, deps);
  assert.equal(res.ok, true);
  assert.equal(res.booking.total, 100 + 35);
  assert.equal(cal.written.length, 1);
  const ics = unfold(cal.written[0].ics);
  assert.match(ics, /SUMMARY:AutoShine: EFD \(M\) - Jamie Lee - £135/);
  assert.match(ics, /LOCATION:12 Castle Road\\, Kenilworth\\, CV8 1AB/);
  assert.match(ics, /Phone: 07700 900123/);
  assert.match(ics, /DTSTART:20261103T090000Z/);
  assert.match(ics, /DTEND:20261103T124500Z/); // 3h + 45 min engine bay = 3h45
  // now that time (and the gaps around it) is gone
  const after = await getAvailability({ ...job, addons: [] }, deps);
  const times = after.slots.find((s) => s.date === '2026-11-03')?.times ?? [];
  assert.ok(!times.includes('09:00'));
  assert.ok(!times.includes('11:00')); // clashes with the 09:00-12:45 booking
});

test('booking: the second person to pick the same slot is told it is taken', async () => {
  const deps = makeDeps();
  await createBooking({ ...job, ...customer, date: '2026-11-03', time: '10:00' }, deps);
  await assert.rejects(
    () => createBooking({ ...job, ...customer, name: 'Someone Else', date: '2026-11-03', time: '10:00' }, deps),
    (e) => e.code === 'slot_taken',
  );
  assert.equal(deps.calendar.written.length, 1);
});

test('booking: overlapping slots are rejected too, not just identical ones', async () => {
  const deps = makeDeps();
  await createBooking({ ...job, ...customer, date: '2026-11-03', time: '10:00' }, deps); // 10:00-13:00
  for (const time of ['08:00', '09:00', '11:00', '12:00', '13:00', '14:00']) {
    // 08:00 ends 11:00 (clash), 09:00 clash, 11:00 clash, 12:00 clash, 13:00 only 0 min gap (needs 30), 14:00 ok? 13:30 needed -> 14:00 fine
    const expectFree = time === '14:00';
    const p = createBooking({ ...job, ...customer, date: '2026-11-03', time }, deps);
    if (expectFree) await p; else await assert.rejects(() => p, (e) => e.code === 'slot_taken', time);
  }
});

test('booking: a price or zone sent by the browser is ignored', async () => {
  const deps = makeDeps();
  const res = await createBooking({ ...job, ...customer, total: 1, price: 1, zone: 'Z1', date: '2026-11-03', time: '09:00', postcode: 'OX16 5AA' }, deps);
  assert.equal(res.booking.zone, 'Z3');
  assert.equal(res.booking.total, 120); // medium EFD in Z3, not £1
});

test('booking: price comes from the postcode zone, size and service', async () => {
  const deps = makeDeps();
  const res = await createBooking({ ...job, ...customer, postcode: 'OX16 5AA', date: '2026-11-03', time: '09:00' }, deps);
  assert.equal(res.booking.zone, 'Z3');
  assert.equal(res.booking.total, 120); // EFD, medium, Z3
});

test('booking: two-day ceramic coating writes two events on consecutive working days', async () => {
  const deps = makeDeps();
  const res = await createBooking({ ...job, ...customer, service: 'CC', date: '2026-11-07', time: '08:00' }, deps);
  assert.equal(res.booking.days, 2);
  assert.equal(res.booking.total, 580);
  assert.equal(deps.calendar.written.length, 2);
  assert.match(deps.calendar.written[0].ics, /DTSTART:20261107T080000Z/); // Saturday
  assert.match(deps.calendar.written[1].ics, /DTSTART:20261109T080000Z/); // Monday (Sunday closed)
});

test('booking: invalid slots are refused (Sunday, too soon, outside hours, odd time, past)', async () => {
  const deps = makeDeps();
  for (const [date, time] of [['2026-11-08', '09:00'], ['2026-11-02', '09:00'], ['2026-11-03', '07:00'], ['2026-11-03', '16:00'], ['2026-11-03', '09:30'], ['2026-10-01', '09:00'], ['2030-01-01', '09:00']]) {
    await assert.rejects(() => createBooking({ ...job, ...customer, date, time }, deps), `${date} ${time}`);
  }
  assert.equal(deps.calendar.written.length, 0);
});

test('booking: out of area and bad add-on combinations are refused', async () => {
  const deps = makeDeps();
  await assert.rejects(() => createBooking({ ...job, ...customer, postcode: 'LE1 1AA', date: '2026-11-03', time: '09:00' }, deps), (e) => e.code === 'out_of_area');
  await assert.rejects(() => createBooking({ ...job, ...customer, service: 'ENGINE', addons: ['engine'], date: '2026-11-03', time: '09:00' }, deps));
  assert.equal(deps.calendar.written.length, 0);
});

test('booking: customer details are validated', async () => {
  const deps = makeDeps();
  const base = { ...job, ...customer, date: '2026-11-03', time: '09:00' };
  await assert.rejects(() => createBooking({ ...base, name: 'J' }, deps), /name/i);
  await assert.rejects(() => createBooking({ ...base, phone: 'abc' }, deps), /phone/i);
  await assert.rejects(() => createBooking({ ...base, email: 'not-an-email' }, deps), /email/i);
  await assert.rejects(() => createBooking({ ...base, address: '' }, deps), /address/i);
  // email is optional
  const ok = await createBooking({ ...base, email: '' }, deps);
  assert.equal(ok.ok, true);
});

test('booking: calendar injection attempts stay inside the text fields', async () => {
  const deps = makeDeps();
  await createBooking({
    ...job, ...customer,
    name: 'Eve\r\nBEGIN:VEVENT\r\nDTSTART:20261110T000000Z',
    notes: 'x\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:fake',
    date: '2026-11-03', time: '09:00',
  }, deps);
  const lines = unfold(deps.calendar.written[0].ics).split('\r\n');
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 1);
  assert.equal(lines.filter((l) => l === 'END:VEVENT').length, 1);
  assert.equal(lines.filter((l) => l.startsWith('DTSTART:')).length, 1);
  assert.equal(lines.filter((l) => l.startsWith('SUMMARY:')).length, 1);
  assert.ok(!lines.some((l) => l.startsWith('ATTENDEE')));
});

test('booking: the hidden honeypot field makes bots look successful but books nothing', async () => {
  const deps = makeDeps();
  const res = await createBooking({ ...job, ...customer, website: 'http://spam.example', date: '2026-11-03', time: '09:00' }, deps);
  assert.equal(res.ok, true);
  assert.equal(deps.calendar.written.length, 0);
});

test('booking: existing calendar events (other work, personal busy time) block booking', async () => {
  const deps = makeDeps(fakeCalendar([{ start: at(2026, 11, 3, 9), end: at(2026, 11, 3, 10) }]));
  await assert.rejects(() => createBooking({ ...job, ...customer, date: '2026-11-03', time: '08:00' }, deps), (e) => e.code === 'slot_taken');
});

test('booking: response carries a unique id for conversion de-duplication', async () => {
  const src = await import('node:fs').then((f) => f.readFileSync(new URL('../lib/service.js', import.meta.url), 'utf8'));
  assert.match(src, /id: events\[0\]\.filename/);
});

test('next available: first bookable day for a basic detail, and "Tomorrow" wording', async () => {
  const r = await getNextAvailable(makeDeps());
  assert.deepEqual(r, { available: true, date: '2026-11-03', daysAway: 1, label: 'Tomorrow' });
});

test('next available: skips busy days and names the day', async () => {
  const busy = [{ start: at(2026, 11, 3), end: at(2026, 11, 7) }]; // Tue-Fri blocked
  const r = await getNextAvailable(makeDeps(fakeCalendar(busy)));
  assert.equal(r.date, '2026-11-07');
  assert.equal(r.label, 'Saturday 7 Nov');
  assert.equal(r.daysAway, 5);
});

test('next available: hides when nothing is free in the next 14 days', async () => {
  const busy = [{ start: at(2026, 11, 2), end: at(2026, 11, 25) }];
  assert.deepEqual(await getNextAvailable(makeDeps(fakeCalendar(busy))), { available: false });
});

test('next available: a calendar outage throws (the endpoint turns that into "hide the strip")', async () => {
  const deps = makeDeps();
  deps.calendar = { async fetchBusy() { throw new Error('down'); } };
  await assert.rejects(() => getNextAvailable(deps));
});
