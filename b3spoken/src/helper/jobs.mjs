// The person's job list: the shared daily pool plus Job Bank, fetched on their own computer.
// Duplicates between the two are merged, so each job is shown and counted once.
import { join } from 'node:path';
import { SOURCES } from '../scan/sources/index.mjs';
import { dedupe } from '../scan/scan.mjs';
import { readJson, writeJson } from './paths.mjs';

const JOBBANK_EVERY_MS = 6 * 3600e3; // Job Bank at most every 6 hours (it asks for 5 s between requests)

export async function refreshJobBank(dir, settings, { now = Date.now(), force = false, log = () => {}, fetchJobs } = {}) {
  const file = join(dir, 'jobbank.json');
  const have = readJson(file, null);
  if (!force && have && now - have.fetchedAt < JOBBANK_EVERY_MS && JSON.stringify(have.keywords) === JSON.stringify(settings.keywords || [])) return have;
  const get = fetchJobs || (t => SOURCES.jobbank.fetchJobs(t, { now }));
  log('checking Job Bank for postings from the last 3 days…');
  const jobs = (await get({ keywords: settings.keywords || [], maxAgeDays: 3, maxPages: 40 })).filter(j => j.canada);
  const saved = { fetchedAt: now, keywords: settings.keywords || [], jobs };
  writeJson(file, saved);
  log(`Job Bank: ${jobs.length} postings`);
  return saved;
}

export function mergeJobs(poolJobs = [], jobBankJobs = []) {
  return dedupe([...poolJobs, ...jobBankJobs]).sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
}

const PROVINCE_NAMES = { BC: 'british columbia', AB: 'alberta', SK: 'saskatchewan', MB: 'manitoba', ON: 'ontario', QC: 'quebec|québec', NB: 'new brunswick', NS: 'nova scotia', PE: 'prince edward island', NL: 'newfoundland|labrador', YT: 'yukon', NT: 'northwest territories', NU: 'nunavut' };
export const PROVINCES = Object.keys(PROVINCE_NAMES);

export function inProvince(job, code) {
  const names = PROVINCE_NAMES[code]; if (!names) return true;
  const loc = String(job.location || '');
  return new RegExp(`(,|\\(|\\s-|^)\\s*${code}\\b(?!-)`).test(loc) || new RegExp(`\\b(${names})\\b`, 'i').test(loc);
}

// Filters for the board. Every filter is optional.
export function queryJobs(jobs, { q = '', province = '', remote = '', maxAgeDays = 0, source = '', offset = 0, limit = 50, now = Date.now() } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const cutoff = maxAgeDays > 0 ? now - maxAgeDays * 864e5 : 0;
  const hits = jobs.filter(j => {
    if (source && j.source !== source) return false;
    if (remote === 'only' && !j.remote) return false;
    if (province && !(inProvince(j, province) || (remote !== 'no' && j.remote))) return false;
    if (cutoff && !(Date.parse(j.postedAt) >= cutoff)) return false;
    if (words.length) { const hay = `${j.title} ${j.company} ${j.department || ''} ${j.location}`.toLowerCase(); if (!words.every(w => hay.includes(w))) return false; }
    return true;
  });
  // The list shows the first 3 places; the full job (GET /api/jobs/<id>) keeps them all.
  const slim = ({ description, ...rest }) => {
    const places = String(rest.location || '').split(' / ');
    return { ...rest, location: places.slice(0, 3).join(' / '), moreLocations: Math.max(0, places.length - 3), snippet: String(description || '').slice(0, 280) };
  };
  return { total: hits.length, jobs: hits.slice(offset, offset + Math.min(limit, 200)).map(slim) };
}
