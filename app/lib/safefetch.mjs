// Fetches a public web page safely. Job links come from job boards and pasted text, so a link could point at
// this computer, the home router or a cloud metadata address. This refuses that:
//   - https only, on every redirect hop (max 5), standard ports only;
//   - every address the name resolves to is checked, and the connection is pinned to the checked address
//     (no DNS-rebinding gap between the check and the connection);
//   - private, loopback, link-local, carrier-grade NAT, multicast and reserved ranges are blocked (IPv4 and IPv6);
//   - responses are capped at 3 MB and 20 seconds, and gzip/brotli/deflate are decoded.
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

const block = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) block.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) block.addSubnet(a, p, 'ipv6');

export function isPublicAddress(ip) {
  const v = net.isIP(ip);
  if (!v) return false;
  if (v === 6) {
    const m = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (m) return isPublicAddress(m[1]);
    return !block.check(ip, 'ipv6');
  }
  return !block.check(ip, 'ipv4');
}

const testMode = () => process.env.KIT_ALLOW_HTTP === '1';
function safeLookup(hostname, opts, cb) {
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs.filter(a => testMode() || isPublicAddress(a.address));
    if (!list.length) { const e = new Error('blocked: ' + hostname + ' points to a private or local address'); e.code = 'EBLOCKED'; return cb(e); }
    if (opts && opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function once(u, { headers, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', headers: { 'accept-encoding': 'gzip, deflate, br', ...headers }, lookup: safeLookup, timeout: timeoutMs }, res => {
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      const chunks = []; let n = 0;
      stream.on('data', c => { n += c.length; if (n > maxBytes) { req.destroy(); stream.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), truncated: true }); } else chunks.push(c); });
      stream.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { name: 'AbortError' })));
    req.on('error', reject);
    req.end();
  });
}

// Returns { status, url (final), body } or throws an Error whose message is safe to show.
export async function safeFetch(url, { headers = {}, timeoutMs = 20000, maxBytes = 3_000_000, maxRedirects = 5 } = {}) {
  let u = new URL(url);
  for (let hop = 0; ; hop++) {
    if (u.protocol !== 'https:' && !(testMode() && u.protocol === 'http:')) throw new Error('not an https link');
    if (u.username || u.password) throw new Error('links with a username or password are not opened');
    if (u.port && !['443', ''].includes(u.port) && !testMode()) throw new Error('unusual port ' + u.port);
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && !testMode() && !isPublicAddress(u.hostname.replace(/^\[|\]$/g, ''))) throw new Error('blocked: private or local address');
    const r = await once(u, { headers, timeoutMs, maxBytes });
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      if (hop >= maxRedirects) throw new Error('too many redirects');
      u = new URL(r.headers.location, u);
      continue;
    }
    return { status: r.status, url: u.href, body: r.body };
  }
}
