// Local preview with a FAKE calendar and postcode lookup (no iCloud, no internet needed).
//   node dev-mock-server.js   then open http://localhost:8888/book/
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUSINESS } from './lib/config.js';
import { parseBusy } from './lib/busy.js';
import { listParam, json, readJson, respond } from './lib/runtime.js';
import { createBooking, getAvailability, getQuote } from './lib/service.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const north = (miles, area) => ({ lat: BUSINESS.origin.lat + miles / 69.05, lng: BUSINESS.origin.lng, area });
const PLACES = {
  'CV8 1AB': north(1, 'Warwick'), 'CV31 1AA': north(5, 'Warwick'),
  'B95 5AA': north(14, 'Stratford-on-Avon'), 'OX16 5AA': north(24, 'Cherwell'), 'LE1 1AA': north(45, 'Leicester'),
};
const written = [];
const day = 86400000;
const now = () => Date.now();
const calendar = {
  async fetchBusy({ fromMs, toMs }) {
    const existing = [{ start: Date.now() + 3 * day, end: Date.now() + 4 * day }]; // a day off
    return [...existing, ...parseBusy(written.map((w) => w.ics), { rangeStartMs: fromMs, rangeEndMs: toMs, tz: BUSINESS.timezone })];
  },
  async createEvents(events) { written.push(...events); console.log('Calendar event created:\n' + events[0].ics); },
};
const deps = {
  now,
  calendar,
  geocode: async (pc) => {
    const p = PLACES[pc];
    if (!p) throw Object.assign(new Error("We couldn't find that postcode. Please check it and try again."), { code: 'invalid' });
    return p;
  },
};

const routes = {
  '/api/quote': (req, url) => respond(() => getQuote({ postcode: url.searchParams.get('postcode'), size: url.searchParams.get('size'), service: url.searchParams.get('service'), addons: listParam(url, 'addons') }, deps)),
  '/api/availability': (req, url) => respond(() => getAvailability({ postcode: url.searchParams.get('postcode'), size: url.searchParams.get('size'), service: url.searchParams.get('service'), addons: listParam(url, 'addons') }, deps)),
  '/api/book': async (req) => (req.method === 'POST' ? respond(async () => createBooking(await readJson(req), deps)) : json(405, { error: 'Use POST' })),
};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer(async (nodeReq, nodeRes) => {
  const url = new URL(nodeReq.url, 'http://localhost');
  let response;
  if (routes[url.pathname]) {
    const body = ['GET', 'HEAD'].includes(nodeReq.method) ? undefined : await new Promise((r) => { let d = ''; nodeReq.on('data', (c) => (d += c)); nodeReq.on('end', () => r(d)); });
    response = await routes[url.pathname](new Request(url, { method: nodeReq.method, body }), url);
  } else {
    let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    if (p.endsWith('/')) p += 'index.html';
    try {
      let data;
      try { data = await readFile(join(root, p)); }
      catch { data = await readFile(join(root, p + '.html')); p += '.html'; } // pretty URLs: /book -> book.html
      response = new Response(data, { headers: { 'Content-Type': types[extname(p)] || 'application/octet-stream' } });
    } catch { response = new Response('Not found', { status: 404 }); }
  }
  nodeRes.writeHead(response.status, Object.fromEntries(response.headers));
  nodeRes.end(Buffer.from(await response.arrayBuffer()));
}).listen(8888, () => console.log('Preview on http://localhost:8888/book/'));
