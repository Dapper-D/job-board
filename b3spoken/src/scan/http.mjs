// The only way scanners reach the internet.
// - HTTPS only, to hosts the source declares, with redirects checked the same way.
// - Every address is looked up first and private / local addresses are refused;
//   the connection then uses that same checked address (no second lookup).
// - Size and time limits, polite per-host spacing, retries on 429 and 5xx.
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

export const USER_AGENT = 'B3spokenBot/0.1 (+https://github.com/Dapper-D/job-board)';
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

// Private, loopback, link-local, carrier-grade NAT, multicast and reserved ranges.
const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4num = ip => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
export function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const n = v4num(ip);
    return BLOCKED_V4.some(([base, bits]) => (n >>> (32 - bits)) === (v4num(base) >>> (32 - bits)));
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || /^2001:db8/.test(x) || /^64:ff9b/.test(x);
  }
  return true;
}

// Host rules: exact names, or '*.example.com' for any subdomain.
export function hostAllowed(host, allowed) {
  host = host.toLowerCase();
  return allowed.some(a => a.startsWith('*.') ? host.endsWith(a.slice(1)) && host.length > a.length - 1 : host === a);
}

function checkedLookup(hostname, opts, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter(a => !isBlockedIp(a.address));
    if (!ok.length) return cb(Object.assign(new Error(`${hostname} resolves only to private or reserved addresses`), { code: 'EBLOCKED' }));
    if (opts && opts.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

const lastHit = new Map();
async function polite(host, gapMs) {
  const wait = (lastHit.get(host) || 0) + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));

function once(url, { method, headers, body, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, lookup: checkedLookup, timeout: timeoutMs }, res => {
      const chunks = []; let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > maxBytes) { req.destroy(new Error('response too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => { const buffer = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, buffer, text: buffer.toString('utf8') }); });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * request(url, { allow: ['api.lever.co'], method, json, headers, gapMs, retries, netWaitMs })
 * Returns { status, buffer, text, json? }. parse: 'json' | 'text' | 'buffer'; maxBytes raises the 15 MB limit. Throws on network errors, refused hosts and final non-2xx.
 */
export async function request(url, o = {}) {
  const allow = o.allow || [];
  const method = o.method || 'GET';
  const headers = { 'user-agent': USER_AGENT, accept: o.accept || 'application/json, application/xml;q=0.9, */*;q=0.5', ...(o.headers || {}) };
  let body;
  if (o.json !== undefined) { body = JSON.stringify(o.json); headers['content-type'] = 'application/json'; }
  if (body) headers['content-length'] = Buffer.byteLength(body);
  let u = new URL(url);
  const retries = o.retries ?? 2;
  for (let redirects = 0, attempt = 0; ;) {
    if (u.protocol !== 'https:') throw new Error(`refused non-HTTPS URL: ${u.href}`);
    if (!hostAllowed(u.hostname, allow)) throw Object.assign(new Error(`refused host not allowed for this source: ${u.hostname}`), { code: 'EHOST', url: u.href });
    await polite(u.hostname, o.gapMs ?? 500);
    let r;
    try { r = await once(u, { method, headers, body, timeoutMs: o.timeoutMs, maxBytes: o.maxBytes }); }
    catch (e) {
      if (e.code === 'EBLOCKED' || attempt >= retries) throw e;
      attempt++; await sleep((o.netWaitMs ?? 1500) * attempt); continue; // e.g. the server cut the connection
    }
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      if (++redirects > MAX_REDIRECTS) throw new Error('too many redirects');
      u = new URL(r.headers.location, u); continue;
    }
    if ((r.status === 429 || r.status >= 500) && attempt < retries) {
      const ra = Number(r.headers['retry-after']);
      attempt++; await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : Math.min((r.status === 429 ? 4000 : 2000) * 2 ** (attempt - 1), 30000)); continue;
    }
    if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(`HTTP ${r.status} from ${u.hostname}`), { status: r.status });
    if (o.parse === 'buffer') return r;
    if (o.parse !== 'text') { try { r.json = JSON.parse(r.text); } catch { if (o.parse === 'json') throw new Error(`bad JSON from ${u.hostname}`); } }
    return r;
  }
}
