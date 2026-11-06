// Downloads the daily job pool from the public job-pool release and checks it before use:
//   1. pool-meta.json gives the size and SHA-256 of pool.json.gz.
//   2. pool.json.gz must match both exactly, or it is thrown away and the last good copy is kept.
// Only github.com and GitHub's own download hosts are allowed; nothing about the person is sent.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from '../scan/http.mjs';
import { readJson, writeJson, writeBytes, ensureDir } from './paths.mjs';

export const RELEASE = 'https://github.com/Dapper-D/job-board/releases/download/job-pool';
const HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
const MAX_POOL_BYTES = 80 * 1024 * 1024;

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// Checks a downloaded pool against its meta. Returns the parsed pool or throws with a plain reason.
export function checkPool(gz, meta) {
  if (!meta || meta.version !== 1 || !/^[0-9a-f]{64}$/.test(meta.sha256 || '')) throw new Error('the pool description is missing or unreadable');
  if (gz.length !== meta.bytes) throw new Error(`the pool is ${gz.length} bytes but should be ${meta.bytes}`);
  if (sha256(gz) !== meta.sha256) throw new Error('the pool does not match its SHA-256 checksum');
  const pool = JSON.parse(gunzipSync(gz, { maxOutputLength: 400 * 1024 * 1024 }).toString('utf8'));
  if (pool.version !== 1 || !Array.isArray(pool.jobs)) throw new Error('the pool has an unknown format');
  return pool;
}

// get(url, opts) is injectable for tests; by default it is the safe HTTP client.
export async function updatePool(dir, { release = RELEASE, get = request, log = () => {} } = {}) {
  ensureDir(dir);
  const metaFile = join(dir, 'pool-meta.json'), poolFile = join(dir, 'pool.json.gz');
  const have = readJson(metaFile, null);
  const meta = (await get(`${release}/pool-meta.json`, { allow: HOSTS, parse: 'json', gapMs: 0 })).json;
  if (have && meta?.sha256 === have.sha256 && existsSync(poolFile)) {
    log('job pool is already up to date');
    return { updated: false, meta: have };
  }
  if (!meta || !(meta.bytes > 0) || meta.bytes > MAX_POOL_BYTES) throw new Error('the pool description is missing or unreadable');
  const r = await get(`${release}/pool.json.gz`, { allow: HOSTS, parse: 'buffer', gapMs: 0, maxBytes: MAX_POOL_BYTES, timeoutMs: 120_000, accept: 'application/octet-stream' });
  checkPool(r.buffer, meta); // throws before anything is saved
  writeBytes(poolFile, r.buffer);
  writeJson(metaFile, meta);
  log(`job pool updated: ${meta.count} jobs from ${meta.generatedAt}`);
  return { updated: true, meta };
}

// Reads the saved pool, checking it again (the file could have been changed on disk).
export function loadPool(dir) {
  const meta = readJson(join(dir, 'pool-meta.json'), null);
  const poolFile = join(dir, 'pool.json.gz');
  if (!meta || !existsSync(poolFile)) return null;
  try { return { meta, pool: checkPool(readFileSync(poolFile), meta) }; } catch { return null; }
}
