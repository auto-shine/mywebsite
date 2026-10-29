import { createBooking } from '../../lib/service.js';
import { realDeps } from '../../lib/runtime.js';

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const result = await createBooking(body, realDeps());
    return Response.json(result, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return Response.json(
      { error: err?.message || 'Booking failed' },
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
