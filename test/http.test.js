import test from 'node:test';
import assert from 'node:assert/strict';
import quote from '../netlify/functions/quote.js';
import availability from '../netlify/functions/availability.js';
import book from '../netlify/functions/book.js';

const get = (path) => new Request(`https://example.com${path}`);
const post = (body) => new Request('https://example.com/api/book', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

test('endpoints return JSON errors (400) for bad postcodes, no network needed', async () => {
  for (const fn of [quote, availability]) {
    const res = await fn(get('/api/x?postcode=nope&size=M&service=EFD'));
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type'), /json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match((await res.json()).error, /postcode/i);
  }
});

test('book only accepts POST, rejects bad JSON and oversize bodies', async () => {
  assert.equal((await book(get('/api/book'))).status, 405);
  assert.equal((await book(post('{not json'))).status, 400);
  assert.equal((await book(post('x'.repeat(20000)))).status, 400);
});

test('honeypot submissions get a quiet success', async () => {
  const res = await book(post({ website: 'spam', name: 'x' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('missing calendar settings give a friendly 500 and do not leak details', async () => {
  const saved = { ...process.env };
  delete process.env.ICLOUD_USERNAME; delete process.env.ICLOUD_APP_PASSWORD; delete process.env.ICLOUD_CALENDAR_NAME;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({ result: { latitude: 52.3425, longitude: -1.583 } }) });
  const origErr = console.error; console.error = () => {};
  try {
    const res = await availability(get('/api/availability?postcode=CV8 1AB&size=M&service=EFD'));
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.match(body.error, /WhatsApp/);
    assert.ok(!/ICLOUD|password/i.test(JSON.stringify(body)));
  } finally {
    globalThis.fetch = origFetch; console.error = origErr; Object.assign(process.env, saved);
  }
});
