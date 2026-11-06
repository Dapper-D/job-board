// Builds the Windows B3spoken.exe (one file with Node and the helper inside) and its installer.
//   node scripts/build-exe.mjs            -> dist/B3spoken.exe, dist/B3spoken-Setup-<version>.exe
// Runs on Windows (GitHub Actions windows-latest). Build tools are pinned and used only here, never shipped:
// esbuild (bundles the helper into one file), postject (puts it into a copy of node.exe), Inno Setup (installer).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_FILES } from '../src/helper/assets.mjs';

const ESBUILD = 'esbuild@0.24.0', POSTJECT = 'postject@1.0.0-alpha.6';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const npx = (...args) => execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
rmSync('dist', { recursive: true, force: true }); mkdirSync('dist');

// 1. One CommonJS file with the whole helper (no outside packages are used at run time).
npx(ESBUILD, 'src/helper/cli.mjs', '--bundle', '--platform=node', '--format=cjs', '--target=node22', '--outfile=dist/b3spoken.cjs', '--define:import.meta.url=undefined', '--log-level=warning');

// 2. A Node single executable: the bundle plus the board pages and the employer catalog.
writeFileSync('dist/sea-config.json', JSON.stringify({ main: 'dist/b3spoken.cjs', output: 'dist/sea-prep.blob', disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, assets: Object.fromEntries(ASSET_FILES.map(f => [f, f])) }, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', 'dist/sea-config.json'], { stdio: 'inherit' });
const exe = join('dist', process.platform === 'win32' ? 'B3spoken.exe' : 'b3spoken');
copyFileSync(process.execPath, exe);
if (process.platform === 'win32') { try { execFileSync('signtool', ['remove', '/s', exe], { stdio: 'inherit' }); } catch { console.log('signtool not found; continuing (the copied Node signature becomes invalid either way)'); } }
npx(POSTJECT, exe, 'NODE_SEA_BLOB', 'dist/sea-prep.blob', '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []));

// 3. The Windows installer (per user, no admin rights needed).
if (process.platform === 'win32') {
  const iscc = ['C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe', 'C:\\Program Files\\Inno Setup 6\\ISCC.exe'].find(existsSync) || 'iscc';
  execFileSync(iscc, [`/DAppVersion=${version}`, '/Odist', 'installer\\b3spoken.iss'], { stdio: 'inherit' });
}
console.log(`Built ${exe}${process.platform === 'win32' ? ` and dist\\B3spoken-Setup-${version}.exe` : ''}`);
