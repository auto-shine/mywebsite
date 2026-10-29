import { SERVICES, ADDONS, SIZES, ZONES } from './config.js';

export class BookingError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.code = code;
  }
}

// Works out the price. The server always recalculates; never trust a price sent by the browser.
export function priceQuote({ service, size, zone, addons = [] }) {
  const svc = SERVICES[service];
  if (!svc) throw new BookingError('Unknown service');
  if (!SIZES[size]) throw new BookingError('Unknown vehicle size');
  if (!ZONES.some((z) => z.id === zone)) throw new BookingError('Unknown zone');
  if (!Array.isArray(addons)) throw new BookingError('Add-ons must be a list');

  const unique = [...new Set(addons)];
  const base = svc.flat ?? svc.prices[zone][size];
  const lines = [{ id: service, label: svc.label, amount: base }];
  let extraMinutes = 0;

  for (const id of unique) {
    const a = ADDONS[id];
    if (!a) throw new BookingError(`Unknown add-on: ${id}`);
    if (a.notFor?.includes(service)) {
      throw new BookingError(`${a.label} can't be added to ${svc.label}`);
    }
    if (a.onlyFor && !a.onlyFor.includes(service)) {
      throw new BookingError(`${a.label} only applies to ${a.onlyFor.map((s) => SERVICES[s].label).join(' / ')}`);
    }
    if (a.excludes?.some((x) => unique.includes(x))) {
      throw new BookingError(`${a.label} can't be combined with another headlight option`);
    }
    lines.push({ id, label: a.label, amount: a.price });
    extraMinutes += a.extraMinutes ?? 0;
  }

  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return {
    service,
    size,
    zone,
    addons: unique,
    lines,
    total,
    isFrom: Boolean(svc.variable),
    extraMinutes,
  };
}

// Base price of every service for a size and zone (for the service picker).
export function priceMenu({ size, zone }) {
  if (!SIZES[size]) throw new BookingError('Unknown vehicle size');
  const out = {};
  for (const [id, svc] of Object.entries(SERVICES)) {
    out[id] = {
      label: svc.label,
      price: svc.flat ?? svc.prices[zone][size],
      isFrom: Boolean(svc.variable),
    };
  }
  return out;
}
