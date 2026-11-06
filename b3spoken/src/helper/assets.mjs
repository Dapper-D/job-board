// Files that ship with the helper (the board pages and the employer catalog).
// From source they're read from disk; inside the Windows B3spoken.exe they're read from the files built into it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const sea = (() => { try { const s = process.getBuiltinModule?.('node:sea'); return s?.isSea() ? s : null; } catch { return null; } })();
export const insideExe = !!sea;

// name is relative to the b3spoken folder, e.g. 'src/helper/public/index.html' or 'catalog/employers.json'.
export function readAsset(name, encoding) {
  if (sea) { const buf = Buffer.from(sea.getRawAsset(name)); return encoding ? buf.toString(encoding) : buf; }
  return readFileSync(join(fileURLToPath(new URL('../../', import.meta.url)), name), encoding);
}

// Every file the .exe must carry (used by the Windows build).
export const ASSET_FILES = ['src/helper/public/index.html', 'src/helper/public/setup.html', 'src/helper/public/app.js', 'src/helper/public/setup.js', 'src/helper/public/app.css', 'catalog/employers.json'];
