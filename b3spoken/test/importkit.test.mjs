import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findKits, readKit, profileFromConfig } from '../src/helper/importkit.mjs';
import { createApp } from '../src/helper/main.mjs';

function makeKit(root) {
  const kit = join(root, 'Desktop', 'job board');
  mkdirSync(join(kit, 'app'), { recursive: true }); mkdirSync(join(kit, 'data', 'user'), { recursive: true });
  writeFileSync(join(kit, 'app', 'kit.json'), '{}');
  writeFileSync(join(kit, 'config.json'), JSON.stringify({ name: 'Jordan Lee', city: 'Burnaby', region: 'BC', roles: ['Software Developer'], tracks: ['Security Analyst'], floor: 72800, goal: 100000, onsiteRegions: ['Vancouver', 'Burnaby'], remoteCountries: ['Canada'], workAuth: 'PGWP from Jan 2027, no sponsorship needed', neverClaim: ['Kubernetes'], ai: { provider: 'claude' } }));
  writeFileSync(join(kit, 'data', 'resume-lib.json'), JSON.stringify({ name: 'Jordan Lee', email: 'jordan@example.com', contactLine: 'Burnaby, BC | 604-555-0100', links: [{ label: 'GitHub', url: 'https://github.com/jordan' }], summary: 'Developer.', skills: [{ group: 'Languages', items: ['Python', 'SQL'] }],
    education: [{ school: 'BCIT', detail: 'Diploma in Computer Systems', dates: '2021' }],
    experience: [{ id: 'e1', title: 'Software Developer, Northwind', dates: 'Jan 2023 – Present', bullets: [{ id: 'e1b1', text: 'Built a Python service.' }, { id: 'e1b2', text: 'Reworded line.', check: true }] }],
    projects: [{ id: 'p1', title: 'Shift Planner', url: 'https://github.com/jordan/shift', stack: 'React', bullets: [{ id: 'p1b1', text: 'Built a scheduling app.' }] }], extras: [{ heading: 'Certifications', lines: ['CompTIA Security+'] }] }));
  writeFileSync(join(kit, 'data', 'jobs.json'), JSON.stringify({ j1: { company: 'Acme', title: 'Developer', applyUrl: 'https://boards.greenhouse.io/acme/jobs/1', firstSeen: '2026-10-20' }, j2: { company: 'Beta', title: 'Analyst', applyUrl: 'https://jobs.lever.co/beta/2' } }));
  writeFileSync(join(kit, 'data', 'user', 'tracker.json'), JSON.stringify({ j1: 'Applied', j2: 'Not started' }));
  return kit;
}

test('finds a kit in the usual places and reads it', () => {
  const home = mkdtempSync(join(tmpdir(), 'b3-home-'));
  const kit = makeKit(home);
  assert.deepEqual(findKits(home), [kit]);
  const k = readKit(kit);
  assert.deepEqual([k.profile.province, k.profile.workAuth, k.profile.remote, k.profile.payFloorUnit, k.ai], ['BC', 'open-work-permit', 'yes', 'year', 'claude']);
  assert.deepEqual(k.profile.missingSkills, ['Kubernetes']);
  assert.deepEqual(k.library.entries.map(e => e.kind), ['experience', 'projects', 'education', 'certifications']);
  assert.deepEqual(k.library.entries[0].bullets.map(b => b.flagged), [false, true]); // the kit's "check" flags carry over
  assert.equal(k.tracker.items.length, 1); // "Not started" isn't tracked
  assert.equal(profileFromConfig({ floor: 35 }).payFloorUnit, 'hour');
  assert.throws(() => readKit(home), /doesn.t look like/);
});

test('import into the app: library, answers, AI choice and tracked jobs', () => {
  const home = mkdtempSync(join(tmpdir(), 'b3-home-'));
  const kit = makeKit(home);
  const dir = mkdtempSync(join(tmpdir(), 'b3-data-'));
  const app = createApp(dir, { offline: true, log: () => {}, deps: { detect: async () => ({}) } });
  const r = app.importKit(kit);
  assert.equal(r.imported.length, 3);
  assert.equal(app.library().entries.length, 4);
  assert.deepEqual(app.profile().targetRoles, ['Software Developer']);
  assert.equal(app.settings().ai, 'claude');
  assert.equal(app.tracker()['kit:j1'].status, 'applied');
  assert.ok(app.jobs().some(j => j.id === 'kit:j1' && j.track?.status === 'applied'));
  assert.match(readFileSync(join(dir, 'resume.txt'), 'utf8'), /Built a Python service\./);
});

test('moved here by the kit\'s update: imports the kit once on first start, never over an existing setup', () => {
  const home = mkdtempSync(join(tmpdir(), 'b3-home-'));
  const kit = makeKit(join(home, 'Somewhere else')); // not one of the usual places
  const dir = mkdtempSync(join(tmpdir(), 'b3-data-'));
  writeFileSync(join(dir, 'kit-import.json'), JSON.stringify({ dir: kit }));
  assert.equal(findKits(home, dir)[0], kit); // the kit the update pointed to comes first
  const app = createApp(dir, { offline: true, log: () => {}, deps: { detect: async () => ({}) } });
  const r = app.autoImportKit();
  assert.equal(r.imported.length, 3);
  assert.equal(app.library().entries.length, 4);
  assert.ok(!existsSync(join(dir, 'kit-import.json')) && existsSync(join(dir, 'kit-import.done.json'))); // only once
  assert.equal(app.autoImportKit(), null);

  // Someone who already set up B3spoken keeps their own answers and library.
  const dir2 = mkdtempSync(join(tmpdir(), 'b3-data-'));
  writeFileSync(join(dir2, 'library.json'), JSON.stringify({ contact: { name: 'Mine' }, entries: [], skills: [] }));
  writeFileSync(join(dir2, 'kit-import.json'), JSON.stringify({ dir: kit }));
  const app2 = createApp(dir2, { offline: true, log: () => {}, deps: { detect: async () => ({}) } });
  assert.equal(app2.autoImportKit(), null);
  assert.equal(JSON.parse(readFileSync(join(dir2, 'library.json'), 'utf8')).contact.name, 'Mine');
  assert.ok(existsSync(join(dir2, 'kit-import.done.json')));
});
