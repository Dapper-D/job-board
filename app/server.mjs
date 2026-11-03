// Local job board server. Listens on 127.0.0.1 only.
// Every API call must carry the per-install token that is injected into the page,
// and the Host header must be localhost, so other websites can't read or change your data.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { APP, DATA, LOGS } from './lib/paths.mjs';
import { loadConfig, saveConfig } from './lib/config.mjs';
import * as store from './lib/store.mjs';
import { ask, status as aiStatus, PROVIDERS } from './lib/ai.mjs';
import { createRequire } from 'node:module';
const PDFMAKE = join(dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')), 'build', 'pdfmake.min.js');

const cfg = loadConfig();
if (!cfg.token) { cfg.token = randomBytes(24).toString('hex'); saveConfig(cfg); }
const TOKEN = cfg.token;
const PORT = Number(process.env.KIT_PORT || cfg.port || 4777);
mkdirSync(DATA, { recursive: true }); mkdirSync(LOGS, { recursive: true });

const MAX_BODY = 2 * 1024 * 1024;
const okHost = h => new RegExp('^(127\\.0\\.0\\.1|localhost):' + PORT + '$').test(h || '');
const tokenOk = t => { const a = Buffer.from(String(t || '')); const b = Buffer.from(TOKEN); return a.length === b.length && timingSafeEqual(a, b); };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function pageConfig() {
  const c = loadConfig();
  return { name: c.name, city: c.city, region: c.region, country: c.country, currency: c.currency, floor: c.floor, goal: c.goal,
    tracks: c.tracks, school: c.school, workAuth: c.workAuth, onsiteRegions: c.onsiteRegions, provider: c.ai.provider,
    providerLabel: (PROVIDERS[c.ai.provider] || {}).label || c.ai.provider, isWindows: process.platform === 'win32' };
}

function boardHtml() {
  const html = readFileSync(join(APP, 'public', 'board.html'), 'utf8');
  const boot = '<script>window.__KIT=' + JSON.stringify({ token: TOKEN, cfg: pageConfig() }).replace(/</g, '\\u003c') + ';</script>';
  const shim = '<script>' + readFileSync(join(APP, 'public', 'shim.js'), 'utf8') + '</script>';
  return html.replace('<!--KIT-BOOT-->', boot + shim);
}

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
      res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'");
      res.setHeader('x-frame-options', 'DENY');
      return send(res, 200, boardHtml(), 'text/html');
    }
    // Static files the board needs to build PDFs (no personal data).
    const STATIC = { '/tailorpdf.js': [join(APP, 'public', 'tailorpdf.js'), 'text/javascript'], '/vendor/pdfmake.min.js': [PDFMAKE, 'text/javascript'] };
    for (const n of ['Regular', 'Bold', 'Italic', 'BoldItalic']) STATIC['/fonts/Carlito-' + n + '.ttf'] = [join(APP, 'fonts', 'Carlito-' + n + '.ttf'), 'font/ttf'];
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=3600', 'x-content-type-options': 'nosniff' });
      return res.end(readFileSync(file));
    }
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (!tokenOk(req.headers['x-kit-token'])) return send(res, 403, { error: 'forbidden' });

    if (req.method === 'GET' && url.pathname === '/api/version') return send(res, 200, { v: store.version(), refreshing: !!refreshChild });
    if (req.method === 'GET' && url.pathname === '/api/all') return send(res, 200, { ...store.snapshot(), refreshing: !!refreshChild });
    if (req.method === 'GET' && url.pathname === '/api/ai-status') return send(res, 200, await aiStatus());

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
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Job board running at http://127.0.0.1:' + PORT + '/');
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log('Already running at http://127.0.0.1:' + PORT + '/'); process.exit(0); }
  throw e;
});
