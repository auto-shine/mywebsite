import { createBooking } from '../../lib/service.js';
import { json, readJson, realDeps, respond } from '../../lib/runtime.js';

// POST /api/book  (JSON body)
export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  return respond(async () => createBooking(await readJson(req), realDeps()));
};

export const config = { path: '/api/book' };
