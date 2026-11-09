// Live check of the updater against the real GitHub releases: pretends to be version 0.0.1, finds the newest
// published B3spoken release, downloads it and verifies its signature with the release key built into the app.
// It never runs the installer.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkForUpdate, downloadUpdate } from '../src/helper/updater.mjs';

const rel = await checkForUpdate('0.0.1');
if (!rel) { console.error('FAIL no B3spoken release found'); process.exit(1); }
const file = await downloadUpdate(rel, mkdtempSync(join(tmpdir(), 'b3-upd-')));
console.log(`OK found ${rel.version}, downloaded ${rel.installer.name} and verified its signature (${file})`);
