#!/usr/bin/env node
// Reads a few real job pages per hiring system the way the daily scan does, for jobs in the published pool that
// have no description, and reports how many gave one. Information only: it shows which readers work today.
import { appendFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DESCRIBE_SOURCES, describeJob } from '../src/scan/describe.mjs';

const PER_SOURCE = Number(process.argv[2]) || 6;
const r = await fetch(`https://github.com/${process.env.GITHUB_REPOSITORY || 'Dapper-D/job-board'}/releases/download/job-pool/pool.json.gz`);
const jobs = JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer()))).jobs;
const rows = [];
for (const source of Object.keys(DESCRIBE_SOURCES)) {
  const empty = jobs.filter(j => j.source === source && !j.description);
  // Spread the sample over different employers.
  const byHost = new Map(); for (const j of empty) { const h = new URL(j.url).hostname; if (!byHost.has(h)) byHost.set(h, j); }
  const sample = [...byHost.values(), ...empty].filter((j, i, a) => a.indexOf(j) === i).slice(0, PER_SOURCE);
  let ok = 0; const notes = [];
  for (const j of sample) {
    try {
      const got = await describeJob(j);
      if (got?.description?.length >= 80) { ok++; notes.push(`ok ${new URL(j.url).hostname} (${got.description.length} chars)`); }
      else notes.push(`none ${new URL(j.url).hostname}${got?.robots ? ' (robots.txt)' : ''}`);
    } catch (e) { notes.push(`fail ${new URL(j.url).hostname}: ${String(e.message).slice(0, 80)}`); }
  }
  rows.push({ source, empty: empty.length, tried: sample.length, ok, notes });
  console.log(`${source}: ${ok}/${sample.length} (${empty.length} without a description)\n  ${notes.join('\n  ')}`);
}
const md = ['## Job descriptions read from job pages', '', '| Hiring system | Jobs without one | Tried | Read |', '| --- | --- | --- | --- |',
  ...rows.map(x => `| ${x.source} | ${x.empty} | ${x.tried} | ${x.ok} |`), ''].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
