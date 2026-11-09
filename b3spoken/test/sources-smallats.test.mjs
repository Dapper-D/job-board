import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import recruitee from '../src/scan/sources/recruitee.mjs';
import personio from '../src/scan/sources/personio.mjs';
import ultipro, { ultiproDetail, ultiproPlaces } from '../src/scan/sources/ultipro.mjs';

const fx = n => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

for (const s of [recruitee, personio, ultipro]) {
  test(`${s.id}: has the source shape`, () => {
    assert.equal(typeof s.label, 'string');
    assert.ok(Array.isArray(s.hosts) && s.hosts.length);
    for (const f of ['fromUrl', 'parse', 'fetchJobs']) assert.equal(typeof s[f], 'function');
    assert.equal(s.fromUrl('not a url'), null);
  });
}

test('recruitee: fromUrl knows company boards, not look-alikes or Recruitee itself', () => {
  assert.deepEqual(recruitee.fromUrl('https://acmelabs.recruitee.com/o/security-analyst'), { host: 'acmelabs.recruitee.com' });
  assert.deepEqual(recruitee.fromUrl('https://AcmeLabs.recruitee.com/'), { host: 'acmelabs.recruitee.com' });
  for (const u of ['https://recruitee.com/', 'https://www.recruitee.com/careers', 'https://app.recruitee.com/', 'https://acme.recruitee.com.evil.io/',
    'https://acme-recruitee.com/', 'https://acme.recruitee.co/', 'https://a.b.recruitee.com/', 'https://example.com/acme.recruitee.com']) {
    assert.equal(recruitee.fromUrl(u), null, u);
  }
});

test('recruitee: parses offers, full text, salary, places; skips sample, untitled and http rows', () => {
  const jobs = recruitee.parse(JSON.parse(fx('recruitee-offers.json')), { host: 'acmelabs.recruitee.com' });
  assert.deepEqual(jobs.map(j => j.title), ['Security Analyst', 'Backend Developer']);
  const [a, b] = jobs;
  assert.equal(a.source, 'recruitee');
  assert.equal(a.company, 'Acme Labs');
  assert.equal(a.url, 'https://acmelabs.recruitee.com/o/security-analyst');
  assert.equal(a.applyUrl, 'https://acmelabs.recruitee.com/o/security-analyst/c/new');
  assert.equal(a.location, 'Vancouver, British Columbia, Canada');
  assert.equal(a.canada, true);
  assert.equal(a.postedAt, '2026-11-02T14:00:00.000Z');
  assert.match(a.description, /Watch alerts & triage incidents\.\n• SIEM\n• Python/);
  assert.equal(a.salary, 'CAD 85,000 – 100,000 per year');
  assert.equal(a.department, 'Security');
  assert.equal(a.employment, 'fulltime');
  assert.equal(b.url, 'https://careers.acmelabs.example/o/backend-developer');
  assert.equal(b.location, 'Toronto, Ontario, Canada / Berlin, Germany / Remote');
  assert.equal(b.remote, true);
  assert.equal(b.canada, true);
  assert.equal(b.salary, '');
  assert.equal(recruitee.parse(null, { host: 'x.recruitee.com' }).length, 0);
});

test('personio: fromUrl knows .de and .com boards only', () => {
  assert.deepEqual(personio.fromUrl('https://acme.jobs.personio.de/job/1834171?language=en'), { host: 'acme.jobs.personio.de' });
  assert.deepEqual(personio.fromUrl('https://acme-gmbh.jobs.personio.com/'), { host: 'acme-gmbh.jobs.personio.com' });
  for (const u of ['https://www.personio.de/', 'https://acme.personio.de/', 'https://jobs.personio.de/', 'https://acme.jobs.personio.net/',
    'https://acme.jobs.personio.de.evil.io/', 'https://acmejobs.personio.de/', 'https://a.b.jobs.personio.de/']) {
    assert.equal(personio.fromUrl(u), null, u);
  }
});

test('personio: XML feed with offices, sections and dates; drops bad ids and empty names', () => {
  const t = { host: 'acme.jobs.personio.de', name: 'Acme' };
  const jobs = personio.parse(fx('personio-feed.xml'), t);
  assert.deepEqual(jobs.map(j => j.title), ['Staff Software Engineer, Data & Platform', 'IT Support Specialist (m/f/d)']);
  const [a, b] = jobs;
  assert.equal(a.url, 'https://acme.jobs.personio.de/job/1834171');
  assert.equal(a.company, 'Acme');
  assert.equal(a.location, 'Munich / Berlin');
  assert.equal(a.postedAt, '2026-10-13T14:10:41.000Z');
  assert.match(a.description, /^Your tasks\n• Build APIs\n• Own the pipeline/);
  assert.match(a.description, /Your profile\nNode\.js & SQL/);
  assert.equal(a.department, 'Engineering');
  assert.equal(a.employment, 'full-time, permanent');
  assert.equal(b.remote, true);
  assert.equal(b.description, '');
});

test('personio: careers page fallback (page payload, then old job-box links)', () => {
  const t = { host: 'acme.jobs.personio.com' };
  const jobs = personio.parse(fx('personio-page.html'), t);
  assert.deepEqual(jobs.map(j => [j.title, j.url, j.location]), [
    ['Cloud Engineer', 'https://acme.jobs.personio.com/job/2560093', 'Vienna / Remote'],
    ['Data Analyst', 'https://acme.jobs.personio.com/job/2560094', 'Graz'],
  ]);
  assert.equal(jobs[0].company, 'acme');
  assert.equal(jobs[0].postedAt, '2026-10-20T08:00:00.000Z');
  const old = '<a class="page_jobBox__x job-box" href="/job/42?language=en"><h3 class="t">QA &amp; Test Lead</h3><span class="page_jobMetaText__Ab">Zurich</span></a>'
    + '<a href="/job/43"><h3>Not a job box</h3></a>';
  assert.deepEqual(personio.parse(old, t).map(j => [j.title, j.url, j.location]), [['QA & Test Lead', 'https://acme.jobs.personio.com/job/42', 'Zurich']]);
});

const BOARD = '11111111-2222-3333-4444-555555555555';
test('ultipro: fromUrl knows UKG board links on every recruiting host, nothing else', () => {
  assert.deepEqual(ultipro.fromUrl(`https://recruiting.ultipro.com/EXA5001EXCO/JobBoard/${BOARD}/?q=&o=postedDateDesc`),
    { host: 'recruiting.ultipro.com', tenant: 'EXA5001EXCO', board: BOARD });
  assert.deepEqual(ultipro.fromUrl(`https://recruiting2.ultipro.com/EXA5001EXCO/JobBoard/${BOARD.toUpperCase()}/OpportunityDetail?opportunityId=abc`),
    { host: 'recruiting2.ultipro.com', tenant: 'EXA5001EXCO', board: BOARD });
  assert.equal(ultipro.fromUrl(`https://recruiting.ultipro.ca/EXA5001EXCO/JobBoard/${BOARD}`).host, 'recruiting.ultipro.ca');
  for (const u of [`https://ultipro.com/EXA/JobBoard/${BOARD}/`, `https://recruiting.ultipro.com.evil.io/EXA/JobBoard/${BOARD}/`,
    `https://recruitingx.ultipro.com/EXA/JobBoard/${BOARD}/`, `https://evil.recruiting.ultipro.com/EXA/JobBoard/${BOARD}/`,
    `http://recruiting.ultipro.com/EXA/JobBoard/${BOARD}/`, 'https://recruiting.ultipro.com/EXA/JobBoard/not-a-guid/',
    `https://recruiting.ultipro.com/EXA/Other/${BOARD}/`, `https://recruiting.ultipro.com/a%2Fb/JobBoard/${BOARD}/`, 'https://recruiting.ultipro.com/']) {
    assert.equal(ultipro.fromUrl(u), null, u);
  }
});

test('ultipro: search results with places, dates, types; detail page fills the full text', () => {
  const t = { host: 'recruiting2.ultipro.com', tenant: 'EXA5001EXCO', board: BOARD, name: 'Example Co' };
  const id = '6a1f2c3d-0000-4000-8000-000000000001';
  const detail = ultiproDetail(fx('ultipro-detail.html'), id);
  assert.equal(detail.Title, 'Cybersecurity Analyst');
  assert.equal(ultiproDetail(fx('ultipro-detail.html'), 'other-id'), null);
  assert.equal(ultiproDetail('<html>empty shell</html>', id), null);

  const jobs = ultipro.parse(JSON.parse(fx('ultipro-search.json')), t, { [id]: detail });
  assert.equal(jobs.length, 2);
  const [a, b] = jobs;
  assert.equal(a.url, `https://recruiting2.ultipro.com/EXA5001EXCO/JobBoard/${BOARD}/OpportunityDetail?opportunityId=${id}`);
  assert.equal(a.company, 'Example Co');
  assert.equal(a.location, 'Toronto, ON, Canada');
  assert.equal(a.canada, true);
  assert.equal(a.postedAt, '2026-11-03T16:22:10.123Z');
  assert.match(a.description, /brace \} and a quote " inside\.\n• Splunk/);
  assert.equal(a.department, 'Information Technology');
  assert.equal(a.employment, 'Full-time');
  assert.equal(a.remote, false);
  assert.match(b.url, /opportunityId=2001$/);
  assert.equal(b.remote, true);
  assert.equal(b.employment, 'Part-time');
  assert.equal(b.location, 'Remote - US');

  const noDetail = ultipro.parse(JSON.parse(fx('ultipro-search.json')), t);
  assert.equal(noDetail[0].description, 'Monitor our SIEM & respond.');
  assert.equal(ultiproPlaces(['Calgary, AB', { Address: { City: 'Austin', State: { Code: 'TX' }, Country: { Code: 'USA' } } }]), 'Calgary, AB / Austin, TX, USA');
});
