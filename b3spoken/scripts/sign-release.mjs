// Signs a B3spoken release: writes SHA256SUMS for the files and an Ed25519 signature of it (SHA256SUMS.sig).
// The private key is read from the file named in B3SPOKEN_RELEASE_KEY (the release workflow writes it from the
// environment secret and deletes it straight after). The key must match release-key.json, or nothing is signed.
//   B3SPOKEN_RELEASE_KEY=key.pem node scripts/sign-release.mjs dist/B3spoken-Setup-0.1.0.exe
//   node scripts/sign-release.mjs --verify dist   (anyone: checks SHA256SUMS.sig and every listed file)
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const pub = createPublicKey({ key: Buffer.from(JSON.parse(readFileSync(new URL('../release-key.json', import.meta.url), 'utf8')).ed25519SpkiBase64, 'base64'), format: 'der', type: 'spki' });
const fingerprint = createHash('sha256').update(pub.export({ format: 'der', type: 'spki' })).digest('hex').slice(0, 32).match(/.{4}/g).join(':');
const args = process.argv.slice(2);

if (args[0] === '--verify') {
  const dir = args[1] || 'dist';
  const sums = readFileSync(join(dir, 'SHA256SUMS'));
  if (!verify(null, sums, pub, Buffer.from(readFileSync(join(dir, 'SHA256SUMS.sig'), 'utf8').trim(), 'base64'))) { console.error('BAD SIGNATURE'); process.exit(1); }
  for (const line of sums.toString('utf8').trim().split('\n')) {
    const [hash, name] = line.split(/\s+\*?/);
    if (createHash('sha256').update(readFileSync(join(dir, name))).digest('hex') !== hash) { console.error(`BAD FILE ${name}`); process.exit(1); }
  }
  console.log(`Signature and files OK (release key ${fingerprint})`);
} else {
  if (!process.env.B3SPOKEN_RELEASE_KEY) { console.error('B3SPOKEN_RELEASE_KEY is not set'); process.exit(1); }
  const key = createPrivateKey(readFileSync(process.env.B3SPOKEN_RELEASE_KEY));
  if (createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64') !== pub.export({ format: 'der', type: 'spki' }).toString('base64')) { console.error('This key does not match release-key.json; nothing was signed.'); process.exit(1); }
  const dir = dirname(args[0]);
  const sums = args.map(f => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${basename(f)}`).join('\n') + '\n';
  writeFileSync(join(dir, 'SHA256SUMS'), sums);
  writeFileSync(join(dir, 'SHA256SUMS.sig'), sign(null, Buffer.from(sums), key).toString('base64') + '\n');
  console.log(`Signed ${args.length} file(s). Release key fingerprint: ${fingerprint}`);
}
