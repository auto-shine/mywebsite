import { getNextAvailable } from '../../lib/service.js';
import { realDeps } from '../../lib/runtime.js';

// GET /api/next-available  ->  { available: true, date, label, daysAway } or { available: false }
// Used by the homepage strip. Never returns an error to the visitor: if anything goes wrong the strip just hides.
// The answer is remembered for 10 minutes so the homepage doesn't ask the calendar on every visit.
const TTL_MS = 10 * 60 * 1000;
let cached = null;

export default async () => {
  let value;
  if (cached && Date.now() - cached.at < TTL_MS) {
    value = cached.value;
  } else {
    try {
      value = await getNextAvailable(realDeps(), { maxDays: 14 });
      cached = { at: Date.now(), value };
    } catch (err) {
      console.warn('next-available failed:', err?.message ?? err);
      value = { available: false };
    }
  }
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
    },
  });
};

export const config = { path: '/api/next-available' };
