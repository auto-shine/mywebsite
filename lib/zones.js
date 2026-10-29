import { BUSINESS, ZONES } from './config.js';
import { BookingError } from './pricing.js';

const toRad = (d) => (d * Math.PI) / 180;

export function haversineMiles(a, b) {
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function zoneForMiles(miles) {
  const z = ZONES.find((zone) => miles <= zone.maxMiles);
  return z ? z.id : null;
}

const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;

export function normalisePostcode(raw) {
  const cleaned = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const withSpace = cleaned.replace(/^(.+?)(\d[A-Z]{2})$/, '$1 $2');
  const m = POSTCODE_RE.exec(withSpace);
  if (!m) throw new BookingError('Please enter a full UK postcode, for example CV8 1AB');
  return `${m[1]} ${m[2]}`;
}

// Real lookup via the free postcodes.io service.
export async function lookupPostcode(postcode, fetchImpl = fetch) {
  const res = await fetchImpl(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (res.status === 404) throw new BookingError("We couldn't find that postcode. Please check it and try again.");
  if (!res.ok) throw new BookingError('Postcode lookup is unavailable right now', 'upstream');
  const json = await res.json();
  const r = json.result;
  if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') {
    throw new BookingError("We couldn't find that postcode. Please check it and try again.");
  }
  return { lat: r.latitude, lng: r.longitude, area: r.admin_district || r.parish || '' };
}

// Postcode in, zone out. zone is null when the address is beyond the last zone.
export async function resolveZone(rawPostcode, { geocode = lookupPostcode } = {}) {
  const postcode = normalisePostcode(rawPostcode);
  const point = await geocode(postcode);
  const miles = haversineMiles(BUSINESS.origin, point);
  return {
    postcode,
    area: point.area || '',
    miles: Math.round(miles * 10) / 10,
    zone: zoneForMiles(miles),
  };
}
