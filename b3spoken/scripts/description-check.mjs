#!/usr/bin/env node
// Reads a few real job pages per hiring system the way the daily scan does, for jobs in the published pool that
// have no description, and reports how many gave one. Information only: it shows which readers work today.
import { appendFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DESCRIBE_SOURCES, describeJob } from '../src/scan/describe.mjs';
import { request } from '../src/scan/http.mjs';

const PER_SOURCE = Number(process.argv[2]) || 6;
const VERBOSE = !process.argv.includes('--quiet');
const shown = new Set();
// Where the posting text might be on a page: scripts with data, headings, and the text around common section words.
async function pageOutline(url) {
  const u = new URL(url);
  const html = (await request(url, { allow: [u.hostname, `*.${u.hostname.split('.').slice(-2).join('.')}`], parse: 'text', accept: 'text/html', gapMs: 600 })).text;
  const out = [`  page ${html.length} bytes`];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]{0,120})/gi)) if (/type=|id=/.test(m[1]) || /window\.|__/.test(m[2])) out.push(`  script ${m[1].trim().slice(0, 80)} :: ${JSON.stringify(m[2].slice(0, 100))}`);
  for (const m of html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)) out.push(`  heading ${JSON.stringify(m[1].replace(/<[^>]+>/g, '').trim().slice(0, 80))}`);
  for (const w of ['qualifications', 'responsibilities', 'about the job', 'what you', 'description']) {
    const i = html.toLowerCase().indexOf(w);
    if (i > -1) out.push(`  near "${w}" @${i}: ${JSON.stringify(html.slice(Math.max(0, i - 200), i + 300))}`);
  }
  return out.slice(0, 40);
}
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
      const d = got?.description || '';
      if (d.length >= 80) { ok++; notes.push(`ok ${new URL(j.url).hostname} (${d.length} chars): ${JSON.stringify(d.slice(0, 160))}`); }
      else notes.push(`none ${new URL(j.url).hostname}${got?.robots ? ' (robots.txt)' : ''}`);
      // For a page that gave nothing or very little, show what the page holds, so a reader can be fixed.
      if (VERBOSE && d.length < 400 && !got?.robots && DESCRIBE_SOURCES[source] === 'page' && !shown.has(source)) {
        shown.add(source);
        try { notes.push(...(await pageOutline(j.url))); } catch (e) { notes.push(`  (page not read: ${e.message})`); }
      }
    } catch (e) { notes.push(`fail ${new URL(j.url).hostname}: ${String(e.message).slice(0, 80)}`); }
  }
  rows.push({ source, empty: empty.length, tried: sample.length, ok, notes });
  console.log(`${source}: ${ok}/${sample.length} (${empty.length} without a description)\n  ${notes.join('\n  ')}`);
}
const md = ['## Job descriptions read from job pages', '', '| Hiring system | Jobs without one | Tried | Read |', '| --- | --- | --- | --- |',
  ...rows.map(x => `| ${x.source} | ${x.empty} | ${x.tried} | ${x.ok} |`), ''].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
