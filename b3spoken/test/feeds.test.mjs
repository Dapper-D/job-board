import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, detect } from '../src/scan/sources/index.mjs';
import { parseRobots, allowedBy } from '../src/scan/robots.mjs';
import { findBoardLinks, slugGuesses, norm } from '../src/scan/discover.mjs';

test('remotive: names the source, keeps Canada-eligible jobs', () => {
  const jobs = SOURCES.remotive.parse({ 'job-count': 2, jobs: [
    { id: 1, url: 'https://remotive.com/remote-jobs/software-dev/dev-1', title: 'Dev', company_name: 'Acme', category: 'Software Development', job_type: 'full_time', publication_date: '2026-11-04T10:00:00', candidate_required_location: 'USA, Canada', salary: '$100k', description: '<p>Code</p>' },
    { id: 2, url: 'https://remotive.com/remote-jobs/x/2', title: 'Ops', company_name: 'B', candidate_required_location: 'Europe' }] });
  assert.equal(jobs[0].canada, true);
  assert.equal(jobs[1].canada, false);
  assert.deepEqual(jobs[0].via, { name: 'Remotive', url: 'https://remotive.com' });
  assert.equal(jobs[0].employerVerified, false);
});

test('remote ok: skips the legal notice item; no location = open to all', () => {
  const jobs = SOURCES.remoteok.parse([{ 'last-updated': 1, legal: 'Please link back' }, { id: '9', slug: 'dev-9', position: 'Dev', company: 'C', location: '', date: '2026-11-04T00:00:00+00:00', url: 'https://remoteok.com/remote-jobs/dev-9', salary_min: 90000, salary_max: 120000 }]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].canada, true);
  assert.match(jobs[0].salary, /USD 90000 – 120000/);
  assert.equal(jobs[0].via.name, 'Remote OK');
});

test('jobicy: geo decides Canada eligibility', () => {
  const jobs = SOURCES.jobicy.parse({ jobs: [{ id: 5, url: 'https://jobicy.com/jobs/5-dev', jobTitle: 'Dev &amp; Ops', companyName: 'D', jobGeo: 'Canada', jobIndustry: ['Engineering'], jobType: ['full-time'], pubDate: '2026-11-04 10:00:00', jobDescription: '<p>x</p>' }, { id: 6, url: 'https://jobicy.com/jobs/6', jobTitle: 'X', companyName: 'E', jobGeo: 'USA' }] });
  assert.equal(jobs[0].title, 'Dev & Ops');
  assert.equal(jobs[0].canada, true);
  assert.equal(jobs[1].canada, false);
});

test('bamboohr, breezy, pinpoint, teamtailor parse their public lists', () => {
  const b = SOURCES.bamboohr.parse({ result: [{ id: 12, jobOpeningName: 'Analyst', location: { city: 'Vancouver', state: 'British Columbia' }, isRemote: false, departmentLabel: 'Ops' }] }, { host: 'acme.bamboohr.com' });
  assert.equal(b[0].url, 'https://acme.bamboohr.com/careers/12');
  assert.equal(b[0].canada, true);
  const z = SOURCES.breezy.parse([{ id: 'p1', name: 'Designer', url: 'https://acme.breezy.hr/p/p1', published_date: '2026-11-01T00:00:00Z', location: { city: 'Toronto', state: { name: 'Ontario' }, country: { name: 'Canada' }, is_remote: true } }], { host: 'acme.breezy.hr' });
  assert.equal(z[0].location, 'Toronto, Ontario, Canada, Remote');
  const p = SOURCES.pinpoint.parse({ data: [{ id: 1, title: 'Nurse', url: 'https://acme.pinpointhq.com/postings/1', location: { city: 'Calgary', province: 'Alberta' } }, { id: 2, title: 'Demo', url: 'https://acme.pinpointhq.com/postings/2', description: 'youtube.com/embed/https://www.youtube.com/embed/pFxm6fszrpw' }] }, { host: 'acme.pinpointhq.com' });
  assert.deepEqual(p.map(j => j.location), ['Calgary, Alberta']);
  const t = SOURCES.teamtailor.parse('<rss><channel><item><title><![CDATA[Engineer]]></title><link>https://acme.teamtailor.com/jobs/1-engineer</link><pubDate>Tue, 03 Nov 2026 10:00:00 +0000</pubDate><tt:city>Montréal</tt:city><tt:country>Canada</tt:country><remoteStatus>none</remoteStatus></item></channel></rss>', { host: 'acme.teamtailor.com' });
  assert.equal(t[0].location, 'Montréal, Canada');
  assert.equal(t[0].postedAt, '2026-11-03T10:00:00.000Z');
  assert.deepEqual(detect('https://acme.bamboohr.com/careers'), { source: 'bamboohr', target: { host: 'acme.bamboohr.com' } });
  assert.deepEqual(detect('https://acme.teamtailor.com/jobs'), { source: 'teamtailor', target: { host: 'acme.teamtailor.com' } });
});

test('robots.txt: longest rule wins, our own group beats *', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /careers\nAllow: /careers/public\n\nUser-agent: OtherBot\nDisallow: /');
  assert.equal(allowedBy(rules, '/careers/apply'), false);
  assert.equal(allowedBy(rules, '/careers/public/list'), true);
  assert.equal(allowedBy(rules, '/about'), true);
  assert.equal(allowedBy(parseRobots('User-agent: B3spokenBot\nDisallow: /\nUser-agent: *\nAllow: /'), '/jobs'), false);
  assert.equal(allowedBy(parseRobots('User-agent: *\nDisallow:'), '/jobs'), true);
  assert.equal(allowedBy(parseRobots('User-agent: *\nDisallow: /*.pdf$'), '/a/b.pdf'), false);
});

test('discovery finds hiring-system links in a careers page and guesses board names', () => {
  const html = `<a href="https://boards.greenhouse.io/acme">Open roles</a><iframe src="https://acme.wd3.myworkdayjobs.com/en-US/External"></iframe><script>var u="https://jobs.lever.co/acme"</script><a href="https://remotive.com/x">x</a>`;
  const hits = findBoardLinks(html, 'https://www.acme.com/careers');
  assert.deepEqual(hits.map(h => h.source), ['greenhouse', 'workday', 'lever']);
  assert.deepEqual(slugGuesses('Dye & Durham Inc.'), ['dyeanddurham', 'dye-and-durham', 'dyedurham']);
  assert.equal(norm('Coveo Solutions Inc.'), 'coveosolutions');
});

test('company names: "Air Canada" is not "Air", but "Hootsuite Inc." is "Hootsuite"', async () => {
  const { sameCompany } = await import('../src/scan/discover.mjs');
  assert.equal(sameCompany('Air', 'Air Canada'), false);
  assert.equal(sameCompany('Hootsuite', 'Hootsuite Inc.'), true);
  assert.equal(sameCompany('Coveo', 'Coveo Solutions'), false);
  assert.equal(sameCompany('Wattpad Corp', 'wattpad'), true);
});

test('himalayas: apply link from the API, expired jobs dropped, Canada or worldwide', () => {
  const now = Date.parse('2026-11-05T00:00:00Z');
  const jobs = SOURCES.himalayas.parse({ jobs: [
    { title: 'Dev', companyName: 'A', guid: 'https://himalayas.app/companies/a/jobs/dev', applicationLink: 'https://himalayas.app/companies/a/jobs/dev/apply', locationRestrictions: ['Canada', 'United States'], pubDate: 1762300000, expiryDate: 1800000000 },
    { title: 'Old', companyName: 'B', guid: 'https://himalayas.app/x', applicationLink: 'https://himalayas.app/x', expiryDate: 1700000000 },
    { title: 'EU', companyName: 'C', guid: 'https://himalayas.app/y', applicationLink: 'https://himalayas.app/y', locationRestrictions: ['Germany'] }] }, now);
  assert.deepEqual(jobs.map(j => [j.title, j.canada]), [['Dev', true], ['EU', false]]);
  assert.equal(jobs[0].applyUrl, 'https://himalayas.app/companies/a/jobs/dev/apply');
  assert.equal(jobs[0].via.name, 'Himalayas');
});

test('cross-check: titles and companies match loosely but not wrongly', async () => {
  const { sameTitle, companyKey, verifyFeedJobs } = await import('../src/scan/verify.mjs');
  assert.equal(sameTitle('Senior Backend Engineer (Remote, Canada)', 'Senior Backend Engineer'), true);
  assert.equal(sameTitle('Senior Backend Engineer', 'Senior Backend Engineer, Payments'), true);
  assert.equal(sameTitle('Engineer', 'Engineering Manager'), false);
  assert.equal(companyKey('Acme, Inc.'), companyKey('ACME'));
  const own = [{ company: 'Acme', title: 'Data Analyst', url: 'https://jobs.lever.co/acme/1', applyUrl: 'https://jobs.lever.co/acme/1/apply', employerVerified: true }];
  const site = [
    { company: 'Acme Inc', title: 'Data Analyst - Remote', url: 'https://remoteok.com/x', applyUrl: 'https://remoteok.com/x', via: { name: 'Remote OK' }, employerVerified: false, description: '' },
    { company: 'Acme Inc', title: 'Designer', url: 'https://remoteok.com/y', via: { name: 'Remote OK' }, employerVerified: false, description: '' }];
  const { verified, dropped } = await verifyFeedJobs(site, own, { maxLookups: 0 });
  assert.equal(verified.length, 1);
  assert.equal(verified[0].employerUrl, 'https://jobs.lever.co/acme/1');
  assert.equal(verified[0].applyUrl, 'https://remoteok.com/x'); // the site's own link, as its terms ask
  assert.equal(verified[0].via.name, 'Remote OK');
  assert.deepEqual(dropped.map(d => d.why), ["title not on the employer's board"]);
});

test('oracle cloud and phenom: targets and parsing', async () => {
  const { phenomFromPage } = await import('../src/scan/sources/phenom.mjs');
  assert.deepEqual(detect('https://ecqd.fa.ca2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs'), { source: 'oraclecloud', target: { host: 'ecqd.fa.ca2.oraclecloud.com', lang: 'en', site: 'CX_1' } });
  assert.equal(detect('https://evil.oraclecloud.com.example/x'), null);
  const o = SOURCES.oraclecloud.parse({ items: [{ requisitionList: [{ Id: '123', Title: 'Analyst', PrimaryLocation: 'Toronto, ON, Canada', WorkplaceTypeCode: 'ORA_HYBRID', PostedDate: '2026-11-03' }] }] }, { host: 'x.fa.ca2.oraclecloud.com', lang: 'en', site: 'CX_1', name: 'Bank' });
  assert.equal(o[0].url, 'https://x.fa.ca2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123');
  assert.equal(o[0].canada, true);
  const ph = phenomFromPage('<script src="https://cdn.phenompeople.com/x.js"></script><a href="/ca/en/job/R-1/Analyst">', 'https://jobs.rbc.com/ca/en/');
  assert.deepEqual(ph, { host: 'jobs.rbc.com', prefix: 'ca/en' });
  const p = SOURCES.phenom.parse({ refineSearch: { totalHits: 1, data: { jobs: [{ jobId: 'R-1', title: 'Data &amp; AI Analyst', city: 'Toronto', state: 'Ontario', country: 'Canada', postedDate: '2026-11-02T00:00:00Z' }] } } }, { host: 'jobs.rbc.com', prefix: 'ca/en' });
  assert.equal(p[0].title, 'Data & AI Analyst');
  assert.equal(p[0].url, 'https://jobs.rbc.com/ca/en/job/R-1/Data-AI-Analyst');
  assert.equal(p[0].canada, true);
});

test('rippling, eightfold and jibe: targets and parsing', async () => {
  const { eightfoldFromPage } = await import('../src/scan/sources/eightfold.mjs');
  const { jibeFromPage } = await import('../src/scan/sources/jibe.mjs');
  assert.deepEqual(detect('https://ats.rippling.com/freshbooks/jobs'), { source: 'rippling', target: { slug: 'freshbooks' } });
  const r = SOURCES.rippling.parse({ items: [{ id: 'a', name: 'Dev', url: 'https://ats.rippling.com/freshbooks/jobs/a', locations: [{ name: 'Toronto, ON' }], department: { name: 'Eng' } }], totalPages: 1 }, { slug: 'freshbooks' });
  assert.equal(r[0].canada, true);
  assert.deepEqual(eightfoldFromPage('<script src="https://static.vscdn.net/x.js">', 'https://jobs.autodesk.com/careers'), { host: 'jobs.autodesk.com' });
  const e = SOURCES.eightfold.parse({ positions: [{ id: 7, name: 'Engineer', location: 'Vancouver, BC, Canada', t_create: 1762300000, canonicalPositionUrl: 'https://jobs.autodesk.com/careers/job/7' }], count: 1 }, { host: 'jobs.autodesk.com' });
  assert.equal(e[0].url, 'https://jobs.autodesk.com/careers/job/7');
  assert.equal(e[0].canada, true);
  assert.deepEqual(jibeFromPage('<link href="https://app.jibecdn.com/x.css">', 'https://careers.rivian.com/'), { host: 'careers.rivian.com' });
  const j = SOURCES.jibe.parse({ totalCount: 1, jobs: [{ data: { slug: '123', req_id: '123', title: 'Technician', city: 'Vancouver', state: 'BC', country: 'Canada', posted_date: '2026-11-01T00:00:00Z' } }] }, { host: 'careers.rivian.com', name: 'Rivian' });
  assert.equal(j[0].url, 'https://careers.rivian.com/jobs/123');
  assert.equal(j[0].canada, true);
});

test('phenom: careers site on another host of the same employer', async () => {
  const { phenomFromPage } = await import('../src/scan/sources/phenom.mjs');
  assert.deepEqual(phenomFromPage('<script src="https://cdn.phenompeople.com/a.js"></script><a href="https://careers.opentext.com/us/en/search-results">Jobs</a>', 'https://www.opentext.com/careers'), { host: 'careers.opentext.com', prefix: 'us/en' });
  assert.equal(phenomFromPage('<script src="https://cdn.phenompeople.com/a.js"></script><a href="https://evil.example/us/en/job/1">', 'https://www.opentext.com/careers'), null);
});
