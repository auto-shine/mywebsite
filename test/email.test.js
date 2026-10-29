import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS } from '../lib/config.js';
import { bookingEmail, createEmailNotifier } from '../lib/notify.js';
import { createBooking } from '../lib/service.js';
import { zonedToMs } from '../lib/time.js';

const TZ = 'Europe/London';
const at = (y, m, d, h = 0) => zonedToMs({ y, m, d, h }, TZ);
const quiet = async (fn) => {
  const w = console.warn; console.warn = () => {};
  try { return await fn(); } finally { console.warn = w; }
};

const ENV = { RESEND_API_KEY: 're_test_key', ALERT_EMAIL_TO: 'jake@auto-shine.co.uk' };

// ---------- configuration ----------

test('email alerts are off unless BOTH the key and an address are set', () => {
  assert.equal(createEmailNotifier({}), null);
  assert.equal(createEmailNotifier({ RESEND_API_KEY: 'k' }), null);
  assert.equal(createEmailNotifier({ ALERT_EMAIL_TO: 'a@b.com' }), null);
  assert.equal(createEmailNotifier({ RESEND_API_KEY: '  ', ALERT_EMAIL_TO: 'a@b.com' }), null);
  assert.equal(createEmailNotifier({ RESEND_API_KEY: 'k', ALERT_EMAIL_TO: ' , ' }), null);
  assert.equal(typeof createEmailNotifier(ENV), 'function');
});

// ---------- the request ----------

test('sends one correct request to Resend', async () => {
  const calls = [];
  const send = createEmailNotifier(ENV, async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; });
  const r = await send({ subject: 'Hello', text: 'Body £135', replyTo: 'cust@example.com' });
  assert.deepEqual(r, { ok: true, status: 200, detail: '' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test_key');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, {
    from: 'AutoShine Bookings <onboarding@resend.dev>',
    to: ['jake@auto-shine.co.uk'],
    subject: 'Hello',
    text: 'Body £135',
    reply_to: 'cust@example.com',
  });
});

test('several recipients and a custom sender are supported (max 5 recipients)', async () => {
  const calls = [];
  const send = createEmailNotifier(
    { ...ENV, ALERT_EMAIL_TO: 'a@x.com, b@x.com ,c@x.com,d@x.com,e@x.com,f@x.com', ALERT_EMAIL_FROM: 'Bookings <bookings@auto-shine.co.uk>' },
    async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200 }; },
  );
  await send({ subject: 's', text: 't' });
  assert.deepEqual(calls[0].to, ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com']);
  assert.equal(calls[0].from, 'Bookings <bookings@auto-shine.co.uk>');
  assert.equal('reply_to' in calls[0], false);
});

test('the subject can never contain line breaks or be huge', async () => {
  let body;
  const send = createEmailNotifier(ENV, async (u, init) => { body = JSON.parse(init.body); return { ok: true, status: 200 }; });
  await send({ subject: 'Hi\r\nBcc: evil@x.com\nX: y' + 'a'.repeat(500), text: 't' });
  assert.ok(!/[\r\n]/.test(body.subject));
  assert.ok(body.subject.length <= 200);
});

// ---------- failures never throw ----------

test('Resend errors, network failures and timeouts all resolve (never throw) and say why', async () => {
  await quiet(async () => {
    const make = (f) => createEmailNotifier(ENV, f);
    const r403 = await make(async () => ({ ok: false, status: 403, text: async () => '{"message":"You can only send testing emails to your own email address"}' }))({ subject: 's', text: 't' });
    assert.equal(r403.ok, false);
    assert.equal(r403.status, 403);
    assert.match(r403.detail, /only send testing emails/);
    const r401 = await make(async () => ({ ok: false, status: 401, text: async () => 'API key is invalid' }))({ subject: 's', text: 't' });
    assert.equal(r401.status, 401);
    const down = await make(async () => { throw new Error('getaddrinfo ENOTFOUND api.resend.com'); })({ subject: 's', text: 't' });
    assert.equal(down.ok, false);
    assert.match(down.detail, /ENOTFOUND/);
    const slow = await make(async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); })({ subject: 's', text: 't' });
    assert.equal(slow.ok, false);
  });
});

test('the API key is never written to the logs', async () => {
  const logged = [];
  const w = console.warn; console.warn = (...a) => logged.push(a.join(' '));
  try {
    await createEmailNotifier(ENV, async () => ({ ok: false, status: 401, text: async () => 'bad key' }))({ subject: 's', text: 't' });
    await createEmailNotifier(ENV, async () => { throw new Error('boom'); })({ subject: 's', text: 't' });
  } finally { console.warn = w; }
  assert.ok(logged.length >= 2);
  assert.ok(!logged.join('\n').includes('re_test_key'));
});

// ---------- the email content ----------

test('the email has a clear subject and the full booking details', () => {
  const e = bookingEmail({
    summary: 'Essential Full Detail (Medium) - Sat 7 Nov 09:00 - from £135 - CV8',
    when: 'Sat 7 Nov 09:00',
    description: 'Customer: Jamie Lee\nPhone: 07700 900123',
    replyTo: 'jamie@example.com',
  });
  assert.equal(e.subject, 'New booking: Essential Full Detail (Medium) - Sat 7 Nov 09:00 - from £135 - CV8');
  assert.match(e.text, /When: Sat 7 Nov 09:00/);
  assert.match(e.text, /Customer: Jamie Lee/);
  assert.match(e.text, /Phone: 07700 900123/);
  assert.equal(e.replyTo, 'jamie@example.com');
});

// ---------- wired into booking ----------

const north = (miles) => ({ lat: BUSINESS.origin.lat + miles / 69.05, lng: BUSINESS.origin.lng });
const NOW = at(2026, 11, 2, 7);
function deps(extra = {}) {
  const order = [];
  const d = {
    order,
    geocode: async () => north(1),
    now: () => NOW,
    calendar: { fetchBusy: async () => [], createEvents: async () => { order.push('calendar'); } },
    ...extra,
  };
  return d;
}
const booking = {
  postcode: 'CV8 1AB', size: 'M', service: 'EFD', addons: ['engine'], date: '2026-11-03', time: '09:00',
  name: 'Jamie Lee', phone: '07700 900123', email: 'jamie@example.com', address: '12 Castle Road, Kenilworth',
  vehicle: 'Golf GTI', notes: 'Gate code 1234',
};

test('a booking sends ONE email, after the calendar write, with every detail Jake needs', async () => {
  const sent = [];
  const d = deps({ email: async (m) => { d.order.push('email'); sent.push(m); return { ok: true }; } });
  const res = await createBooking(booking, d);
  assert.equal(res.ok, true);
  assert.deepEqual(d.order, ['calendar', 'email']);
  assert.equal(sent.length, 1);
  const { subject, text, replyTo } = sent[0];
  assert.equal(subject, 'New booking: Essential Full Detail (Medium) - Tue 3 Nov 09:00 - from £135 - CV8');
  for (const must of ['Jamie Lee', '07700 900123', 'jamie@example.com', '12 Castle Road', 'Golf GTI', 'Gate code 1234', 'Engine bay detail', '£135', 'Tue 3 Nov 09:00']) {
    assert.ok(text.includes(must), `email is missing: ${must}`);
  }
  assert.equal(replyTo, 'jamie@example.com');
  // no personal details in the subject line
  assert.ok(!/Jamie|07700|Castle/.test(subject));
});

test('no customer email given means no reply-to', async () => {
  const sent = [];
  await createBooking({ ...booking, email: '' }, deps({ email: async (m) => { sent.push(m); } }));
  assert.equal(sent[0].replyTo, undefined);
});

test('email and phone push both fire when both are configured; the push stays private', async () => {
  const push = [];
  const mail = [];
  await createBooking(booking, deps({ notify: async (m) => { push.push(m); }, email: async (m) => { mail.push(m); } }));
  assert.equal(push.length, 1);
  assert.equal(mail.length, 1);
  assert.ok(!/Jamie|07700|Castle|jamie@/.test(push[0]));
  assert.match(mail[0].text, /Jamie Lee/);
});

test('if the email system throws or rejects, the booking still succeeds', async () => {
  await quiet(async () => {
    for (const email of [async () => { throw new Error('boom'); }, () => { throw new Error('sync boom'); }, () => Promise.reject(new Error('nope'))]) {
      const d = deps({ email });
      const res = await createBooking(booking, d);
      assert.equal(res.ok, true);
      assert.deepEqual(d.order, ['calendar']);
    }
  });
});

test('a failing email does not stop the phone push, and vice versa', async () => {
  await quiet(async () => {
    const push = [];
    await createBooking(booking, deps({ notify: async (m) => { push.push(m); }, email: async () => { throw new Error('x'); } }));
    assert.equal(push.length, 1);
    const mail = [];
    await createBooking(booking, deps({ notify: async () => { throw new Error('y'); }, email: async (m) => { mail.push(m); } }));
    assert.equal(mail.length, 1);
  });
});

test('no email when the booking fails or is a bot', async () => {
  const sent = [];
  const email = async (m) => { sent.push(m); };
  const taken = deps({ email });
  taken.calendar.fetchBusy = async () => [{ start: at(2026, 11, 3, 8), end: at(2026, 11, 3, 12) }];
  await assert.rejects(() => createBooking(booking, taken), (e) => e.code === 'slot_taken');
  await assert.rejects(() => createBooking(booking, deps({ email, calendar: { fetchBusy: async () => [], createEvents: async () => { throw new Error('iCloud down'); } } })), /iCloud down/);
  await assert.rejects(() => createBooking({ ...booking, name: 'J' }, deps({ email })), /name/i);
  await createBooking({ ...booking, website: 'spam' }, deps({ email }));
  assert.equal(sent.length, 0);
});

test('customer text with line breaks cannot break the email subject', async () => {
  const sent = [];
  await createBooking({ ...booking, name: 'Eve\r\nBcc: evil@x.com', notes: 'x\nSubject: hacked' }, deps({ email: async (m) => { sent.push(m); } }));
  assert.ok(!/[\r\n]/.test(sent[0].subject));
  assert.ok(!/Eve|evil|hacked/.test(sent[0].subject));
});
