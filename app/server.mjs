// Local job board server. Listens on 127.0.0.1 only.
// Who can use it:
//   - the browser, after the Job Board shortcut (start.mjs) opens it with a one-time launch code; that sets an HttpOnly,
//     SameSite=Strict session cookie. API calls with the cookie must also send the X-Kit-CSRF header from this page's
//     own origin, so other websites (or other apps on another localhost port) can't use it;
//   - local scripts that know the per-install token in config.json (header X-Kit-Token): start.mjs, update.mjs, tests.
// The page itself never contains the token, so another user account on the same computer can't take it from the page.
// The Host header must be 127.0.0.1/localhost on this port (blocks DNS-rebinding attacks).
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { APP, DATA, LOGS } from './lib/paths.mjs';
import { loadConfig, saveConfig } from './lib/config.mjs';
import * as store from './lib/store.mjs';
import { ask, status as aiStatus, PROVIDERS } from './lib/ai.mjs';
import { check as checkUpdate, readState as updateState, writeState as writeUpdateState, localVersion } from './lib/update.mjs';
import { createRequire } from 'node:module';
import { harden } from './lib/secure.mjs';
const PDFMAKE = join(dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')), 'build', 'pdfmake.min.js');

const cfg = loadConfig();
if (!cfg.token) { cfg.token = randomBytes(24).toString('hex'); saveConfig(cfg); }
const TOKEN = cfg.token;
const PORT = Number(process.env.KIT_PORT || cfg.port || 4777);
mkdirSync(DATA, { recursive: true }); mkdirSync(LOGS, { recursive: true });
harden();
const SESSION = createHash('sha256').update('job-hunt-kit-session:' + TOKEN).digest('hex'); // cookie value; survives restarts and updates
const launchCodes = new Map(); // one-time code -> expiry
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

const MAX_BODY = 2 * 1024 * 1024;
const okHost = h => new RegExp('^(127\\.0\\.0\\.1|localhost):' + PORT + '$').test(h || '');
const same = (x, y) => { const a = Buffer.from(String(x || '')); const b = Buffer.from(String(y)); return a.length === b.length && timingSafeEqual(a, b); };
const tokenOk = t => same(t, TOKEN);
const cookieOf = req => (String(req.headers.cookie || '').match(/(?:^|;\s*)jhk_session=([a-f0-9]{64})/) || [])[1] || '';
const sessionOk = req => same(cookieOf(req), SESSION);
// Cookie requests must come from this page: custom header (forces a CORS preflight we never approve) and our own Origin.
const pageRequestOk = req => sessionOk(req) && req.headers['x-kit-csrf'] === '1' && (!req.headers.origin || ORIGINS.has(req.headers.origin))
  && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
const SECURITY_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin', 'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { ...SECURITY_HEADERS, 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
}

function pageConfig() {
  const c = loadConfig();
  return { name: c.name, city: c.city, region: c.region, country: c.country, currency: c.currency, floor: c.floor, goal: c.goal,
    tracks: c.tracks, school: c.school, workAuth: c.workAuth, onsiteRegions: c.onsiteRegions, provider: c.ai.provider,
    providerLabel: (PROVIDERS[c.ai.provider] || {}).label || c.ai.provider, isWindows: process.platform === 'win32', version: localVersion() };
}

// Every script tag gets this response's nonce; the CSP allows only those, so injected markup can't run script.
function boardHtml(nonce) {
  const html = readFileSync(join(APP, 'public', 'board.html'), 'utf8');
  const boot = '<script>window.__KIT=' + JSON.stringify({ cfg: pageConfig() }).replace(/</g, '\\u003c') + ';</script>';
  const shim = '<script>' + readFileSync(join(APP, 'public', 'shim.js'), 'utf8') + '</script>';
  return html.replace('<!--KIT-BOOT-->', boot + shim).replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
}
const csp = nonce => `default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
const LOCKED = `<!doctype html><meta charset="utf-8"><title>Job Board</title><style>body{font:16px system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5}</style>
<h1>Open your board with the Job Board shortcut</h1><p>For your privacy, the board only opens from this computer's <b>Job Board</b> shortcut (or by running <code>node start.mjs</code> in the kit's app folder). After that, this address works in this browser.</p>`;

const pickState = () => { const u = updateState(); return { state: u.state || 'idle', error: u.error || '', to: u.to || '', migrateNotes: u.migrateNotes || [], version: localVersion() }; };

let refreshChild = null;
function startRefresh() {
  if (refreshChild) return false;
  const out = join(LOGS, 'refresh-manual.log');
  refreshChild = spawn(process.execPath, [join(APP, 'refresh.mjs'), '--log', out], { cwd: APP, windowsHide: true, stdio: 'ignore' });
  refreshChild.on('close', () => { refreshChild = null; });
  return true;
}

const PATH_RE = /^(user\/(tracker|dates|queue|requests|prefs|profile|drafts)|stories\/[A-Za-z0-9_.~:@+-]{1,200})$/;

const server = createServer(async (req, res) => {
  try {
    if (!okHost(req.headers.host)) return send(res, 421, { error: 'bad host' });
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const code = url.searchParams.get('launch');
      if (code) {
        const exp = launchCodes.get(code);
        launchCodes.delete(code);
        if (exp && exp > Date.now()) {
          res.writeHead(302, { ...SECURITY_HEADERS, location: '/', 'cache-control': 'no-store',
            'set-cookie': `jhk_session=${SESSION}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` });
          return res.end();
        }
      }
      if (!sessionOk(req)) return send(res, 401, LOCKED, 'text/html');
      const nonce = randomBytes(16).toString('base64');
      res.setHeader('content-security-policy', csp(nonce));
      return send(res, 200, boardHtml(nonce), 'text/html');
    }
    // Static files the board needs to build PDFs (no personal data).
    const STATIC = { '/tailorpdf.js': [join(APP, 'public', 'tailorpdf.js'), 'text/javascript'], '/vendor/pdfmake.min.js': [PDFMAKE, 'text/javascript'] };
    for (const n of ['Regular', 'Bold', 'Italic', 'BoldItalic']) STATIC['/fonts/Carlito-' + n + '.ttf'] = [join(APP, 'fonts', 'Carlito-' + n + '.ttf'), 'font/ttf'];
    for (const f of ['bricolage-grotesque-latin-wght-normal', 'atkinson-hyperlegible-latin-400-normal', 'atkinson-hyperlegible-latin-700-normal', 'jetbrains-mono-latin-400-normal', 'jetbrains-mono-latin-600-normal'])
      STATIC['/fonts/' + f + '.woff2'] = [join(APP, 'public', 'fonts', f + '.woff2'), 'font/woff2'];
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'max-age=3600' });
      return res.end(readFileSync(file));
    }
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const viaToken = tokenOk(req.headers['x-kit-token']);
    if (!viaToken && !pageRequestOk(req)) return send(res, 403, { error: 'forbidden' });
    // One-time launch code for start.mjs (token holders only); valid for 2 minutes.
    if (req.method === 'POST' && url.pathname === '/api/launch') {
      if (!viaToken) return send(res, 403, { error: 'forbidden' });
      for (const [c, e] of launchCodes) if (e < Date.now()) launchCodes.delete(c);
      const code = randomBytes(24).toString('hex');
      launchCodes.set(code, Date.now() + 120e3);
      return send(res, 200, { code });
    }

    if (req.method === 'GET' && url.pathname === '/api/version') return send(res, 200, { v: store.version(), refreshing: !!refreshChild });
    if (req.method === 'GET' && url.pathname === '/api/all') return send(res, 200, { ...store.snapshot(), refreshing: !!refreshChild });
    if (req.method === 'GET' && url.pathname === '/api/ai-status') return send(res, 200, await aiStatus());
    if (req.method === 'GET' && url.pathname === '/api/update') return send(res, 200, { ...(await checkUpdate()), ...pickState() });

    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    const body = await readBody(req);

    if (url.pathname === '/api/write') {
      const { path, op, data } = body || {};
      if (!PATH_RE.test(path || '') || !['set', 'update'].includes(op) || !data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, { error: 'bad write' });
      const [kind, id] = path.split('/');
      if (kind === 'user') {
        const cur = store.getUser(id);
        if (op === 'update' && cur == null) return send(res, 409, { error: 'missing', code: 'invalid_argument' });
        store.putUser(id, op === 'set' ? data : store.merge(cur, data));
      } else {
        const all = store.getStories();
        if (!all[id]) return send(res, 404, { error: 'no such story' });
        const allowed = ['title', 's', 't', 'a', 'r', 'l', 'themes'];
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
        all[id] = op === 'set' ? { ...all[id], ...patch } : store.merge(all[id], patch);
        store.putStories(all);
      }
      return send(res, 200, { ok: true, v: store.version() });
    }
    if (url.pathname === '/api/ai') {
      const prompt = String((body && body.prompt) || '');
      if (!prompt || prompt.length > 60000) return send(res, 400, { error: 'prompt', code: 'prompt_too_large' });
      try { return send(res, 200, { text: await ask(prompt, { search: !!body.search }) }); }
      catch (e) { return send(res, 200, { error: e.message, code: e.code || 'ai_failed' }); }
    }
    if (url.pathname === '/api/refresh') return send(res, 200, { started: startRefresh(), refreshing: true });
    // Updates: check GitHub Releases, and run the updater in the background (it stops and restarts this server).
    if (url.pathname === '/api/update') return send(res, 200, { ...(await checkUpdate({ force: !!body.force })), ...pickState() });
    if (url.pathname === '/api/update/apply') {
      if (updateState().state === 'updating' && Date.now() - new Date(updateState().startedAt || 0).getTime() < 20 * 60e3) return send(res, 200, { started: false, state: 'updating' });
      writeUpdateState({ state: 'updating', startedAt: new Date().toISOString(), error: '' });
      const out = openSync(join(LOGS, 'update.log'), 'a');
      spawn(process.execPath, [join(APP, 'update.mjs'), '--yes', '--start-board'], { cwd: APP, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
      return send(res, 200, { started: true, state: 'updating' });
    }
    if (url.pathname === '/api/shutdown') {
      if (!viaToken) return send(res, 403, { error: 'forbidden' });
      send(res, 200, { ok: true }); setTimeout(() => process.exit(0), 200); return;
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, e.status || 500, { error: e.status === 400 ? 'bad request' : 'server error' });
  }
});
server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;

server.listen(PORT, '127.0.0.1', () => {
  console.log('Job board running at http://127.0.0.1:' + PORT + '/');
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log('Already running at http://127.0.0.1:' + PORT + '/'); process.exit(0); }
  throw e;
});
