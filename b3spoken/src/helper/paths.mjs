// Where the helper keeps its files on each person's computer. Nothing is kept anywhere else.
//   Windows: %LOCALAPPDATA%\B3spoken     Mac: ~/Library/Application Support/B3spoken
//   Linux:   $XDG_DATA_HOME/b3spoken (or ~/.local/share/b3spoken)
// B3SPOKEN_HOME overrides all of these (used by the tests).
import { homedir } from 'node:os';
import { join, win32, posix } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

export function dataDir(env = process.env, platform = process.platform, home = homedir()) {
  if (env.B3SPOKEN_HOME) return env.B3SPOKEN_HOME;
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'B3spoken');
  if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', 'B3spoken');
  return posix.join(env.XDG_DATA_HOME || posix.join(home, '.local', 'share'), 'b3spoken');
}

export function ensureDir(dir) { mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; }

export function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Write to a temporary file first, then rename, so a crash never leaves half a file.
export function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

export function writeBytes(file, buf) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, buf, { mode: 0o600 });
  renameSync(tmp, file);
}
