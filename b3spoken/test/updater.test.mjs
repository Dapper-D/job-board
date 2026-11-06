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
