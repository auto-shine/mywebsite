import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBusy } from '../lib/busy.js';
import { BUSINESS } from '../lib/config.js';
import { buildEvents, eveningBeforeMs } from '../lib/ics.js';
import { bookingMessage, createNotifier } from '../lib/notify.js';
import { createBooking } from '../lib/service.js';
import { zonedToMs } from '../lib/time.js';

const TZ = 'Europe/London';
const at = (y, m, d, h = 0, mi = 0) => zonedToMs({ y, m, d, h, mi }, TZ);
const unfold = (ics) => ics.replace(/\r\n /g, '');
const lines = (ics) => unfold(ics).split('\r\n');

// ---------- reminders ----------

test('every event has two alerts: 18:00 the evening before, and 1 hour before the start', () => {
  const start = at(2026, 11, 3, 9); // Tue 3 Nov 09:00 (GMT)
  const [e] = buildEvents({ segments: [{ start, end: start + 3 * 3600000 }], summary: 's', location: 'l', description: 'd' });
  const l = lines(e.ics);
  assert.equal(l.filter((x) => x === 'BEGIN:VALARM').length, 2);
  assert.equal(l.filter((x) => x === 'END:VALARM').length, 2);
  assert.ok(l.includes('TRIGGER;VALUE=DATE-TIME:20261102T180000Z'), 'Mon 2 Nov 18:00 London = 18:00Z in winter');
  assert.ok(l.includes('TRIGGER:-PT60M'));
});

test('evening-before alert is 18:00 London time in summer (BST) too', () => {
  const start = at(2026, 7, 14, 8); // Tue 14 Jul 08:00 BST
  assert.equal(eveningBeforeMs(start, TZ), Date.UTC(2026, 6, 13, 17)); // 18:00 BST = 17:00Z
});

test('the clocks changing overnight does not shift the alert off 18:00 local', () => {
  // job Mon 26 Oct 08:00 (GMT); evening before is Sun 25 Oct 18:00 (GMT, clocks went back that morning)
  assert.equal(eveningBeforeMs(at(2026, 10, 26, 8), TZ), Date.UTC(2026, 9, 25, 18));
  // job Mon 29 Mar 2027 08:00 (BST, clocks went forward on Sun 28 Mar); evening before 18:00 BST = 17:00Z
  assert.equal(eveningBeforeMs(at(2027, 3, 29, 8), TZ), Date.UTC(2027, 2, 28, 17));
});

test('a two-day job gets its own evening-before alert for each day', () => {
  const day1 = { start: at(2026, 11, 7, 8), end: at(2026, 11, 7, 18) };
  const day2 = { start: at(2026, 11, 9, 8), end: at(2026, 11, 9, 18) };
  const evs = buildEvents({ segments: [day1, day2], summary: 's', location: 'l', description: 'd' });
  assert.ok(lines(evs[0].ics).includes('TRIGGER;VALUE=DATE-TIME:20261106T180000Z'));
  assert.ok(lines(evs[1].ics).includes('TRIGGER;VALUE=DATE-TIME:20261108T180000Z'));
});

test('the evening alert can be switched off', () => {
  const start = at(2026, 11, 3, 9);
  const [e] = buildEvents({ segments: [{ start, end: start + 3600000 }], summary: 's', location: 'l', description: 'd', eveningBeforeHour: null });
  assert.equal(lines(e.ics).filter((x) => x === 'BEGIN:VALARM').length, 1);
});

test('alerts do not confuse availability: an event with two alarms is still one busy block', () => {
  const start = at(2026, 11, 3, 9);
  const [e] = buildEvents({ segments: [{ start, end: start + 3 * 3600000 }], summary: 's', location: 'l', description: 'd' });
  const busy = parseBusy([e.ics], { rangeStartMs: at(2026, 10, 1), rangeEndMs: at(2027, 1, 1), tz: TZ });
  assert.deepEqual(busy, [{ start, end: start + 3 * 3600000 }]);
});

// ---------- message ----------

test('message text is short, readable and has no personal details', () => {
  const m = bookingMessage({ service: 'Essential Full Detail', size: 'Medium', date: '2026-11-07', time: '09:00', total: 145, isFrom: true, district: 'CV8' });
  assert.equal(m, 'Essential Full Detail (Medium) - Sat 7 Nov 09:00 - from £145 - CV8');
  const two = bookingMessage({ service: 'Ceramic Coating', size: 'Large', date: '2026-11-09', time: '08:00', total: 640, isFrom: false, district: 'OX16', days: 2 });
  assert.equal(two, 'Ceramic Coating (Large) - Mon 9 Nov 08:00 (2 days) - £640 - OX16');
});

// ---------- sending ----------

test('no topic set = no notifier (feature simply off)', () => {
  assert.equal(createNotifier({}), null);
  assert.equal(createNotifier({ NTFY_TOPIC: '   ' }), null);
});

test('sends one POST to the right address with plain-ASCII headers and a UTF-8 body', async () => {
  const calls = [];
  const notify = createNotifier({ NTFY_TOPIC: 'my secret topic' }, async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; });
  await notify('Hello £145');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ntfy.sh/my%20secret%20topic');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, 'Hello £145');
  for (const v of Object.values(calls[0].init.headers)) assert.match(v, /^[\x20-\x7E]+$/);
});

test('a custom ntfy server is supported', async () => {
  const calls = [];
  const notify = createNotifier({ NTFY_TOPIC: 't', NTFY_SERVER: 'https://ntfy.example.com/' }, async (url) => { calls.push(url); return { ok: true }; });
  await notify('x');
  assert.deepEqual(calls, ['https://ntfy.example.com/t']);
});

test('network failure, timeout or an error reply never throws', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    for (const f of [
      async () => { throw new Error('network down'); },
      async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
      async () => ({ ok: false, status: 500 }),
      async () => ({ ok: false, status: 429 }),
    ]) {
      await createNotifier({ NTFY_TOPIC: 't' }, f)('x'); // must resolve
    }
  } finally { console.warn = warn; }
});

// ---------- wired into booking ----------

const north = (miles) => ({ lat: BUSINESS.origin.lat + miles / 69.05, lng: BUSINESS.origin.lng });
const NOW = at(2026, 11, 2, 7);
function deps({ notify, createEvents } = {}) {
  const written = [];
  return {
    written,
    geocode: async () => north(1),
    now: () => NOW,
    calendar: { fetchBusy: async () => [], createEvents: createEvents ?? (async (e) => { written.push(...e); }) },
    notify,
  };
}
const booking = {
  postcode: 'CV8 1AB', size: 'M', service: 'EFD', addons: ['engine'], date: '2026-11-03', time: '09:00',
  name: 'Jamie Lee', phone: '07700 900123', email: 'jamie@example.com', address: '12 Castle Road, Kenilworth', vehicle: 'Golf GTI', notes: 'Gate code 1234',
};

test('a booking sends exactly one alert, AFTER the calendar write, with no personal details', async () => {
  const order = [];
  const sent = [];
  const d = deps({ notify: async (m) => { order.push('notify'); sent.push(m); }, createEvents: async () => { order.push('calendar'); } });
  const res = await createBooking(booking, d);
  assert.equal(res.ok, true);
  assert.deepEqual(order, ['calendar', 'notify']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0], 'Essential Full Detail (Medium) - Tue 3 Nov 09:00 - from £135 - CV8');
  for (const secret of ['Jamie', 'Lee', '07700', 'jamie@', 'Castle', 'Gate code', 'Golf']) {
    assert.ok(!sent[0].includes(secret), `leaked ${secret}`);
  }
});

test('if the alert system throws, the booking still succeeds', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const d = deps({ notify: async () => { throw new Error('boom'); } });
    const res = await createBooking(booking, d);
    assert.equal(res.ok, true);
    assert.equal(d.written.length, 1);
  } finally { console.warn = warn; }
});

test('no alert is sent when the booking fails (slot taken, calendar error) or is a bot', async () => {
  const sent = [];
  const notify = async (m) => sent.push(m);
  // slot taken
  const taken = deps({ notify });
  taken.calendar.fetchBusy = async () => [{ start: at(2026, 11, 3, 8), end: at(2026, 11, 3, 12) }];
  await assert.rejects(() => createBooking(booking, taken), (e) => e.code === 'slot_taken');
  // calendar write fails
  await assert.rejects(() => createBooking(booking, deps({ notify, createEvents: async () => { throw new Error('iCloud down'); } })), /iCloud down/);
  // bot honeypot
  await createBooking({ ...booking, website: 'spam' }, deps({ notify }));
  assert.equal(sent.length, 0);
});

test('works exactly as before when no notifier is configured', async () => {
  const d = deps();
  const res = await createBooking(booking, d);
  assert.equal(res.ok, true);
  assert.equal(d.written.length, 1);
});
