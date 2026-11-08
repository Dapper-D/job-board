// Updates: finds a newer B3spoken release on GitHub, downloads it, and installs it only if it is signed with
// the release key built into this app. The person's own files (resume, answers, tracker, documents) live in
// their data folder and are never touched by an update.
//   1. GET api.github.com/repos/Dapper-D/job-board/releases: the newest b3spoken-v* release above this version.
//   2. Download its installer, SHA256SUMS and SHA256SUMS.sig.
//   3. Check the signature (Ed25519, release-key.json) and the installer's SHA-256. Any mismatch: nothing runs.
//   4. Windows: run the installer silently, then reopen B3spoken from the same folder. Other systems: show the link.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { request } from '../scan/http.mjs';
import { readAsset } from './assets.mjs';
import { ensureDir, writeBytes } from './paths.mjs';

const REPO = 'Dapper-D/job-board';
const HOSTS = ['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

export const parseVersion = v => (String(v).match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
export function newer(a, b) { // is version a newer than b?
  const x = parseVersion(a), y = parseVersion(b);
  if (x.length < 3 || y.length < 3) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

export function pickRelease(releases, current) {
  let best = null;
  for (const r of releases || []) {
    if (r.draft || !/^b3spoken-v\d+\.\d+\.\d+$/.test(r.tag_name || '')) continue;
    const v = r.tag_name.slice('b3spoken-v'.length);
    if (!newer(v, current) || (best && !newer(v, best.version))) continue;
    const asset = name => (r.assets || []).find(a => a.name === name);
    const installer = (r.assets || []).find(a => /^B3spoken-Setup-\d+\.\d+\.\d+\.exe$/.test(a.name));
    if (!installer || !asset('SHA256SUMS') || !asset('SHA256SUMS.sig')) continue;
    const source = (r.assets || []).find(a => /^B3spoken-source-\d+\.\d+\.\d+\.tar\.gz$/.test(a.name));
    best = { version: v, tag: r.tag_name, page: r.html_url, installer: { name: installer.name, url: installer.browser_download_url, size: installer.size }, source: source ? { name: source.name, url: source.browser_download_url, size: source.size } : null, sums: asset('SHA256SUMS').browser_download_url, sig: asset('SHA256SUMS.sig').browser_download_url };
  }
  return best;
}

export async function checkForUpdate(current, { get = request } = {}) {
  const r = await get(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { allow: HOSTS, parse: 'json', accept: 'application/vnd.github+json', gapMs: 0, retries: 1 });
  return pickRelease(r.json, current);
}

const releaseKey = () => createPublicKey({ key: Buffer.from(JSON.parse(readAsset('release-key.json', 'utf8')).ed25519SpkiBase64, 'base64'), format: 'der', type: 'spki' });

// Throws unless the sums file is signed by the release key and lists this installer with this exact hash.
export function verifyDownload({ installerName, installer, sums, sig }, key = releaseKey()) {
  if (!verify(null, sums, key, Buffer.from(String(sig).trim(), 'base64'))) throw new Error('the update is not signed with the B3spoken release key');
  const line = sums.toString('utf8').split('\n').map(l => l.trim().split(/\s+\*?/)).find(([, name]) => name === installerName);
  if (!line) throw new Error('the update’s checksum list doesn’t include the installer');
  if (createHash('sha256').update(installer).digest('hex') !== line[0]) throw new Error('the downloaded installer doesn’t match its checksum');
  return true;
}

// kind: 'installer' (the Windows .exe) or 'source' (the source .tar.gz, for installs made with setup.ps1 / setup.sh).
export async function downloadUpdate(rel, dir, { get = request, kind = 'installer' } = {}) {
  const want = rel[kind];
  if (!want) throw new Error(`this release has no ${kind === 'source' ? 'source package' : 'installer'}`);
  const fetchBuf = (url, max) => get(url, { allow: HOSTS, parse: 'buffer', gapMs: 0, maxBytes: max, timeoutMs: 300_000, accept: 'application/octet-stream' }).then(r => r.buffer);
  const [file, sums, sig] = [await fetchBuf(want.url, 200 * 1024 * 1024), await fetchBuf(rel.sums, 64 * 1024), await fetchBuf(rel.sig, 64 * 1024)];
  verifyDownload({ installerName: want.name, installer: file, sums, sig });
  const out = join(ensureDir(join(dir, 'updates')), want.name);
  writeBytes(out, file);
  return out;
}

// ---- Source installs: unpack a verified source .tar.gz over the install folder ----
// Only these top-level names are written; nothing outside the folder, no links, no absolute or ".." paths.
const SOURCE_TOP = new Set(['b3spoken', 'setup.cmd', 'uninstall.cmd', 'setup.ps1', 'setup.sh', 'uninstall.ps1', 'uninstall.sh', 'README.md', 'HANDOFF.md', 'LICENSE', 'SECURITY.md']);
export function untarGz(gz) {
  const buf = gunzipSync(gz, { maxOutputLength: 300 * 1024 * 1024 });
  const files = [];
  let longName = null;
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    let name = str(345, 500) ? `${str(345, 500)}/${str(0, 100)}` : str(0, 100);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (type === 'x' || type === 'g') { const m = data.toString('utf8').match(/\d+ path=([^\n]+)\n/); if (m) longName = m[1]; continue; }
    if (longName) { name = longName; longName = null; }
    if (type !== '0' && type !== '\0' && type !== '5') continue; // regular files and folders only (no links)
    files.push({ name: name.replace(/^\.\//, ''), dir: type === '5', data });
  }
  return files;
}

export function installSource(tgzFile, root, { fs = { readFileSync, writeFileSync, mkdirSync } } = {}) {
  const files = untarGz(fs.readFileSync(tgzFile));
  const safe = files.filter(f => {
    const parts = f.name.split('/').filter(Boolean);
    return parts.length && SOURCE_TOP.has(parts[0]) && !parts.some(p => p === '..' || p === '.' || /[:\\]/.test(p)) && !f.name.startsWith('/');
  });
  if (!safe.some(f => f.name === 'b3spoken/src/helper/main.mjs')) throw new Error('the source package is missing the app');
  for (const f of safe) {
    const target = join(root, ...f.name.split('/').filter(Boolean));
    if (f.dir) fs.mkdirSync(target, { recursive: true });
    else { fs.mkdirSync(dirname(target), { recursive: true }); fs.writeFileSync(target, f.data); }
  }
  return safe.filter(f => !f.dir).length;
}

// Restart B3spoken from the updated source folder, after this one has stopped.
export function restartFromSource(root, { spawnFn = spawn, platform = process.platform, node = process.execPath } = {}) {
  const helper = join(root, 'b3spoken', 'src', 'helper', 'main.mjs');
  const q = s => `"${String(s).replace(/"/g, '')}"`;
  const child = platform === 'win32'
    ? spawnFn('cmd.exe', [`/c timeout /t 2 /nobreak >nul & start "B3spoken" /D ${q(root)} ${q(node)} ${q(helper)}`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
    : spawnFn('/bin/sh', ['-c', `sleep 2; cd ${q(root)} && exec ${q(node)} ${q(helper)} >/dev/null 2>&1`], { detached: true, stdio: 'ignore' });
  child.on?.('error', () => {}); child.unref?.();
  return { started: true };
}

// Windows: install silently, then reopen this same B3spoken.exe (the installer keeps the folder it was installed in).
export function runInstaller(file, { exe = process.execPath, spawnFn = spawn, platform = process.platform } = {}) {
  if (platform !== 'win32') throw new Error('automatic install is only available on Windows for now');
  const q = s => `"${String(s).replace(/"/g, '')}"`;
  const line = `/c timeout /t 2 /nobreak >nul & ${q(file)} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS & start "" ${q(exe)}`;
  const child = spawnFn('cmd.exe', [line], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true });
  child.on?.('error', () => {}); child.unref?.();
  return { started: true };
}
