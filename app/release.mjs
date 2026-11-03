#!/usr/bin/env node
// For the maintainer only: sign releases so kits can tell a genuine update from a tampered one.
//   node release.mjs keygen   once: makes your private signing key (kept OUTSIDE the repo, in your home folder)
//                             and writes the matching public key into app/kit.json, update-kit.ps1 and update-kit.sh
//   node release.mjs fingerprint  anyone: shows the fingerprint of the release key built into this kit
//   node release.mjs pack     for each release: builds dist/job-hunt-kit-<version>.tar.gz and its .sig
//                             (upload both to the GitHub release)
// Back up the private key file somewhere safe (a password manager or USB stick). If it's lost, kits can't verify new
// releases any more and everyone has to update once with update-kit.ps1/.sh after you make a new key. Never commit it,
// email it or paste it anywhere.
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { APP, KIT } from './lib/paths.mjs';
import { listFiles, localVersion, assetName, verifyRelease } from './lib/update.mjs';

const KEY = process.env.JHK_RELEASE_KEY || join(homedir(), '.job-hunt-kit', 'release-signing-key.pem');
const cmd = process.argv[2];

function setPublicKey(pub) {
  const kj = join(APP, 'kit.json');
  const j = existsSync(kj) ? JSON.parse(readFileSync(kj, 'utf8')) : {};
  j.releaseKey = pub; writeFileSync(kj, JSON.stringify(j, null, 2) + '\n');
  for (const f of ['update-kit.ps1', 'update-kit.sh']) {
    const p = join(KIT, f); if (!existsSync(p)) continue;
    writeFileSync(p, readFileSync(p, 'utf8').replace(/(RELEASE_KEY\s*=\s*['"])[^'"]*(['"])/, `$1${pub}$2`));
  }
}

if (cmd === 'keygen') {
  if (existsSync(KEY) && !process.argv.includes('--force')) { console.log('A signing key already exists at ' + KEY + '. (Use --force to replace it; kits trusting the old key would then stop updating.)'); }
  else {
    const { privateKey } = generateKeyPairSync('ed25519');
    mkdirSync(dirname(KEY), { recursive: true });
    writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    try { chmodSync(KEY, 0o600); } catch {}
    if (process.platform === 'win32') spawnSync('icacls', [KEY, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], { stdio: 'ignore' });
    console.log('Private signing key saved to ' + KEY + ' (back it up; never share or commit it).');
  }
  const pub = createPrivateKeyPub();
  setPublicKey(pub);
  console.log('Public key written to app/kit.json, update-kit.ps1 and update-kit.sh:\n  ' + pub + '\nCommit and push those three files.');
  console.log('Fingerprint (put it in the README and your release notes): ' + fingerprint(pub));
} else if (cmd === 'pack') {
  if (!existsSync(KEY)) { console.log('No signing key at ' + KEY + '. Run: node release.mjs keygen'); process.exit(1); }
  const pub = createPrivateKeyPub();
  const kitKey = JSON.parse(readFileSync(join(APP, 'kit.json'), 'utf8')).releaseKey;
  if (kitKey !== pub) { console.log('app/kit.json has a different public key than your signing key. Run: node release.mjs keygen'); process.exit(1); }
  const v = localVersion();
  const name = assetName(v), top = 'job-hunt-kit-' + v;
  const dist = join(KIT, 'dist'), stage = join(dist, top);
  rmSync(stage, { recursive: true, force: true });
  // Never ship key files or anything that looks like one, even if one was saved in the kit folder by mistake.
  const files = listFiles(KIT).filter(f => !f.startsWith('dist') && !/\.(pem|key|p8|p12|pfx)$/i.test(f) && !/(^|[\\/])\.env$/.test(f));
  if (listFiles(KIT).some(f => /\.(pem|key)$/i.test(f))) console.log('Note: a key file inside the kit folder was left out of the release. Keep your signing key outside the repo.');
  for (const f of files) { mkdirSync(dirname(join(stage, f)), { recursive: true }); copyFileSync(join(KIT, f), join(stage, f)); }
  const out = join(dist, name);
  const t = spawnSync('tar', ['-czf', out, '-C', dist, top], { stdio: 'inherit' });
  if (t.status !== 0) { console.log('tar failed'); process.exit(1); }
  rmSync(stage, { recursive: true, force: true });
  const data = readFileSync(out);
  const sig = sign(null, data, createPrivateKey(readFileSync(KEY))).toString('base64');
  writeFileSync(out + '.sig', sig + '\n');
  if (!verifyRelease(data, sig, pub)) { console.log('Signature check failed'); process.exit(1); }
  console.log('Paste this line into the release notes:\n  Release key fingerprint: ' + fingerprint(pub));
  console.log(`Made ${files.length} files into:\n  ${out}\n  ${out}.sig\nOn GitHub: Releases -> Draft a new release -> tag v${v} -> attach BOTH files -> Publish.`);
} else if (cmd === 'fingerprint') {
  const k = JSON.parse(readFileSync(join(APP, 'kit.json'), 'utf8')).releaseKey;
  console.log(k ? 'Release key fingerprint: ' + fingerprint(k) : 'This kit has no release key.');
} else {
  console.log('Use: node release.mjs keygen | pack | fingerprint');
}
function createPrivateKeyPub() {
  return createPublicKey(createPrivateKey(readFileSync(KEY))).export({ type: 'spki', format: 'der' }).toString('base64');
}
// Short, readable fingerprint of a public key: SHA-256 of the key, first 16 bytes, in groups.
function fingerprint(pubB64) {
  return createHash('sha256').update(Buffer.from(pubB64, 'base64')).digest('hex').slice(0, 32).toUpperCase().match(/.{4}/g).join(' ');
}
