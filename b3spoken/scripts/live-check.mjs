#!/usr/bin/env node
// Calls every source for real, using the starter employer list, and reports what came back.
// Fails if any source returns nothing at all, so a changed or blocked feed is noticed right away.
// Reads catalog/employers.json (kept out of data/, which git ignores for private user files).
// Writes a Markdown summary to $GITHUB_STEP_SUMMARY when run in GitHub Actions.
import { readFileSync, appendFileSync } from 'node:fs';
import { scanEmployers, dedupe } from '../src/scan/scan.mjs';
import { SOURCES } from '../src/scan/sources/index.mjs';

const { employers } = JSON.parse(readFileSync(new URL('../catalog/employers.json', import.meta.url), 'utf8'));
const { jobs, report } = await scanEmployers(employers, { log: console.log });
const pool = dedupe(jobs);
const unique = pool.reduce((m, j) => (m[j.source] = (m[j.source] || 0) + 1, m), {});
const bySource = Object.keys(SOURCES).filter(id => SOURCES[id].runsOn !== 'helper').map(id => {
  const rows = report.filter(r => r.source === id);
  return { id, tried: rows.length, worked: rows.filter(r => r.ok).length, found: rows.reduce((n, r) => n + (r.found || 0), 0), canada: rows.reduce((n, r) => n + (r.canada || 0), 0), unique: unique[id] || 0 };
});
const sample = pool.slice(0, 8).map(j => `| ${j.source} | ${j.company} | ${j.title.replace(/\|/g, '/')} | ${j.location.replace(/\|/g, '/').slice(0, 60)} | ${j.postedAt ? j.postedAt.slice(0, 10) : ''} |`);
const md = [
  `## Live source check: ${pool.length} unique jobs in Canada`, '', `Each job is counted once: ${jobs.length - pool.length} duplicate listings were merged.`, '',
  '| Source | Employers tried | Worked | Listings found | Listings in Canada | Unique jobs kept |', '| --- | --- | --- | --- | --- | --- |',
  ...bySource.map(s => `| ${s.id} | ${s.tried} | ${s.worked} | ${s.found} | ${s.canada} | ${s.unique} |`), '',
  '### Failures', '', ...(report.filter(r => !r.ok).map(r => `- ${r.source} / ${r.name}: ${r.error}`)), '',
  '### Sample jobs', '', '| Source | Company | Title | Location | Posted |', '| --- | --- | --- | --- | --- |', ...sample, '',
].join('\n');
console.log('\n' + md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
// Employer hiring systems must work. A job site being slow for a day is a warning, not a failure.
const dead = bySource.filter(s => s.tried && !s.worked);
const hard = dead.filter(s => !SOURCES[s.id].feed);
if (dead.length) console.error('No working employer for: ' + dead.map(s => s.id).join(', '));
if (hard.length) process.exit(1);
