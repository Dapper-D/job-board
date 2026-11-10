// The person's job list: the shared daily pool plus Job Bank, fetched on their own computer.
// Duplicates between the two are merged, so each job is shown and counted once.
import { join } from 'node:path';
import { SOURCES } from '../scan/sources/index.mjs';
import { dedupe } from '../scan/scan.mjs';
import { readJson, writeJson } from './paths.mjs';
import { provincesOf } from './places.mjs';

const JOBBANK_EVERY_MS = 6 * 3600e3; // Job Bank at most every 6 hours (it asks for 5 s between requests)
const JOBBANK_RETRY_MS = 3600e3; // after a partial result, try again in an hour

export async function refreshJobBank(dir, settings, { now = Date.now(), force = false, log = () => {}, fetchJobs } = {}) {
  const file = join(dir, 'jobbank.json');
  const have = readJson(file, null);
  if (!force && have && now - have.fetchedAt < (have.missed ? JOBBANK_RETRY_MS : JOBBANK_EVERY_MS) && JSON.stringify(have.keywords) === JSON.stringify(settings.keywords || [])) return have;
  const missed = [];
  const get = fetchJobs || (t => SOURCES.jobbank.fetchJobs(t, { now, onError: e => missed.push({ keyword: e.keyword || '', error: e.code || e.message }) }));
  log(`checking Job Bank for postings from the last ${MAX_AGE_DAYS} days…`);
  const jobs = (await get({ keywords: settings.keywords || [], maxAgeDays: MAX_AGE_DAYS, maxPages: 40 })).filter(j => j.canada);
  const saved = { fetchedAt: now, keywords: settings.keywords || [], jobs, ...(missed.length ? { missed } : {}) };
  writeJson(file, saved);
  log(`Job Bank: ${jobs.length} postings`);
  return saved;
}

export function mergeJobs(poolJobs = [], jobBankJobs = []) {
  return dedupe([...poolJobs, ...jobBankJobs]).sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
}

const PROVINCE_NAMES = { BC: 'british columbia', AB: 'alberta', SK: 'saskatchewan', MB: 'manitoba', ON: 'ontario', QC: 'quebec|québec', NB: 'new brunswick', NS: 'nova scotia', PE: 'prince edward island', NL: 'newfoundland|labrador', YT: 'yukon', NT: 'northwest territories', NU: 'nunavut' };
export const PROVINCES = Object.keys(PROVINCE_NAMES);

// In the province by its name, its code ("Burnaby, BC") or one of its cities ("Burnaby, Canada", "Toronto Office").
export function inProvince(job, code) {
  if (!PROVINCE_NAMES[code]) return true;
  return provincesOf(job.location).has(code);
}

// Filters for the board. Every filter is optional.
// Fresh jobs first: the board shows the last 3 days unless the person picks 24 hours, 2 days, 7 days or 14 days.
// A job with no posting date counts from the day the daily scan first saw it (firstSeen); with neither, it's left out.
export const DEFAULT_AGE_DAYS = 3;
export const MAX_AGE_DAYS = 14;
// Board tabs: '' is "To apply" (not tracked yet, or saved); each status has its own tab; 'due' is follow-ups; 'tracked' is all of them.
export const STATUS_VIEWS = ['applied', 'interview', 'offer', 'rejected', 'not-interested'];
export const VIEWS = ['', 'tracked', 'due', ...STATUS_VIEWS];
// A job nobody applied to (not tracked, only saved or noted, or pasted in) leaves the board once it's more than
// 14 days old: from its posting date, else the day it was pasted, else the day the daily scan first saw it.
// Jobs the person acted on (applied, interview, offer, rejected, not interested) stay in their tabs for good.
const ACTED = ['applied', 'interview', 'offer', 'rejected', 'not-interested'];
const jobDate = j => Date.parse(j.postedAt || j.pastedAt || j.firstSeen || '');
export const expired = (j, now = Date.now()) => !ACTED.includes(j.track?.status) && jobDate(j) < now - MAX_AGE_DAYS * 864e5;
const isDue = (t, today) => !!(t?.followUp && t.followUp <= today && !['rejected', 'not-interested', 'offer'].includes(t.status));
// How many jobs are in each tab (tracked tabs only; the To apply count comes with the list).
export function viewCounts(jobs, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const out = { tracked: 0, due: 0, ...Object.fromEntries(STATUS_VIEWS.map(v => [v, 0])) };
  for (const j of jobs) {
    const t = j.track; if (!t || expired(j, now)) continue;
    if (t.status || t.notes) out.tracked++;
    if (STATUS_VIEWS.includes(t.status)) out[t.status]++;
    if (isDue(t, today)) out.due++;
  }
  return out;
}
export function queryJobs(jobs, { q = '', province = '', remote = '', maxAgeDays = DEFAULT_AGE_DAYS, source = '', offset = 0, limit = 50, now = Date.now(), sort = 'score', showSkipped = false, minLabel = '', view = '' } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const LABELS = ['Stretch', 'Good', 'Strong'];
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const days = Math.min(MAX_AGE_DAYS, Math.max(1, Number(maxAgeDays) || DEFAULT_AGE_DAYS));
  const cutoff = now - days * 864e5;
  const hits = jobs.filter(j => {
    if (expired(j, now)) return false;
    if (view === 'tracked') { if (!j.track?.status && !j.track?.notes) return false; }
    else if (view === 'due') { if (!isDue(j.track, today)) return false; }
    else if (STATUS_VIEWS.includes(view)) { if (j.track?.status !== view) return false; }
    else if (j.track?.status && j.track.status !== 'saved') return false; // To apply: jobs you've acted on move to their own tab
    // Tracked tabs show every job in them, whatever the filters, so each tab holds exactly what its count says.
    if (view) return true;
    if (j.match && j.match.label === 'Skip' && !showSkipped && !j.pasted && !j.track) return false; // Skip jobs never appear (unless the person added or tracked them)
    if (minLabel && j.match && LABELS.indexOf(j.match.label) < LABELS.indexOf(minLabel)) return false;
    if (source && j.source !== source) return false;
    if (remote === 'only' && !j.remote) return false;
    if (province && !(inProvince(j, province) || (remote !== 'no' && j.remote))) return false;
    if (!j.pasted && !j.track && !(Date.parse(j.postedAt || j.firstSeen) >= cutoff)) return false; // saved and pasted jobs stay until they expire
    if (words.length) { const hay = `${j.title} ${j.company} ${j.department || ''} ${j.location}`.toLowerCase(); if (!words.every(w => hay.includes(w))) return false; }
    return true;
  });
  // The list shows the first 3 places; the full job (GET /api/jobs/<id>) keeps them all.
  const slim = ({ description, ...rest }) => {
    const places = String(rest.location || '').split(' / ');
    return { ...rest, location: places.slice(0, 3).join(' / '), moreLocations: Math.max(0, places.length - 3), snippet: String(description || '').slice(0, 280) };
  };
  if (sort === 'score') hits.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0) || String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
  return { total: hits.length, jobs: hits.slice(offset, offset + Math.min(limit, 200)).map(slim) };
}
