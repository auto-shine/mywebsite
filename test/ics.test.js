import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBusy } from '../lib/busy.js';
import { buildEvents, escapeText, foldLine } from '../lib/ics.js';

test('text is escaped and cannot inject new calendar fields', () => {
  assert.equal(escapeText('a,b;c\\d'), 'a\\,b\\;c\\\\d');
  const evil = escapeText('Bob\r\nATTENDEE:mailto:evil@x.com\nEND:VEVENT');
  assert.ok(!/[\r\n]/.test(evil));
  assert.equal(evil, 'Bob\\nATTENDEE:mailto:evil@x.com\\nEND:VEVENT');
});

test('control characters are stripped', () => {
  assert.equal(escapeText('a\u0000b\u0007c'), 'a b c');
});

test('long lines fold at 75 bytes and unicode is never split', () => {
  const line = 'DESCRIPTION:' + 'é£'.repeat(60);
  const folded = foldLine(line);
  for (const part of folded.split('\r\n')) assert.ok(Buffer.byteLength(part) <= 75, String(Buffer.byteLength(part)));
  assert.equal(folded.replace(/\r\n /g, ''), line);
  assert.equal(foldLine('short'), 'short');
});

test('a created booking reads back as a busy block (round trip)', () => {
  const start = Date.UTC(2026, 10, 3, 8);
  const end = Date.UTC(2026, 10, 3, 11);
  const [e] = buildEvents({
    segments: [{ start, end }],
    summary: 'AutoShine: EFD (M) - Jo, Bloggs - £110',
    location: '1 High St; Kenilworth, CV8 1AB',
    description: 'Line one\nLine two, with comma',
    nowMs: Date.UTC(2026, 10, 1),
  });
  assert.match(e.filename, /^[0-9a-f-]{36}\.ics$/);
  assert.ok(e.ics.includes('\r\n'));
  assert.ok(e.ics.startsWith('BEGIN:VCALENDAR'));
  const busy = parseBusy([e.ics], { rangeStartMs: Date.UTC(2026, 9, 1), rangeEndMs: Date.UTC(2027, 0, 1), tz: 'Europe/London' });
  assert.deepEqual(busy, [{ start, end }]);
  // the alarm inside must not leak extra events
  assert.equal(busy.length, 1);
});

test('two segments make two separate events', () => {
  const segs = [
    { start: Date.UTC(2026, 10, 3, 8), end: Date.UTC(2026, 10, 3, 18) },
    { start: Date.UTC(2026, 10, 4, 8), end: Date.UTC(2026, 10, 4, 18) },
  ];
  const events = buildEvents({ segments: segs, summary: 'CC', location: 'x', description: 'y' });
  assert.equal(events.length, 2);
  assert.notEqual(events[0].filename, events[1].filename);
  assert.match(events[1].ics, /day 2\/2/);
});
