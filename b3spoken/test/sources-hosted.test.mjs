import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import avature, { avatureFromPage, parseArticles } from '../src/scan/sources/avature.mjs';
import icims, { icimsPlace } from '../src/scan/sources/icims.mjs';
import jazzhr from '../src/scan/sources/jazzhr.mjs';
import jibe from '../src/scan/sources/jibe.mjs';

const fx = n => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('avature: recognises *.avature.net links and finds the search path', () => {
  assert.deepEqual(avature.fromUrl('https://acme.avature.net/careers/SearchJobs'), { host: 'acme.avature.net', path: '/careers/SearchJobs' });
  assert.deepEqual(avature.fromUrl('https://acme.avature.net/en_US/careers/JobDetail/Data-Engineer/900'), { host: 'acme.avature.net', path: '/en_US/careers/SearchJobs' });
  assert.deepEqual(avature.fromUrl('https://Acme.avature.net/'), { host: 'acme.avature.net', path: '/careers/SearchJobs' });
  for (const bad of ['https://www.avature.net/', 'https://avature.net/careers', 'https://acme.avature.net.evil.com/careers', 'https://evilavature.net/careers',
    'https://acme.avature.net@evil.com/careers', 'http://acme.avature.net/careers', 'https://jobs.ea.com/en_US/careers/SearchJobs', 'not a url']) {
    assert.equal(avature.fromUrl(bad), null, bad);
  }
});

test('avature: recognises a branded Avature site from its page', () => {
  const page = '<html><link href="/portal/9/css/avature.css"><a href="/en_US/careers/SearchJobs/?listFilterMode=1">Search jobs</a></html>';
  assert.deepEqual(avatureFromPage(page, 'https://jobs.ea.com/en_US/careers/Home'), { host: 'jobs.ea.com', path: '/en_US/careers/SearchJobs' });
  // A www page linking to the careers host of the same employer.
  const www = '<p>Avature</p><a href="https://jobs.telusinternational.com/en_US/careers/SearchJobs">Jobs</a>';
  assert.deepEqual(avatureFromPage(www, 'https://www.telusinternational.com/careers'), { host: 'jobs.telusinternational.com', path: '/en_US/careers/SearchJobs' });
  // Not Avature, or pointing at someone else's domain.
  assert.equal(avatureFromPage('<a href="/careers/SearchJobs">Jobs</a>', 'https://jobs.example.com/'), null);
  assert.equal(avatureFromPage('<p>Avature</p><a href="https://jobs.other.com/careers/SearchJobs">x</a>', 'https://www.example.com/'), null);
});

test('avature: parses result cards (three markups), dates, locations; drops link-less and off-host cards', () => {
  const t = { host: 'acme.avature.net', path: '/careers/SearchJobs', name: 'Acme' };
  const jobs = avature.parse(fx('avature-search.html'), t);
  assert.deepEqual(jobs.map(j => j.title), ['Senior PLM Engineer & Architect', 'Security Analyst', 'Cloud Engineer']);
  const [a, b, c] = jobs;
  assert.equal(a.source, 'avature');
  assert.equal(a.company, 'Acme');
  assert.equal(a.url, 'https://acme.avature.net/careers/JobDetail/Senior-PLM-Engineer-17304/17304?businessTitle=PLM');
  assert.equal(a.id, 'avature:acme:17304');
  assert.equal(a.postedAt, '2026-05-02T00:00:00.000Z');
  assert.equal(b.url, 'https://acme.avature.net/en_US/careers/JobDetail/Security-Analyst-900/900');
  assert.equal(b.location, 'Toronto, Ontario, Canada');
  assert.equal(b.canada, true);
  assert.equal(c.location, 'Remote - Canada'); // the h3 title, not "View more"
  assert.equal(c.remote, true);
  assert.equal(avature.parse(fx('avature-search.html'), { host: 'acme.avature.net' })[0].company, 'acme');
  assert.equal(avature.parse('<div>no jobs</div>', t).length, 0);
  assert.equal(parseArticles(undefined, 'https://acme.avature.net').length, 0);
});

test('icims: recognises classic portal links, not iCIMS’s own sites or Jibe sites', () => {
  assert.deepEqual(icims.fromUrl('https://careers-kinaxis.icims.com/jobs/search?ss=1'), { host: 'careers-kinaxis.icims.com' });
  assert.deepEqual(icims.fromUrl('https://careers-kinaxis.icims.com/jobs/1234/analyst/job'), { host: 'careers-kinaxis.icims.com' });
  assert.deepEqual(icims.fromUrl('https://uscareers-acme.icims.com/jobs/intro'), { host: 'uscareers-acme.icims.com' });
  assert.deepEqual(icims.fromUrl('https://careers-acme.icims.com/'), { host: 'careers-acme.icims.com' });
  for (const bad of ['https://www.icims.com/jobs/search', 'https://careers.icims.com/jobs/search', 'https://community.icims.com/jobs', 'https://icims.com/jobs',
    'https://careers-acme.icims.com.evil.com/jobs/search', 'https://evilicims.com/jobs/search', 'http://careers-acme.icims.com/jobs/search',
    'https://careers-acme.icims.com/login', 'https://acme.jibeapply.com/jobs/123', 'https://careers.acme.com/jobs/123']) {
    assert.equal(icims.fromUrl(bad), null, bad);
  }
  // Jibe keeps its own links.
  assert.deepEqual(jibe.fromUrl('https://acme.jibeapply.com/jobs/123'), { host: 'acme.jibeapply.com' });
  assert.equal(jibe.fromUrl('https://careers-acme.icims.com/jobs/search'), null);
});

test('icims: parses job cards, tidies places, drops off-host cards', () => {
  const t = { host: 'careers-acmefreight.icims.com' };
  const jobs = icims.parse(fx('icims-search.html'), t);
  assert.equal(jobs.length, 2);
  const [a, b] = jobs;
  assert.equal(a.title, 'Director, Revenue Operations & Strategy');
  assert.equal(a.url, 'https://careers-acmefreight.icims.com/jobs/1234/director%2c-revenue-operations/job');
  assert.equal(a.company, 'acmefreight');
  assert.equal(a.id, 'icims:acmefreight:1234');
  assert.equal(a.location, 'Edison, NJ, United States');
  assert.equal(a.canada, false);
  assert.match(a.description, /territory design/);
  assert.equal(b.title, 'Forklift Operator');
  assert.equal(b.location, 'Fontana, CA, United States');
  assert.equal(icimsPlace('CA-ON-Toronto'), 'Toronto, ON, Canada');
  assert.equal(icimsPlace('Multiple Locations'), 'Multiple Locations');
  assert.equal(icims.parse(null, t).length, 0);
});

test('jazzhr: recognises ApplyToJob links only', () => {
  assert.deepEqual(jazzhr.fromUrl('https://mogo.applytojob.com/apply'), { host: 'mogo.applytojob.com' });
  assert.deepEqual(jazzhr.fromUrl('https://mogo.applytojob.com/apply/AbC123/Junior-Software-Developer'), { host: 'mogo.applytojob.com' });
  for (const bad of ['https://www.applytojob.com/', 'https://applytojob.com/apply', 'https://x.applytojob.com.evil.com/apply', 'https://x.applytojob.com@evil/apply',
    'https://evilapplytojob.com/apply', 'http://mogo.applytojob.com/apply', 'https://mogo.jazzhr.com/apply']) {
    assert.equal(jazzhr.fromUrl(bad), null, bad);
  }
});

test('jazzhr: parses the board, pins links to the board host, keeps a job outside the usual cards', () => {
  const t = { host: 'mogo.applytojob.com', name: 'Mogo' };
  const jobs = jazzhr.parse(fx('jazzhr-board.html'), t);
  assert.deepEqual(jobs.map(j => j.title), ['Junior Software Developer & Tester', 'IT Support Specialist', 'Data Analyst']);
  const [a, b, c] = jobs;
  assert.equal(a.url, 'https://mogo.applytojob.com/apply/AbC123/Junior-Software-Developer');
  assert.equal(a.id, 'jazzhr:mogo:AbC123');
  assert.equal(a.company, 'Mogo');
  assert.equal(a.location, 'Vancouver, BC');
  assert.equal(a.canada, true);
  assert.equal(b.url, 'https://mogo.applytojob.com/apply/XyZ789/IT-Support-Specialist');
  assert.equal(b.remote, true);
  assert.equal(c.location, '');
  assert.equal(jazzhr.parse('<h2>There are no open positions at this time.</h2><a href="/apply/">Back</a>', t).length, 0);
  assert.equal(jazzhr.parse(fx('jazzhr-board.html'), { host: 'mogo.applytojob.com' })[0].company, 'mogo');
});
