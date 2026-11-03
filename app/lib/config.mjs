import { readFileSync, existsSync } from 'node:fs';
import { CONFIG, ENV } from './paths.mjs';
import { writeJsonAtomic } from './store.mjs';

export const DEFAULTS = {
  name: '', email: '', phone: '', city: '', region: '', country: 'Canada',
  workAuth: '', authorizedIn: [], needsSponsorshipElsewhere: true,
  roles: [], tracks: [], seniority: 'entry',
  currency: 'CAD', floor: 0, goal: 0,
  onsiteRegions: [], remoteCountries: [],
  school: '', facts: '', neverClaim: [], answers: {},
  ai: { provider: 'codex', model: '', maxEvalPerRun: 30, maxQueuePerRun: 25, maxTailorPerRun: 15, timeoutSec: 300 },
  port: 4777, refreshTime: '06:40',
};

export function loadConfig() {
  let c = {};
  if (existsSync(CONFIG)) { try { c = JSON.parse(readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { throw new Error('config.json is not valid JSON: ' + e.message); } }
  return { ...DEFAULTS, ...c, ai: { ...DEFAULTS.ai, ...(c.ai || {}) } };
}
export function saveConfig(c) { writeJsonAtomic(CONFIG, c); }

// Minimal .env reader (KEY=value lines). Never logs values.
export function loadEnv() {
  const out = {};
  if (!existsSync(ENV)) return out;
  for (const line of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
