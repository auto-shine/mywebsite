import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS } from '../lib/config.js';
import { haversineMiles, lookupPostcode, normalisePostcode, resolveZone, zoneForMiles } from '../lib/zones.js';

// A point `miles` due north of the CV8 centre.
const north = (miles) => ({ lat: BUSINESS.origin.lat + miles / 69.05, lng: BUSINESS.origin.lng });

test('distance helper is accurate (1 degree of latitude is about 69 miles)', () => {
  const d = haversineMiles({ lat: 52, lng: -1.5 }, { lat: 53, lng: -1.5 });
  assert.ok(Math.abs(d - 69.1) < 0.3, String(d));
});

test('zone boundaries: 10 / 20 / 30 miles', () => {
  assert.equal(zoneForMiles(0), 'Z1');
  assert.equal(zoneForMiles(9.99), 'Z1');
  assert.equal(zoneForMiles(10), 'Z1');
  assert.equal(zoneForMiles(10.01), 'Z2');
  assert.equal(zoneForMiles(20), 'Z2');
  assert.equal(zoneForMiles(20.01), 'Z3');
  assert.equal(zoneForMiles(30), 'Z3');
  assert.equal(zoneForMiles(30.01), null);
});

test('postcodes resolve to the right zone end to end', async () => {
  const cases = [[3, 'Z1'], [9.5, 'Z1'], [10.5, 'Z2'], [19.5, 'Z2'], [21, 'Z3'], [29.5, 'Z3'], [31, null]];
  for (const [miles, zone] of cases) {
    const r = await resolveZone('cv8 1ab', { geocode: async () => north(miles) });
    assert.equal(r.zone, zone, `${miles} miles`);
    assert.equal(r.postcode, 'CV8 1AB');
  }
});

test('postcode formats are normalised', () => {
  assert.equal(normalisePostcode('cv81ab'), 'CV8 1AB');
  assert.equal(normalisePostcode(' CV8  1AB '), 'CV8 1AB');
  assert.equal(normalisePostcode('b90 4xx'), 'B90 4XX');
  assert.equal(normalisePostcode('SW1A 1AA'), 'SW1A 1AA');
  assert.equal(normalisePostcode('M1 1AE'), 'M1 1AE');
});

test('rubbish postcodes are rejected', () => {
  for (const bad of ['', 'hello', 'CV8', '12345', 'CV8 1', 'CV8 1ABC', null, undefined, '<script>']) {
    assert.throws(() => normalisePostcode(bad), /postcode/i, String(bad));
  }
});

test('postcode lookup: success, unknown postcode, outage', async () => {
  const ok = async () => ({ status: 200, ok: true, json: async () => ({ result: { latitude: 52.3, longitude: -1.5, admin_district: 'Warwick' } }) });
  assert.deepEqual(await lookupPostcode('CV8 1AB', ok), { lat: 52.3, lng: -1.5, area: 'Warwick' });

  const notFound = async () => ({ status: 404, ok: false, json: async () => ({}) });
  await assert.rejects(() => lookupPostcode('CV8 1AB', notFound), /couldn't find/);

  const down = async () => ({ status: 503, ok: false, json: async () => ({}) });
  await assert.rejects(() => lookupPostcode('CV8 1AB', down), (e) => e.code === 'upstream');

  const noCoords = async () => ({ status: 200, ok: true, json: async () => ({ result: { latitude: null, longitude: null } }) });
  await assert.rejects(() => lookupPostcode('CV8 1AB', noCoords), /couldn't find/);
});
