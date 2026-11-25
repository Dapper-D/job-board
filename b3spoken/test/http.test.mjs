import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp, hostAllowed, request } from '../src/scan/http.mjs';

test('private and reserved addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'not-an-ip'])
    assert.equal(isBlockedIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '104.16.0.1', '2606:4700::1111'])
    assert.equal(isBlockedIp(ip), false, ip);
});

// An IPv4 address can be written inside an IPv6 one in several ways; every one must be checked as that IPv4
// address. Writing 127.0.0.1 in hex (::ffff:7f00:1) used to get past the block.
test('IPv4 addresses hidden in IPv6 are blocked however they are written', () => {
  for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:0000:7f00:0001',
    '::ffff:a00:1', '::ffff:c0a8:1', '::ffff:ac10:1', '::ffff:a9fe:a9fe', '::ffff:192.168.1.1',
    '::127.0.0.1', '::7f00:1', '::ffff:0.0.0.0'])
    assert.equal(isBlockedIp(ip), true, ip);
  for (const ip of ['::ffff:8.8.8.8', '::ffff:808:808', '::ffff:6810:1'])
    assert.equal(isBlockedIp(ip), false, ip); // public addresses still pass, in either spelling
});

test('host rules', () => {
  assert.equal(hostAllowed('ubc.wd10.myworkdayjobs.com', ['*.myworkdayjobs.com']), true);
  assert.equal(hostAllowed('myworkdayjobs.com.evil.example', ['*.myworkdayjobs.com']), false);
  assert.equal(hostAllowed('evilmyworkdayjobs.com', ['*.myworkdayjobs.com']), false);
  assert.equal(hostAllowed('API.LEVER.CO', ['api.lever.co']), true);
});

test('request refuses http, other hosts and local addresses before connecting', async () => {
  await assert.rejects(request('http://api.lever.co/x', { allow: ['api.lever.co'] }), /non-HTTPS/);
  await assert.rejects(request('https://example.com/x', { allow: ['api.lever.co'] }), /not allowed/);
  await assert.rejects(request('https://localhost/x', { allow: ['localhost'], retries: 0 }), /private or reserved/);
});

test('a host that resets the connection is tried again straight away with a smaller first TLS message', async () => {
  const { request, CLASSIC_CURVES, resetCompat } = await import('../src/scan/http.mjs');
  resetCompat();
  const seen = [];
  const send = async (_u, o) => { seen.push(o.ecdhCurve || 'default'); if (!o.ecdhCurve) throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }); return { status: 200, headers: {}, buffer: Buffer.from('ok'), text: 'ok' }; };
  const r = await request('https://www.jobbank.gc.ca/x', { allow: ['www.jobbank.gc.ca'], parse: 'text', gapMs: 0, send });
  assert.equal(r.text, 'ok');
  assert.deepEqual(seen, ['default', CLASSIC_CURVES]);
  await request('https://www.jobbank.gc.ca/y', { allow: ['www.jobbank.gc.ca'], parse: 'text', gapMs: 0, send });
  assert.deepEqual(seen.slice(2), [CLASSIC_CURVES]); // remembered for that host
  resetCompat();
});
