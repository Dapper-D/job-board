// Jobs that used to slip through the daily scan: multi-location postings and job-site jobs never checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCanada } from '../src/scan/job.mjs';
import { SOURCES } from '../src/scan/sources/index.mjs';
import { findCanadaFacet } from '../src/scan/sources/workday.mjs';
import { verifyFeedJobs } from '../src/scan/verify.mjs';

test('several locations: Canadian if any one of them is', () => {
  assert.equal(isCanada('Vancouver / San Francisco, United States'), true);
  assert.equal(isCanada('Remote - US; Remote - Canada', true), true);
  assert.equal(isCanada('San Francisco, CA / New York, NY'), false);
  assert.equal(isCanada('London, England / Vancouver, WA'), false);
});

test('workday: a list Workday already filtered to Canada keeps "3 Locations" jobs', () => {
  const t = { host: 'acme.wd5.myworkdayjobs.com', tenant: 'acme', site: 'Careers', name: 'Acme' };
  const data = { jobPostings: [{ title: 'Detection Engineer (Remote, CAN)', externalPath: '/job/Remote/Detection-Engineer_R1', locationsText: '3 Locations', postedOn: 'Posted Today' }] };
  assert.equal(SOURCES.workday.parse(data, t)[0].canada, false); // unfiltered list: can't tell from "3 Locations"
  assert.equal(SOURCES.workday.parse(data, t, Date.now(), { canada: true })[0].canada, true);
  assert.deepEqual(SOURCES.workday.detailLocations({ jobPostingInfo: { location: 'Austin, TX', additionalLocations: ['Remote, Canada'], country: { descriptor: 'United States of America' } } }), ['Austin, TX', 'Remote, Canada', 'United States of America']);
  // The Canada filter is only ever the whole country, never one city in it.
  assert.ok(findCanadaFacet([{ facetParameter: 'loc', values: [{ descriptor: 'Canada - Toronto', id: 'x' }, { descriptor: 'Canada', id: 'ca' }] }]).id === 'ca');
  assert.equal(findCanadaFacet([{ facetParameter: 'loc', values: [{ descriptor: 'Canada - Toronto', id: 'x' }] }]), null);
});

test('greenhouse: every office a job is listed under counts', () => {
  const jobs = SOURCES.greenhouse.parse({ jobs: [{ id: 1, title: 'Developer', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1', location: { name: 'Remote' }, offices: [{ name: 'Vancouver', location: 'Vancouver, British Columbia, Canada' }, { name: 'New York' }] }] }, { board: 'acme', name: 'Acme' });
  assert.equal(jobs[0].canada, true);
  assert.match(jobs[0].location, /Vancouver, British Columbia/);
});

test('job-site check: boards found before are reused, recent misses skipped, the daily limit reported', async () => {
  const site = (company, title) => ({ company, title, url: `https://remoteok.com/${company}`, via: { name: 'Remote OK' }, employerVerified: false, description: '' });
  const realLever = SOURCES.lever.fetchJobs;
  SOURCES.lever.fetchJobs = async t => (t.site === 'beta' ? [{ company: 'Beta', title: 'Support Analyst', url: 'https://jobs.lever.co/beta/1' }] : []);
  try {
    const known = { beta: { name: 'Beta', source: 'lever', target: { site: 'beta' } }, gamma: { name: 'Gamma', none: '2026-11-08' } };
    const r = await verifyFeedJobs([site('Beta', 'Support Analyst'), site('Gamma', 'Developer'), site('Delta', 'Developer')], [], { known, maxLookups: 0, today: '2026-11-09' });
    assert.deepEqual(r.verified.map(v => v.employerUrl), ['https://jobs.lever.co/beta/1']); // read straight from the remembered board
    assert.deepEqual(r.dropped.map(d => [d.company, d.why]), [['Gamma', 'employer board not found'], ['Delta', 'not checked today (daily lookup limit)']]);
    assert.equal(r.known.beta.source, 'lever'); // still remembered for tomorrow
  } finally { SOURCES.lever.fetchJobs = realLever; }
});

test('daily discovery: listed employers get looked up, remembered, and scanned without editing the catalog', async () => {
  const { discoverDaily } = await import('../src/scan/daily.mjs');
  const seeds = [{ name: 'Hootsuite', domain: 'hootsuite.com' }, { name: 'Acme Security', domain: 'acme.example' }, { name: 'Nobody Inc', domain: 'nobody.example' }, { name: 'Old Miss', domain: 'old.example' }];
  const catalog = [{ name: 'Hootsuite', source: 'greenhouse', target: { board: 'hootsuite' } }];
  const asked = [];
  const find = async list => { asked.push(...list.map(s => s.name)); return { found: list.filter(s => s.name === 'Acme Security').map(s => ({ name: s.name, source: 'lever', target: { site: 'acme' }, how: 'link on careers page' })), missing: list.filter(s => s.name !== 'Acme Security') }; };
  const previous = { oldmiss: { name: 'Old Miss', none: '2026-11-05' } }; // tried 4 days ago: not again yet
  const r = await discoverDaily(seeds, catalog, previous, { find, today: '2026-11-09' });
  assert.deepEqual(asked, ['Acme Security', 'Nobody Inc']); // not the catalog one, not a recent miss
  assert.deepEqual(r.employers, [{ name: 'Acme Security', source: 'lever', target: { site: 'acme' }, found: 'link on careers page' }]);
  assert.equal(r.discovered.nobody.none, '2026-11-09');
  // Next day: the found employer is scanned again without another lookup.
  asked.length = 0;
  const r2 = await discoverDaily(seeds, catalog, r.discovered, { find, today: '2026-11-10' });
  assert.deepEqual(asked, []);
  assert.equal(r2.employers.length, 1);
  // Two weeks later the misses are tried again.
  await discoverDaily(seeds, catalog, r.discovered, { find, today: '2026-11-24' });
  assert.deepEqual(asked.sort(), ['Nobody Inc', 'Old Miss']);
});

test('daily discovery: a found board that fails when read goes back to be looked up again', async () => {
  const { forgetFailed } = await import('../src/scan/daily.mjs');
  const discovered = { metro: { name: 'Metro', source: 'successfactors', target: { host: 'www.metro.ca' } }, ea: { name: 'Electronic Arts', source: 'avature', target: {} } };
  forgetFailed(discovered, [{ name: 'Metro', source: 'successfactors', ok: false, error: 'HTTP 404' }, { name: 'Electronic Arts', source: 'avature', ok: true }], '2026-11-09');
  assert.equal(discovered.metro.none, '2026-11-09');
  assert.equal(discovered.metro.source, undefined);
  assert.equal(discovered.ea.source, 'avature');
});

test('a US place named like a province is not Canada', () => {
  assert.equal(isCanada('Ontario, CA, United States'), false);
  assert.equal(isCanada('Toronto, Ontario, Canada'), true);
  assert.equal(isCanada('Remote - USA / Remote - Canada', true), true);
});
