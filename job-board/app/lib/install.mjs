// Installs an AI CLI into the kit's own tools/ folder (no admin rights, nothing global).
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT } from './paths.mjs';
import { PROVIDERS } from './ai.mjs';
import { sh } from './platform.mjs';

export function installProvider(provider) {
  const P = PROVIDERS[provider];
  const dir = join(KIT, 'tools');
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, 'package.json'))) writeFileSync(join(dir, 'package.json'), '{ "name": "job-hunt-kit-tools", "private": true }\n');
  const entry = join(dir, 'node_modules', ...P.entry);
  console.log((existsSync(entry) ? 'Updating ' : 'Installing ') + P.label + '...');
  const r = sh('npm', ['install', '--prefix', dir, '--no-fund', '--no-audit', P.pkg + '@latest']);
  if (!r.ok || !existsSync(entry)) { console.log('Could not install ' + P.label + '. Check your internet connection and run setup again.'); return false; }
  return true;
}
