import { getQuote } from '../../lib/service.js';
import { listParam, realDeps, respond } from '../../lib/runtime.js';

// GET /api/quote?postcode=CV8 1AB&size=M&service=EFD&addons=engine,softtop
export default async (req) =>
  respond(async () => {
    const url = new URL(req.url);
    return getQuote(
      {
        postcode: url.searchParams.get('postcode'),
        size: url.searchParams.get('size'),
        service: url.searchParams.get('service'),
        addons: listParam(url, 'addons'),
      },
      realDeps(),
    );
  });

export const config = { path: '/api/quote' };
