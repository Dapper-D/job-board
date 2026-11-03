// Tiny JSON-file store. Docs live in data/: jobs.json, stories.json, meta.json, user/<name>.json
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA, LIB_FILE } from './paths.mjs';

export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}
export function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
}

export const USER_DOCS = ['tracker', 'dates', 'queue', 'requests', 'prefs', 'profile', 'drafts'];
const f = {
  jobs: () => join(DATA, 'jobs.json'),
  stories: () => join(DATA, 'stories.json'),
  meta: () => join(DATA, 'meta.json'),
  user: n => join(DATA, 'user', n + '.json'),
  version: () => join(DATA, 'version.json'),
};

export const getJobs = () => readJson(f.jobs(), {});
export const getStories = () => readJson(f.stories(), {});
export const getMeta = () => readJson(f.meta(), {});
export const getUser = n => readJson(f.user(n), null);
export const version = () => readJson(f.version(), { v: 0 }).v;
function bump() { writeJsonAtomic(f.version(), { v: version() + 1, at: new Date().toISOString() }); }

export function putJobs(j) { writeJsonAtomic(f.jobs(), j); bump(); }
export function putStories(s) { writeJsonAtomic(f.stories(), s); bump(); }
export function putMeta(m) { writeJsonAtomic(f.meta(), m); bump(); }
export function putUser(n, v) { if (!USER_DOCS.includes(n)) throw new Error('unknown doc ' + n); writeJsonAtomic(f.user(n), v); bump(); }

// Deep merge for plain objects; arrays and scalars replace; null is stored as null (the page treats it as removed).
export function merge(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = merge(out[k], v);
    else out[k] = v;
  }
  return out;
}

export function snapshot() {
  const user = {};
  for (const n of USER_DOCS) user[n] = getUser(n);
  return { v: version(), jobs: getJobs(), stories: getStories(), meta: getMeta(), lib: readJson(LIB_FILE, null), user };
}
