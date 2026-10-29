import { getNextAvailable } from '../../lib/service.js';
import { realDeps } from '../../lib/runtime.js';

export async function onRequestGet() {
  try {
    const value = await getNextAvailable(realDeps(), { maxDays: 14 });
    return Response.json(value, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch {
    return Response.json({ available: false }, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }
}
