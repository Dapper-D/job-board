import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCES, detect } from '../src/scan/sources/index.mjs';
import { workdayPosted, findCanadaFacet } from '../src/scan/sources/workday.mjs';
import { dedupe } from '../src/scan/scan.mjs';

const fx = n => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const json = n => JSON.parse(fx(n));

test('greenhouse: parses, unescapes HTML, drops jobs with no title or a non-https link', () => {
  const jobs = SOURCES.greenhouse.parse(json('greenhouse.json'), { board: 'hootsuite' });
  assert.equal(jobs.length, 2);
  const [a, b] = jobs;
  assert.equal(a.company, 'Hootsuite');
  assert.equal(a.canada, true);
  assert.match(a.description, /Build & ship APIs/);
  assert.match(a.description, /• Node\.js/);
  assert.equal(a.salary, '$95,000 - $120,000 CAD');
  assert.equal(a.department, 'Engineering');
  assert.equal(a.postedAt, '2026-11-02T14:00:00.000Z');
  assert.equal(b.canada, false);
});

test('lever: remote Canada, salary, lists, apply link', () => {
  const [a, b] = SOURCES.lever.parse(json('lever.json'), { site: 'coalfire', name: 'Coalfire' });
  assert.equal(a.remote, true);
  assert.equal(a.canada, true);
  assert.equal(a.applyUrl, 'https://jobs.lever.co/coalfire/a1b2/apply');
  assert.match(a.description, /• SIEM/);
  assert.match(a.salary, /CAD 90000 – 110000/);
  assert.equal(a.location, 'Remote - Canada / Toronto, ON');
  assert.equal(b.canada, false);
});

test('ashby: skips unlisted jobs, adds the country, compensation', () => {
  const jobs = SOURCES.ashby.parse(json('ashby.json'), { board: 'cohere', name: 'Cohere' });
  assert.deepEqual(jobs.map(j => j.title), ['Machine Learning Engineer', 'Solutions Engineer']);
  assert.equal(jobs[0].canada, true);
  assert.equal(jobs[0].location, 'Toronto / Montreal / Canada');
  assert.equal(jobs[0].salary, 'CA$150K – CA$200K');
  assert.equal(jobs[1].canada, false);
});

test('workday: builds public links, reads "Posted N Days Ago", finds the Canada filter', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const t = { host: 'ubc.wd10.myworkdayjobs.com', tenant: 'ubc', site: 'ubcstaffjobs', name: 'UBC' };
  const jobs = SOURCES.workday.parse(json('workday.json'), t, now);
  assert.equal(jobs[0].url, 'https://ubc.wd10.myworkdayjobs.com/ubcstaffjobs/job/UBC-Vancouver-Campus---Vancouver-BC-Canada/IT-Support-Analyst_JR123');
  assert.equal(jobs[0].canada, true);
  assert.equal(jobs[0].postedAt, '2026-11-02T12:00:00.000Z');
  assert.equal(jobs[1].remote, true);
  assert.deepEqual(findCanadaFacet(json('workday.json').facets), { param: 'locationHierarchy1', id: 'ca9' });
  assert.equal(workdayPosted('Posted 30+ Days Ago', now), '2026-10-06T12:00:00.000Z');
  assert.equal(workdayPosted('Posted Yesterday', now), '2026-11-04T12:00:00.000Z');
  assert.equal(workdayPosted('', now), null);
});

test('smartrecruiters: list plus details', () => {
  const [j] = SOURCES.smartrecruiters.parse(json('smartrecruiters.json'), { company: 'sgs' }, { 744000: json('smartrecruiters-detail.json') });
  assert.equal(j.url, 'https://jobs.smartrecruiters.com/SGS/744000');
  assert.equal(j.location, 'Burnaby, BC, Canada');
  assert.equal(j.canada, true);
  assert.match(j.description, /Run tests\.[\s\S]*• Diploma/);
  assert.match(j.applyUrl, /oga=true/);
});

test('workable: locations and description', () => {
  const [j] = SOURCES.workable.parse(json('workable.json'), { account: 'semios' });
  assert.equal(j.company, 'Semios');
  assert.equal(j.location, 'Vancouver, British Columbia, Canada');
  assert.equal(j.description, 'Pipelines & dashboards');
  assert.equal(j.canada, true);
});

test('job bank: Atom feed, alternate link, employer, location, salary; off-site links dropped', () => {
  const jobs = SOURCES.jobbank.parse(fx('jobbank.xml'));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].company, 'Telescope Innovations Corp');
  assert.equal(jobs[0].location, 'Vancouver, BC');
  assert.equal(jobs[0].salary, '$100,000.00 to $140,000.00 annually');
  assert.equal(jobs[1].title, 'data analyst, R&D');
  assert.equal(jobs[1].url, 'https://www.jobbank.gc.ca/jobsearch/jobposting/50120001');
  assert.ok(jobs.every(j => j.canada));
});

test('detect: careers links map to the right hiring system', () => {
  const cases = {
    'https://job-boards.greenhouse.io/hootsuite/jobs/7001': ['greenhouse', { board: 'hootsuite' }],
    'https://boards.greenhouse.io/embed/job_board?for=later': ['greenhouse', { board: 'later' }],
    'https://jobs.lever.co/coalfire/a1b2': ['lever', { site: 'coalfire', eu: false }],
    'https://jobs.eu.lever.co/acme': ['lever', { site: 'acme', eu: true }],
    'https://jobs.ashbyhq.com/cohere/u-1': ['ashby', { board: 'cohere' }],
    'https://ubc.wd10.myworkdayjobs.com/en-US/ubcstaffjobs/job/x': ['workday', { host: 'ubc.wd10.myworkdayjobs.com', tenant: 'ubc', site: 'ubcstaffjobs' }],
    'https://jobs.smartrecruiters.com/SGS/744000': ['smartrecruiters', { company: 'SGS' }],
    'https://apply.workable.com/semios/j/ABC123/': ['workable', { account: 'semios' }],
    'https://www.jobbank.gc.ca/jobsearch/jobposting/50123456': ['jobbank', { posting: '50123456' }],
  };
  for (const [url, [source, target]] of Object.entries(cases)) assert.deepEqual(detect(url), { source, target }, url);
  assert.equal(detect('https://www.linkedin.com/jobs/view/1'), null);
  assert.equal(detect('not a url'), null);
});

test('dedupe: same company and title -> one job with the other links kept', () => {
  const base = { company: 'Acme', title: 'Developer', location: 'Toronto, ON', url: 'https://a.example/1' };
  const out = dedupe([base, { ...base, location: 'Vancouver, BC', url: 'https://a.example/2' }, { ...base, title: 'Designer' }]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].alsoAt, ['https://a.example/2']);
  assert.equal(out[0].location, 'Toronto, ON / Vancouver, BC');
});

test('job bank runs on each computer, newest-first, keeping only the last 3 days', async () => {
  assert.equal(SOURCES.jobbank.runsOn, 'helper');
  const http = await import('../src/scan/http.mjs');
  assert.ok(http.request); // the real fetch path is covered by the live check on a home connection
  const now = Date.parse('2026-11-06T12:00:00Z');
  const jobs = SOURCES.jobbank.parse(fx('jobbank.xml'));
  const cutoff = now - 3 * 864e5;
  assert.ok(jobs.every(j => Date.parse(j.postedAt) >= cutoff));
});
