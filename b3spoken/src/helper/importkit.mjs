// Brings a person's setup over from the old Job Hunt Kit, so they don't start again:
//   config.json            -> answers (roles, pay, province, remote, work authorization, never-claim skills, AI)
//   data/resume-lib.json   -> resume library (same lines, same "check" flags, new IDs)
//   data/user/tracker.json -> tracker (status per job), with the kit's jobs.json for each job's title, company and link
// The kit folder is only read, never changed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PROVINCES } from './jobs.mjs';

const read = (f, fb = null) => { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return fb; } };
export const isKit = dir => !!dir && existsSync(join(dir, 'config.json')) && (existsSync(join(dir, 'app', 'kit.json')) || existsSync(join(dir, 'data')));

// Usual places people put the kit.
export function findKits(home = homedir()) {
  const names = ['job board', 'job-board', 'Job Hunt Kit', 'job-hunt-kit', 'jobboard'];
  const roots = [home, join(home, 'Desktop'), join(home, 'Documents'), join(home, 'OneDrive', 'Desktop'), join(home, 'OneDrive', 'Documents')];
  return [...new Set(roots.flatMap(r => names.map(n => join(r, n))))].filter(isKit);
}

const PROV_NAMES = { BC: /british columbia|\bbc\b|vancouver|burnaby|surrey|victoria/i, AB: /alberta|\bab\b|calgary|edmonton/i, ON: /ontario|\bon\b|toronto|ottawa/i, QC: /quebec|québec|\bqc\b|montreal|montréal/i, MB: /manitoba|winnipeg/i, SK: /saskatchewan|regina|saskatoon/i, NS: /nova scotia|halifax/i, NB: /new brunswick/i };

export function profileFromConfig(cfg = {}) {
  const regions = [...(cfg.onsiteRegions || []), cfg.region || '', cfg.city || ''].join(' ');
  const province = Object.entries(PROV_NAMES).find(([, re]) => re.test(regions))?.[0] || '';
  const auth = String(cfg.workAuth || '').toLowerCase();
  const workAuth = /citizen/.test(auth) ? 'citizen' : /permanent|\bpr\b/.test(auth) ? 'permanent-resident' : /pgwp|open work|post-graduation/.test(auth) ? 'open-work-permit'
    : /employer|closed|lmia/.test(auth) ? 'employer-permit' : /study|student/.test(auth) ? 'study-permit' : /need.*sponsor/.test(auth) ? 'needs-sponsorship' : '';
  const unit = n => (n > 0 && n < 300 ? 'hour' : 'year');
  const remoteOk = (cfg.remoteCountries || []).some(c => /canada/i.test(c));
  return {
    targetRoles: (cfg.roles || []).slice(0, 8), extraRoles: (cfg.tracks || []).slice(0, 12),
    payFloor: cfg.floor || null, payFloorUnit: unit(cfg.floor), payGoal: cfg.goal || null, payGoalUnit: unit(cfg.goal),
    province: PROVINCES.includes(province) ? province : '', remote: remoteOk ? 'yes' : 'no', workAuth,
    missingSkills: cfg.neverClaim || [], avoidIndustries: [], cities: [cfg.city].filter(Boolean),
    done: false, // the person reviews the answers once in setup, then finishes
  };
}

export function libraryFromKit(kl) {
  const entries = [];
  let n = 0;
  const entry = (kind, heading, dates, bullets, details = []) => {
    const id = `e${++n}`;
    entries.push({ id, kind, heading, dates: dates || '', details, bullets: (bullets || []).map((b, i) => ({ id: `${id}b${i + 1}`, text: typeof b === 'string' ? b : b.text, flagged: !!b.check })).filter(b => b.text) });
  };
  for (const e of kl.experience || []) entry('experience', e.title, e.dates, e.bullets);
  for (const p of kl.projects || []) entry('projects', p.title, '', p.bullets, [[p.url, p.stack].filter(Boolean).join(' | ')].filter(Boolean));
  for (const ed of kl.education || []) entry('education', [ed.school, ed.detail].filter(Boolean).join(' — '), ed.dates, []);
  for (const x of kl.extras || []) entry(/certif|licen/i.test(x.heading) ? 'certifications' : /volunt/i.test(x.heading) ? 'volunteer' : /award|honou?r/i.test(x.heading) ? 'awards' : 'other', x.heading, '', x.lines);
  const contactBits = [kl.contactLine, kl.email, ...(kl.links || []).map(l => l.url.replace(/^https?:\/\/(www\.)?/, ''))].filter(Boolean);
  return {
    contact: { name: kl.name || '', lines: [contactBits.join(' | ')].filter(Boolean) },
    summary: kl.summary || '', skills: (kl.skills || []).map(g => ({ label: g.group || '', items: g.items || [] })).filter(g => g.items.length),
    entries, other: [], source: 'kit',
  };
}

// Plain text of the library, used for matching (the kit doesn't keep the original resume text).
export function libraryText(lib) {
  return [lib.contact.name, ...lib.contact.lines, lib.summary, ...lib.skills.map(g => `${g.label}: ${g.items.join(', ')}`),
    ...lib.entries.flatMap(e => [e.heading, e.dates, ...e.details, ...e.bullets.map(b => b.text)])].filter(Boolean).join('\n');
}

const STATUS = { applied: 'applied', viewed: 'applied', interview: 'interview', interviewing: 'interview', offer: 'offer', rejected: 'rejected', 'not interested': 'not-interested', saved: 'saved' };

export function trackerFromKit(tracker = {}, jobs = {}) {
  const items = [], entries = {};
  for (const [id, st] of Object.entries(tracker)) {
    const status = STATUS[String(typeof st === 'string' ? st : st?.status || '').toLowerCase()];
    const j = jobs[id];
    if (!status || !j) continue;
    const jid = `kit:${id}`;
    items.push({ id: jid, source: 'kit', company: j.company || '', title: j.title || '', url: j.verifiedUrl || j.applyUrl || '', applyUrl: j.applyUrl || j.verifiedUrl || '', location: j.location || '', canada: true, postedAt: j.firstSeen ? new Date(j.firstSeen).toISOString() : null, description: '', employerVerified: true, pasted: true, imported: true });
    entries[jid] = { status, notes: 'Imported from the Job Hunt Kit', followUp: '', updatedAt: new Date().toISOString(), title: j.title, company: j.company };
  }
  return { items, entries };
}

export function readKit(dir) {
  if (!isKit(dir)) throw new Error('That folder doesn’t look like a Job Hunt Kit (no config.json).');
  const cfg = read(join(dir, 'config.json'), {});
  const kl = read(join(dir, 'data', 'resume-lib.json'), null);
  return {
    cfg, profile: profileFromConfig(cfg),
    library: kl ? libraryFromKit(kl) : null,
    tracker: trackerFromKit(read(join(dir, 'data', 'user', 'tracker.json'), {}), read(join(dir, 'data', 'jobs.json'), {})),
    ai: ['codex', 'claude'].includes(cfg.ai?.provider) ? cfg.ai.provider : null,
  };
}
