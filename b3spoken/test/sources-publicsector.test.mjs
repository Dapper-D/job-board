import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pageup, { readListing, listingUrl } from '../src/scan/sources/pageup.mjs';
import neogov, { readPage, pageUrl } from '../src/scan/sources/neogov.mjs';
import csod, { extractToken, csodDate, csodLocation, homeUrl } from '../src/scan/sources/csod.mjs';

const fx = n => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('pageup: fromUrl takes vendor-host listing and posting links only', () => {
  assert.deepEqual(pageup.fromUrl('https://careers.pageuppeople.com/932/cw/en/listing/'), { host: 'careers.pageuppeople.com', tenant: '932', site: 'cw', lang: 'en' });
  assert.deepEqual(pageup.fromUrl('https://careers.pageuppeople.com/798/cw/zh-c/job/500136/investment-manager'), { host: 'careers.pageuppeople.com', tenant: '798', site: 'cw', lang: 'zh-c' });
  for (const bad of [
    'https://evil.example/careers.pageuppeople.com/932/cw/en/listing/',
    'https://careers.pageuppeople.com.evil.example/932/cw/en/listing/',
    'https://evil.example/pageup/932/cw/en/listing/',
    'http://careers.pageuppeople.com/932/cw/en/listing/',
    'https://careers.pageuppeople.com/admin/cw/en/listing/',
    'https://careers.pageuppeople.com/932/cw',
    'https://jobs.hku.hk/932/cw/en/listing/',
    'not a url',
  ]) assert.equal(pageup.fromUrl(bad), null, bad);
  assert.equal(listingUrl({ tenant: '932', site: 'cw', lang: 'en' }, 2), 'https://careers.pageuppeople.com/932/cw/en/listing/?page=2&page-items=100');
});

test('pageup: parse reads only the results table, rebuilds links from the id, drops bad rows', () => {
  const t = { host: 'careers.pageuppeople.com', tenant: '932', site: 'cw', lang: 'en', name: 'University of Hong Kong' };
  const jobs = pageup.parse(fx('pageup-listing.html'), t);
  assert.deepEqual(jobs.map(j => j.title), ['Information Security Analyst', 'R&D Software Developer']);
  assert.equal(jobs[0].url, 'https://careers.pageuppeople.com/932/cw/en/job/537501');
  assert.equal(jobs[0].source, 'pageup');
  assert.equal(jobs[0].company, 'University of Hong Kong');
  assert.equal(jobs[0].id, 'pageup:university of hong kong:537501');
  assert.equal(jobs[0].location, '');
  assert.equal(jobs[0].postedAt, null);
  const page = readListing(fx('pageup-listing.html'), t);
  assert.equal(page.ok, true);
  assert.equal(page.hasMore, true);
  assert.equal(page.linkCount, 5); // job-link anchors in the table (not the commented one, not "job-link-extra")
  assert.equal(pageup.parse(fx('pageup-listing.html'), { ...t, name: undefined })[0].company, 'PageUp 932');
});

test('pageup: tells an empty board from a page that is not a listing, and never throws on junk', () => {
  const t = { tenant: '932', site: 'cw', lang: 'en' };
  assert.deepEqual(readListing('<table><tbody id="search-results-content"><tr><td>No jobs found</td></tr></tbody></table>', t), { ok: true, linkCount: 0, hasMore: false, rows: [] });
  assert.equal(readListing('<html><body>Please verify you are not a robot.</body></html>', t).reason, 'no-table');
  assert.equal(readListing('<tbody id="search-results-content"><a class="posting" href="/932/cw/en/job/1/x">Renamed</a></tbody>', t).reason, 'no-jobs-parsed');
  // A link that never closes must not take the next row's title.
  const unclosed = readListing('<tbody id="search-results-content"><a class="job-link" href="/932/cw/en/job/7/x">Never closed<a class="job-link" href="/932/cw/en/job/8/y">Eight</a></tbody>', t);
  assert.deepEqual(unclosed.rows.map(r => r.title), ['Eight']);
  for (const junk of [null, undefined, '', 42, {}]) assert.deepEqual(pageup.parse(junk, t), []);
  const start = Date.now();
  readListing('<tbody id="search-results-content">' + '<a class="job-link'.repeat(20000) + '<!--'.repeat(20000), t);
  assert.ok(Date.now() - start < 1000);
});

test('neogov: fromUrl takes governmentjobs.com and schooljobs.com agency links only', () => {
  assert.deepEqual(neogov.fromUrl('https://www.governmentjobs.com/careers/vancouverwa'), { host: 'www.governmentjobs.com', agency: 'vancouverwa', folder: '' });
  assert.deepEqual(neogov.fromUrl('https://schooljobs.com/careers/ClarkCollege/facultypositions'), { host: 'www.schooljobs.com', agency: 'clarkcollege', folder: 'facultypositions' });
  assert.deepEqual(neogov.fromUrl('https://www.governmentjobs.com/careers/vancouverwa/jobs/4712345/it-security-analyst-ii'), { host: 'www.governmentjobs.com', agency: 'vancouverwa', folder: '' });
  for (const bad of [
    'https://evil.example/neogov/careers/vancouverwa',
    'https://www.governmentjobs.com.evil.example/careers/vancouverwa',
    'https://evil-governmentjobs.com/careers/vancouverwa',
    'http://www.governmentjobs.com/careers/vancouverwa',
    'https://www.governmentjobs.com/careers/home/index',
    'https://www.governmentjobs.com/jobs/12345',
    'https://www.governmentjobs.com/careers/',
    'https://www.governmentjobs.com/careers/bad%20name',
  ]) assert.equal(neogov.fromUrl(bad), null, bad);
  assert.equal(pageUrl({ host: 'www.schooljobs.com', agency: 'clarkcollege', folder: 'facultypositions' }, 3),
    'https://www.schooljobs.com/careers/home/index?agency=clarkcollege&departmentFolder=facultypositions&sort=PostingDate&isDescendingSort=true&page=3');
});

test('neogov: parse keeps on-site job links, reads place, job type and pay', () => {
  const t = { host: 'www.governmentjobs.com', agency: 'vancouverwa', folder: '', name: 'City of Vancouver, WA' };
  const jobs = neogov.parse(fx('neogov-list.html'), t);
  assert.equal(jobs.length, 2);
  const [a, b] = jobs;
  assert.equal(a.title, 'IT Security Analyst II');
  assert.equal(a.url, 'https://www.governmentjobs.com/careers/vancouverwa/jobs/4712345/it-security-analyst-ii');
  assert.equal(a.id, 'neogov:city of vancouver, wa:4712345');
  assert.equal(a.location, 'Vancouver, WA');
  assert.equal(a.employment, 'Full Time');
  assert.equal(a.salary, '$85,000.00 - $112,000.00 Annually');
  assert.equal(a.canada, false);
  assert.equal(b.title, 'Part-time Math & Science Professor – Pool');
  assert.equal(b.url, 'https://www.governmentjobs.com/careers/vancouverwa/faculty/jobs/4712346/math-professor');
  assert.equal(b.remote, true);
  assert.equal(b.salary, '');
  assert.equal(neogov.parse(fx('neogov-list.html'), { ...t, name: undefined })[0].company, 'vancouverwa');
});

test('neogov: empty boards are empty, other pages are flagged, junk never throws', () => {
  const t = { host: 'www.schooljobs.com', agency: 'x', folder: '' };
  assert.deepEqual(readPage('<div class="jobs-not-found-container"><h2>No jobs at this time.</h2></div>', t), { ok: true, rows: [] });
  assert.equal(readPage('<html><body>Welcome to SchoolJobs</body></html>', t).ok, false);
  for (const junk of [null, undefined, '', '  \n', 7]) assert.deepEqual(neogov.parse(junk, t), []);
});

test('csod: fromUrl takes *.csod.com careersite links only', () => {
  assert.deepEqual(csod.fromUrl('https://career-ohb.csod.com/ux/ats/careersite/4/home?c=career-ohb'), { host: 'career-ohb.csod.com', siteId: 4, corp: 'career-ohb' });
  assert.deepEqual(csod.fromUrl('https://acme.eu.csod.com/ux/ats/careersite/12/home/requisition/88?c=acmecorp'), { host: 'acme.eu.csod.com', siteId: 12, corp: 'acmecorp' });
  assert.deepEqual(csod.fromUrl('https://acme.csod.com/ux/ats/careersite/1'), { host: 'acme.csod.com', siteId: 1, corp: 'acme' });
  for (const bad of [
    'https://evil.example/x.csod.com/ux/ats/careersite/4/home',
    'https://csod.com.evil.example/ux/ats/careersite/4/home',
    'https://evilcsod.com/ux/ats/careersite/4/home',
    'https://evil.example/csod/ux/ats/careersite/4/home',
    'http://career-ohb.csod.com/ux/ats/careersite/4/home?c=career-ohb',
    'https://career-ohb.csod.com/other/path',
    'https://career-ohb.csod.com/ux/ats/careersite/abc/home',
  ]) assert.equal(csod.fromUrl(bad), null, bad);
  assert.equal(homeUrl({ host: 'career-ohb.csod.com', siteId: 4, corp: 'career-ohb' }), 'https://career-ohb.csod.com/ux/ats/careersite/4/home?c=career-ohb');
});

test('csod: parse builds requisition links, places and dates, drops rows without id or title', () => {
  const t = { host: 'career-ohb.csod.com', siteId: 4, corp: 'career-ohb', name: 'OHB' };
  const jobs = csod.parse(JSON.parse(fx('csod-search.json')), t);
  assert.equal(jobs.length, 2);
  const [a, b] = jobs;
  assert.equal(a.title, 'IT Security Specialist (m/w/d)');
  assert.equal(a.url, 'https://career-ohb.csod.com/ux/ats/careersite/4/home/requisition/8410?c=career-ohb');
  assert.equal(a.id, 'csod:ohb:8410');
  assert.equal(a.location, 'Bremen, DE');
  assert.equal(a.postedAt, '2026-11-03T00:00:00.000Z');
  assert.equal(b.title, 'R&D Software Engineer');
  assert.equal(b.location, 'Vancouver, BC, CA / Toronto, ON, CA');
  assert.equal(b.canada, true);
  assert.equal(b.postedAt, null); // 2/30 is not a date
  assert.equal(csod.parse(JSON.parse(fx('csod-search.json')), { ...t, name: undefined })[0].company, 'career-ohb');
  for (const junk of [null, undefined, {}, { data: { requisitions: 'x' } }]) assert.deepEqual(csod.parse(junk, t), []);
});

test('csod: token and date helpers', () => {
  assert.equal(extractToken('<script>window.csod={"token":"eyJab.c-d_e","x":1}</script>'), 'eyJab.c-d_e');
  assert.equal(extractToken('<html>no token</html>'), '');
  assert.equal(extractToken(undefined), '');
  assert.equal(csodDate('7/3/2026'), '2026-07-03T00:00:00.000Z');
  for (const bad of ['13/40/2026', '4/31/2026', 'garbage', null, '2026-07-03']) assert.equal(csodDate(bad), null);
  assert.equal(csodLocation(undefined), '');
  assert.equal(csodLocation([null, { country: 'DE' }]), 'DE');
});
