// The booking brain: validates input, prices the job, finds free slots, creates the booking.
// Everything outside (postcode lookup, calendar, clock) is passed in so it can be tested.

import { ADDONS, BOOKING_RULES, BUSINESS, SERVICES, SIZES, WORKING_HOURS } from './config.js';
import { buildEvents } from './ics.js';
import { bookingEmail, bookingMessage, dayLabel, whenLabel } from './notify.js';
import { BookingError, priceMenu, priceQuote } from './pricing.js';
import { findSlots, isSlotFree, planFor, segmentsAt } from './slots.js';
import { parseDateKey, parseTimeLabel, partsInZone } from './time.js';
import { resolveZone } from './zones.js';

const tz = BUSINESS.timezone;

function clean(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, max);
}

export function whatsappLink(text) {
  return `https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(text)}`;
}

// Add-on names, prices and rules for the booking page (so prices live in one place only).
function addonCatalog() {
  return Object.fromEntries(
    Object.entries(ADDONS).map(([id, a]) => [
      id,
      { label: a.label, price: a.price, notFor: a.notFor ?? [], onlyFor: a.onlyFor ?? [], excludes: a.excludes ?? [] },
    ]),
  );
}

function outOfArea(zoneInfo) {
  return {
    outOfArea: true,
    postcode: zoneInfo.postcode,
    miles: zoneInfo.miles,
    message:
      "That postcode is outside our online booking area. We travel anywhere in England and Wales for deep cleans and mould removal, paint correction and ceramic coating. The price depends on distance, and on an overnight stay if one is needed. Message Jake on WhatsApp for a quote.",
    whatsapp: whatsappLink(`Hi Jake, I'm in ${zoneInfo.postcode} - can you do a mobile detail for me?`),
  };
}

// Price menu / quote for a postcode. service + addons are optional.
export async function getQuote(input, deps) {
  const zoneInfo = await resolveZone(input.postcode, deps);
  if (!zoneInfo.zone) return outOfArea(zoneInfo);
  const size = input.size;
  const base = {
    postcode: zoneInfo.postcode,
    area: zoneInfo.area,
    zone: zoneInfo.zone,
    miles: zoneInfo.miles,
    sizes: SIZES,
    addons: addonCatalog(),
  };
  if (!SIZES[size]) return base;
  const result = { ...base, menu: priceMenu({ size, zone: zoneInfo.zone }) };
  if (input.service) {
    result.quote = priceQuote({ service: input.service, size, zone: zoneInfo.zone, addons: input.addons ?? [] });
  }
  return result;
}

async function loadBusy(deps, fromMs, toMs) {
  return deps.calendar.fetchBusy({ fromMs, toMs });
}

export async function getAvailability(input, deps) {
  const zoneInfo = await resolveZone(input.postcode, deps);
  if (!zoneInfo.zone) return outOfArea(zoneInfo);

  const quote = priceQuote({
    service: input.service,
    size: input.size,
    zone: zoneInfo.zone,
    addons: input.addons ?? [],
  });
  const plan = planFor({ service: quote.service, zone: zoneInfo.zone, extraMinutes: quote.extraMinutes });
  const nowMs = deps.now();
  const horizonMs = nowMs + (BOOKING_RULES.maxDaysAhead + 21) * 86400000;
  const busy = await loadBusy(deps, nowMs, horizonMs);
  const slots = findSlots({ busy, plan, hours: WORKING_HOURS, rules: BOOKING_RULES, tz, nowMs });

  return {
    postcode: zoneInfo.postcode,
    zone: zoneInfo.zone,
    quote,
    days: SERVICES[quote.service].days,
    slots,
  };
}

// For the homepage strip: the first date someone could book the shortest job (Essential Full Detail, nearest zone).
// Returns { available: false } when nothing is free within `maxDays`, so the strip can hide itself.
export async function getNextAvailable(deps, { maxDays = 14 } = {}) {
  const nowMs = deps.now();
  const plan = planFor({ service: 'EFD', zone: 'Z1' });
  const busy = await loadBusy(deps, nowMs, nowMs + (maxDays + 3) * 86400000);
  const slots = findSlots({ busy, plan, hours: WORKING_HOURS, rules: { ...BOOKING_RULES, maxDaysAhead: maxDays }, tz, nowMs });
  if (!slots.length) return { available: false };
  const date = slots[0].date;
  const today = partsInZone(nowMs, tz);
  const [y, m, d] = date.split('-').map(Number);
  const daysAway = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.y, today.m - 1, today.d)) / 86400000);
  return { available: true, date, daysAway, label: daysAway === 1 ? 'Tomorrow' : dayLabel(date) };
}

function validateCustomer(input) {
  const name = clean(input.name, 80);
  const phone = clean(input.phone, 25);
  const email = clean(input.email, 120);
  const address = clean(input.address, 200);
  const vehicle = clean(input.vehicle, 100);
  const notes = clean(input.notes, 500);

  if (name.length < 2) throw new BookingError('Please enter your name');
  if (!/^[+()\d][\d\s()+-]{6,24}$/.test(phone)) throw new BookingError('Please enter a valid phone number');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BookingError('That email address doesn\'t look right');
  if (address.length < 5) throw new BookingError('Please enter the address we are coming to');
  return { name, phone, email, address, vehicle, notes };
}

export async function createBooking(input, deps) {
  // Bots fill hidden fields. Pretend it worked, do nothing.
  if (clean(input.website, 50)) return { ok: true, ignored: true };

  const customer = validateCustomer(input);
  const date = clean(input.date, 10);
  const time = clean(input.time, 5);
  const dateParts = parseDateKey(date);
  const startMinutes = parseTimeLabel(time);
  if (!dateParts || startMinutes === null) throw new BookingError('Please choose a date and time');

  const zoneInfo = await resolveZone(input.postcode, deps);
  if (!zoneInfo.zone) throw new BookingError('That postcode is outside our online booking area', 'out_of_area');

  // Price is always recalculated here. Whatever the browser says is ignored.
  const quote = priceQuote({
    service: input.service,
    size: input.size,
    zone: zoneInfo.zone,
    addons: input.addons ?? [],
  });
  const plan = planFor({ service: quote.service, zone: zoneInfo.zone, extraMinutes: quote.extraMinutes });
  const nowMs = deps.now();

  // Re-check the calendar right now: someone may have booked since the page loaded.
  const dayStart = Date.UTC(dateParts.y, dateParts.m - 1, dateParts.d);
  const busy = await loadBusy(deps, Math.min(nowMs, dayStart - 2 * 86400000), dayStart + 24 * 86400000);
  const free = isSlotFree({ date, time, busy, plan, hours: WORKING_HOURS, rules: BOOKING_RULES, tz, nowMs });
  if (!free) {
    throw new BookingError('Sorry, that time has just been taken. Please pick another slot.', 'slot_taken');
  }

  const segments = segmentsAt({ date: dateParts, startMinutes, plan, hours: WORKING_HOURS, tz });
  const svc = SERVICES[quote.service];
  const addonText = quote.addons.map((a) => ADDONS[a].label).join(', ') || 'none';
  const compact = (v) => v.toUpperCase().replace(/\s/g, '');
  const location = compact(customer.address).includes(compact(zoneInfo.postcode))
    ? customer.address
    : `${customer.address}, ${zoneInfo.postcode}`;

  const description = [
    `Customer: ${customer.name}`,
    `Phone: ${customer.phone}`,
    customer.email ? `Email: ${customer.email}` : null,
    `Address: ${location}`,
    `Vehicle: ${customer.vehicle || 'not given'} (${SIZES[quote.size].label})`,
    `Service: ${svc.label}`,
    `Add-ons: ${addonText}`,
    `Price: £${quote.total}${quote.isFrom ? ' (from - may rise for heavy soiling, mould or pet hair)' : ''}`,
    `Zone: ${zoneInfo.zone} (${zoneInfo.miles} miles from CV8)`,
    customer.notes ? `Notes: ${customer.notes}` : null,
    'Booked online.',
  ].filter(Boolean).join('\n');

  const events = buildEvents({
    segments,
    summary: `AutoShine: ${quote.service} (${quote.size}) - ${customer.name} - £${quote.total}`,
    location,
    description,
    tz,
    nowMs,
  });
  await deps.calendar.createEvents(events);

  // Instant alerts, only AFTER the calendar write succeeded. They run side by side and every failure is
  // swallowed: the booking itself already succeeded and is safe in the calendar.
  //  - phone push (public service): short message, NO name / phone / street address
  //  - email (private to Jake): full details, same text as the calendar event
  const short = bookingMessage({
    service: svc.label,
    size: SIZES[quote.size].label,
    date,
    time,
    total: quote.total,
    isFrom: quote.isFrom,
    district: zoneInfo.postcode.split(' ')[0],
    days: segments.length,
  });
  const alerts = [];
  if (deps.notify) alerts.push(Promise.resolve().then(() => deps.notify(short)));
  if (deps.email) {
    alerts.push(
      Promise.resolve().then(() =>
        deps.email(
          bookingEmail({
            summary: short,
            when: whenLabel({ date, time, days: segments.length }),
            description,
            replyTo: customer.email,
          }),
        ),
      ),
    );
  }
  for (const r of await Promise.allSettled(alerts)) {
    if (r.status === 'rejected') console.warn('Booking alert failed:', r.reason?.message ?? r.reason);
  }

  return {
    ok: true,
    booking: {
      id: events[0].filename.replace(/\.ics$/, ''),
      service: svc.label,
      date,
      time,
      days: segments.length,
      total: quote.total,
      isFrom: quote.isFrom,
      zone: zoneInfo.zone,
      lines: quote.lines,
    },
    whatsapp: whatsappLink(
      `Hi Jake, I've just booked ${svc.label} on ${date} at ${time}. My name is ${customer.name}.`,
    ),
  };
}
