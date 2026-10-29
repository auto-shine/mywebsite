// Wires the real services (postcode lookup, iCloud calendar, clock) into the booking logic.
import { createICloudCalendar } from './calendar.js';
import { createEmailNotifier, createNotifier } from './notify.js';
import { BookingError } from './pricing.js';
import { lookupPostcode } from './zones.js';

let calendar;

export function realDeps() {
  calendar ??= createICloudCalendar();
  return {
    geocode: lookupPostcode,
    calendar,
    now: () => Date.now(),
    notify: createNotifier(),
    email: createEmailNotifier(),
  };
}

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers });
}

// Runs a handler body and turns errors into safe JSON responses.
export async function respond(fn) {
  try {
    return json(200, await fn());
  } catch (err) {
    if (err instanceof BookingError) {
      const status = err.code === 'slot_taken' ? 409 : err.code === 'upstream' ? 503 : 400;
      return json(status, { error: err.message, code: err.code });
    }
    console.error('Booking error:', err?.message ?? err);
    return json(500, { error: "Sorry, something went wrong on our side. Please message Jake on WhatsApp and he'll sort your booking.", code: 'server' });
  }
}

export async function readJson(req) {
  const text = await req.text();
  if (text.length > 10000) throw new BookingError('Request too large');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new BookingError('Invalid request');
  }
}

export function listParam(url, name) {
  const v = url.searchParams.get(name);
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
