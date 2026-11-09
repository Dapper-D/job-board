import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { newer, pickRelease, verifyDownload, runInstaller } from '../src/helper/updater.mjs';
import { VERSION } from '../src/helper/version.mjs';

test('version in the app matches package.json', () => {
  assert.equal(VERSION, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
});

test('picks the newest signed B3spoken release above this version', () => {
  assert.ok(newer('0.1.10', '0.1.9')); assert.ok(!newer('0.1.3', '0.1.3')); assert.ok(!newer('0.0.9', '0.1.0'));
  const rel = (tag, files = ['B3spoken-Setup-X.exe', 'SHA256SUMS', 'SHA256SUMS.sig'], extra = {}) => ({ tag_name: tag, html_url: `https://github.com/x/releases/tag/${tag}`, assets: files.map(n => ({ name: n.replace('X', tag.replace('b3spoken-v', '')), browser_download_url: `https://github.com/d/${n}`, size: 1 })), ...extra });
  const list = [rel('v2.2.0'), rel('b3spoken-v0.1.2'), rel('b3spoken-v0.2.0', ['B3spoken-Setup-X.exe']), rel('b3spoken-v0.1.9'), rel('b3spoken-v0.3.0', undefined, { draft: true }), rel('job-pool')];
  const p = pickRelease(list, '0.1.3');
  assert.equal(p.version, '0.1.9'); // 0.2.0 isn't signed (no SHA256SUMS), 0.3.0 is a draft
  assert.equal(p.installer.name, 'B3spoken-Setup-0.1.9.exe');
  assert.equal(pickRelease(list, '0.1.9'), null);
});

test('an update only installs when signed with the release key and the installer matches', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519').privateKey;
  const installer = Buffer.from('the installer');
  const sums = Buffer.from(`${createHash('sha256').update(installer).digest('hex')}  B3spoken-Setup-0.1.9.exe\n`);
  const sig = sign(null, sums, privateKey).toString('base64');
  assert.ok(verifyDownload({ installerName: 'B3spoken-Setup-0.1.9.exe', installer, sums, sig }, publicKey));
  assert.throws(() => verifyDownload({ installerName: 'B3spoken-Setup-0.1.9.exe', installer, sums, sig: sign(null, sums, other).toString('base64') }, publicKey), /not signed/);
  assert.throws(() => verifyDownload({ installerName: 'B3spoken-Setup-0.1.9.exe', installer: Buffer.from('tampered'), sums, sig }, publicKey), /checksum/);
  assert.throws(() => verifyDownload({ installerName: 'Other.exe', installer, sums, sig }, publicKey), /include/);
  // The real release key is the one built into the app.
  assert.match(JSON.parse(readFileSync(new URL('../release-key.json', import.meta.url), 'utf8')).ed25519SpkiBase64, /^MCowBQYDK2VwAyEA/);
});

test('installs silently, then reopens the same B3spoken.exe', () => {
  let call;
  runInstaller('C:\\Users\\a\\AppData\\Local\\B3spoken\\updates\\B3spoken-Setup-0.1.9.exe', { exe: 'E:\\Apps\\B3spoken\\B3spoken.exe', platform: 'win32', spawnFn: (f, a, o) => { call = [f, a, o]; return { on() {}, unref() {} }; } });
  assert.equal(call[0], 'cmd.exe');
  assert.match(call[1][0], /"C:\\Users\\a\\AppData\\Local\\B3spoken\\updates\\B3spoken-Setup-0\.1\.9\.exe" \/VERYSILENT .* & start "" "E:\\Apps\\B3spoken\\B3spoken\.exe"/);
  assert.throws(() => runInstaller('x', { platform: 'darwin' }), /only available on Windows/);
});

// A tiny tar writer for tests (ustar headers).
function tar(entries) {
  const blocks = [];
  for (const { name, data = '', type = '0' } of entries) {
    const body = Buffer.from(data);
    const h = Buffer.alloc(512);
    h.write(name, 0, 100); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(body.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136);
    h.write('        ', 148); h.write(type, 156); h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

test('source updates: unpack only the app’s own files into the install folder', async () => {
  const { gzipSync } = await import('node:zlib');
  const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { installSource, untarGz, pickRelease } = await import('../src/helper/updater.mjs');
  const gz = gzipSync(tar([
    { name: 'b3spoken/', type: '5' },
    { name: 'b3spoken/src/helper/main.mjs', data: 'new app' },
    { name: 'setup.ps1', data: 'new setup' },
    { name: '../evil.txt', data: 'x' },
    { name: 'app/kit.mjs', data: 'not ours' },
    { name: 'b3spoken/link', type: '2' },
  ]));
  assert.equal(untarGz(gz).length, 5); // the link is skipped
  const root = mkdtempSync(join(tmpdir(), 'b3-src-'));
  const file = join(root, 'pkg.tar.gz'); writeFileSync(file, gz);
  const inst = join(root, 'install');
  assert.equal(installSource(file, inst), 2);
  assert.equal(readFileSync(join(inst, 'b3spoken', 'src', 'helper', 'main.mjs'), 'utf8'), 'new app');
  assert.equal(readFileSync(join(inst, 'setup.ps1'), 'utf8'), 'new setup');
  assert.ok(!existsSync(join(root, 'evil.txt')) && !existsSync(join(inst, 'app')));
  const bad = join(root, 'bad.tar.gz'); writeFileSync(bad, gzipSync(tar([{ name: 'README.md', data: 'x' }])));
  assert.throws(() => installSource(bad, inst), /missing the app/);
  const rel = pickRelease([{ tag_name: 'b3spoken-v9.9.9', assets: ['B3spoken-Setup-9.9.9.exe', 'B3spoken-source-9.9.9.tar.gz', 'SHA256SUMS', 'SHA256SUMS.sig'].map(n => ({ name: n, browser_download_url: `https://github.com/x/${n}` })) }], '0.1.3');
  assert.equal(rel.source.name, 'B3spoken-source-9.9.9.tar.gz');
});
