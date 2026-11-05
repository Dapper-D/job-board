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
const bySource = Object.keys(SOURCES).map(id => {
  const rows = report.filter(r => r.source === id);
  return { id, tried: rows.length, worked: rows.filter(r => r.ok).length, found: rows.reduce((n, r) => n + (r.found || 0), 0), canada: rows.reduce((n, r) => n + (r.canada || 0), 0) };
});
const pool = dedupe(jobs);
const sample = pool.slice(0, 8).map(j => `| ${j.source} | ${j.company} | ${j.title.replace(/\|/g, '/')} | ${j.location.replace(/\|/g, '/').slice(0, 60)} | ${j.postedAt ? j.postedAt.slice(0, 10) : ''} |`);
const md = [
  `## Live source check: ${pool.length} jobs in Canada`, '',
  '| Source | Employers tried | Worked | Jobs found | In Canada |', '| --- | --- | --- | --- | --- |',
  ...bySource.map(s => `| ${s.id} | ${s.tried} | ${s.worked} | ${s.found} | ${s.canada} |`), '',
  '### Failures', '', ...(report.filter(r => !r.ok).map(r => `- ${r.source} / ${r.name}: ${r.error}`)), '',
  '### Sample jobs', '', '| Source | Company | Title | Location | Posted |', '| --- | --- | --- | --- | --- |', ...sample, '',
].join('\n');
console.log('\n' + md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
const dead = bySource.filter(s => s.tried && !s.worked);
if (dead.length) { console.error('No working employer for: ' + dead.map(s => s.id).join(', ')); process.exit(1); }
