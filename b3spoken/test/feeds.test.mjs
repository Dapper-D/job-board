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
