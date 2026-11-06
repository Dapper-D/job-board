// Updates: finds a newer B3spoken release on GitHub, downloads it, and installs it only if it is signed with
// the release key built into this app. The person's own files (resume, answers, tracker, documents) live in
// their data folder and are never touched by an update.
//   1. GET api.github.com/repos/Dapper-D/job-board/releases: the newest b3spoken-v* release above this version.
//   2. Download its installer, SHA256SUMS and SHA256SUMS.sig.
//   3. Check the signature (Ed25519, release-key.json) and the installer's SHA-256. Any mismatch: nothing runs.
//   4. Windows: run the installer silently, then reopen B3spoken from the same folder. Other systems: show the link.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
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
    best = { version: v, tag: r.tag_name, page: r.html_url, installer: { name: installer.name, url: installer.browser_download_url, size: installer.size }, sums: asset('SHA256SUMS').browser_download_url, sig: asset('SHA256SUMS.sig').browser_download_url };
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

export async function downloadUpdate(rel, dir, { get = request } = {}) {
  const fetchBuf = (url, max) => get(url, { allow: HOSTS, parse: 'buffer', gapMs: 0, maxBytes: max, timeoutMs: 300_000, accept: 'application/octet-stream' }).then(r => r.buffer);
  const [installer, sums, sig] = [await fetchBuf(rel.installer.url, 200 * 1024 * 1024), await fetchBuf(rel.sums, 64 * 1024), await fetchBuf(rel.sig, 64 * 1024)];
  verifyDownload({ installerName: rel.installer.name, installer, sums, sig });
  const folder = ensureDir(join(dir, 'updates'));
  const file = join(folder, rel.installer.name);
  writeBytes(file, installer);
  return file;
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
