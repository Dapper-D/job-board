// The helper's local web server. It is only reachable from this computer:
// - listens on 127.0.0.1 only;
// - answers only requests addressed to 127.0.0.1:<port> or localhost:<port> (blocks DNS-rebinding tricks);
// - every /api call needs this run's secret token, which only the board page served here knows
//   (other websites can't read that page, and no cross-site headers are ever sent);
// - the page is locked down with a strict Content-Security-Policy.
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { queryJobs, PROVINCES } from './jobs.mjs';

import { readAsset } from './assets.mjs';
const page = f => readAsset(`src/helper/public/${f}`);
const STATIC = { '/app.js': 'text/javascript; charset=utf-8', '/app.css': 'text/css; charset=utf-8', '/setup.js': 'text/javascript; charset=utf-8' };
const PAGES = { '/': 'index.html', '/index.html': 'index.html', '/setup': 'setup.html' };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const sameToken = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

async function readBody(req, max = 1e6) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error('request too large'), { status: 413 }); chunks.push(c); }
  const text = Buffer.concat(chunks).toString('utf8');
  try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('bad JSON'), { status: 400 }); }
}

// app: { status(), jobs(), job(id), settings(), saveSettings(s), refresh() }
export function createServer(app, { token = randomBytes(24).toString('base64url') } = {}) {
  let port = 0;
  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  const server = http.createServer(async (req, res) => {
    try {
      const host = String(req.headers.host || '').toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 421, { error: 'wrong host' });
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname === '/health') return send(res, 200, { app: 'b3spoken' }); // lets a second start find this one
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
        if (PAGES[url.pathname]) {
          const html = page(PAGES[url.pathname]).toString('utf8').replace('__TOKEN__', token);
          return send(res, 200, html, 'text/html; charset=utf-8', { 'content-security-policy': CSP, 'x-frame-options': 'DENY' });
        }
        if (STATIC[url.pathname]) return send(res, 200, page(url.pathname.slice(1)), STATIC[url.pathname]);
        return send(res, 404, { error: 'not found' });
      }
      if (!sameToken(req.headers['x-b3spoken-token'], token)) return send(res, 403, { error: 'missing or wrong token' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) return send(res, 403, { error: 'wrong origin' });
      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /api/status') return send(res, 200, await app.status());
      if (route === 'GET /api/jobs') {
        const p = Object.fromEntries(url.searchParams);
        const province = PROVINCES.includes(p.province) ? p.province : '';
        return send(res, 200, queryJobs(app.jobs(), { q: String(p.q || '').slice(0, 200), province, remote: p.remote, source: p.source, maxAgeDays: Number(p.maxAgeDays) || 3, offset: Math.max(0, Number(p.offset) || 0), limit: Math.max(1, Number(p.limit) || 50), sort: p.sort === 'date' ? 'date' : 'score', view: ['tracked', 'due'].includes(p.view) ? p.view : '', minLabel: ['Good', 'Strong'].includes(p.minLabel) ? p.minLabel : '' }));
      }
      const prepM = url.pathname.match(/^\/api\/jobs\/(.+)\/prep$/);
      if (prepM && req.method === 'POST') return send(res, 200, await app.prep(decodeURIComponent(prepM[1])));
      const docs = url.pathname.match(/^\/api\/jobs\/(.+)\/documents(?:\/(resume|letter))?$/);
      if (docs) {
        const id = decodeURIComponent(docs[1]);
        if (req.method === 'POST' && !docs[2]) return send(res, 200, await app.makeDocuments(id));
        if (req.method === 'GET' && !docs[2]) return send(res, 200, app.documents(id) || {});
        if (req.method === 'GET') { const f = app.documentFile(id, docs[2]); return send(res, 200, f.bytes, 'application/pdf', { 'content-disposition': `attachment; filename="${f.name.replace(/[^\w .,-]/g, '_')}"` }); }
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
        const job = app.job(decodeURIComponent(url.pathname.slice('/api/jobs/'.length)));
        return job ? send(res, 200, job) : send(res, 404, { error: 'no such job' });
      }
      if (route === 'GET /api/settings') return send(res, 200, app.settings());
      if (route === 'PUT /api/settings') return send(res, 200, app.saveSettings(await readBody(req)));
      if (route === 'POST /api/refresh') { const r = app.refresh(); r.catch?.(() => {}); return send(res, 202, { started: true }); }
      // One-click AI setup
      if (route === 'POST /api/ai/install') return send(res, 202, app.aiInstall((await readBody(req)).provider));
      if (route === 'GET /api/ai/install') return send(res, 200, app.aiInstallStatus());
      if (route === 'POST /api/ai/signin') return send(res, 200, app.aiSignIn((await readBody(req)).provider));
      if (route === 'POST /api/ai/test') return send(res, 200, await app.aiTest((await readBody(req)).provider));
      if (route === 'POST /api/ai/detect') return send(res, 200, await app.aiDetect());
      // Board: tracker, pasted links, documents already made.
      if (route === 'GET /api/tracker') return send(res, 200, { entries: app.tracker(), due: app.dueCount(), documents: app.documentIndex() });
      if (req.method === 'PUT' && url.pathname.startsWith('/api/tracker/')) return send(res, 200, app.track(decodeURIComponent(url.pathname.slice('/api/tracker/'.length)), await readBody(req)));
      if (route === 'POST /api/paste') return send(res, 200, await app.paste(String((await readBody(req)).url || '').slice(0, 2000)));
      // Onboarding: resume, library, roles and answers.
      if (route === 'POST /api/resume') return send(res, 200, app.uploadResume(await readBody(req, 15e6)));
      if (route === 'POST /api/resume/ai') return send(res, 200, await app.resumeWithAi((await readBody(req)).provider));
      if (route === 'GET /api/library') return send(res, 200, app.library() || {});
      if (req.method === 'PUT' && url.pathname.startsWith('/api/library/bullets/')) return send(res, 200, app.updateBullet(decodeURIComponent(url.pathname.slice('/api/library/bullets/'.length)), await readBody(req)));
      if (route === 'POST /api/roles/check') return send(res, 200, app.checkRole((await readBody(req)).target));
      if (route === 'GET /api/profile') return send(res, 200, app.profile());
      if (route === 'PUT /api/profile') return send(res, 200, app.saveProfile(await readBody(req)));
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, e.status || 500, { error: e.status ? e.message : 'something went wrong in the helper' });
      if (!e.status) console.error(e);
    }
  });
  return {
    server, token,
    listen(wanted = 4747) {
      return new Promise((resolve, reject) => {
        const tryPort = p => {
          server.once('error', e => (e.code === 'EADDRINUSE' && p !== 0 ? tryPort(p === wanted + 9 ? 0 : p + 1) : reject(e)));
          server.listen(p, '127.0.0.1', () => { port = server.address().port; resolve(port); });
        };
        tryPort(wanted);
      });
    },
    close: () => new Promise(r => server.close(r)),
    get port() { return port; },
  };
}
