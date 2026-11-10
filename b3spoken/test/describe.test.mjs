// Descriptions the job lists leave out are read from each job's own page, once, and kept from day to day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descriptionFromHtml, workdayDetailUrl, oracleDetailUrl, describeMissing } from '../src/scan/describe.mjs';

const LONG = 'You will build and run our payments services in Python and Go, review code, and work with product and security teams on new features.';

test('reading a posting out of a job page: structured data, page data, microdata and common class names', () => {
  const ld = `<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Dev","description":"&lt;p&gt;${LONG}&lt;/p&gt;"}</script></html>`;
  assert.equal(descriptionFromHtml(ld), LONG);
  const next = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"job":{"title":"Dev","descriptionHtml":"<p>${LONG}</p><ul><li>Python</li></ul>"}}}}</script>`;
  assert.match(descriptionFromHtml(next), /payments services[\s\S]*• Python/);
  const sf = `<div class="jobDisplay"><span itemprop="description"><span class="jobdescription"><p>${LONG}</p><div><b>Must have</b></div></span></span></div><footer>Cookies</footer>`;
  assert.match(descriptionFromHtml(sf), /^You will build[\s\S]*Must have$/); // the whole element, nothing after it
  const av = `<section><div class="article__content article__content--rich-text"><p>${LONG}</p></div></section>`;
  assert.equal(descriptionFromHtml(av), LONG);
  assert.equal(descriptionFromHtml('<html><body><div class="jobdescription">Apply now</div></body></html>'), ''); // too short to be a posting
  // Avature: a short "General Information" part first, then the real "Description & Requirements" part.
  const ea = `<div class="article__content"><div>Locations : Vancouver, British Columbia, Canada Role ID 216602 Worker Type Regular Employee Studio EA SPORTS</div></div>
    <h3>Description &amp; Requirements</h3><div class="article__content article__content--rich-text"><p>${LONG}</p><p>${LONG}</p></div>`;
  assert.match(descriptionFromHtml(ea), /^You will build[\s\S]*teams on new features\.$/);
  // Rippling-style page data: the description in parts, beside a longer privacy notice under another key.
  const rp = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { privacy: { content: 'We value your privacy. '.repeat(20) }, job: { description: { company: '<p>D-Wave builds quantum computers in Burnaby and Palo Alto.</p>', role: `<p>${LONG}</p>` } } } } })}</script>`;
  assert.match(descriptionFromHtml(rp), /^D-Wave builds[\s\S]*payments services/);
  // Apple: React Router page data with the posting's sections.
  const ap = `<script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify({ loaderData: { root: { appType: 'external' }, jobDetails: { jobsData: { jobSummary: LONG, minimumQualifications: '<ul><li>3+ years selling Apple products in a retail store.</li></ul>' } } } }))});</script>`;
  assert.match(descriptionFromHtml(ap), /payments services[\s\S]*• 3\+ years selling Apple/);
});

test('detail addresses for Workday and Oracle jobs', () => {
  assert.equal(workdayDetailUrl('https://clio.wd3.myworkdayjobs.com/ClioCareerSite/job/Vancouver/Software-Developer_REQ-5353'),
    'https://clio.wd3.myworkdayjobs.com/wday/cxs/clio/ClioCareerSite/job/Vancouver/Software-Developer_REQ-5353');
  assert.equal(workdayDetailUrl('https://clio.wd3.myworkdayjobs.com/ClioCareerSite'), null);
  assert.equal(oracleDetailUrl('https://fa-exhh-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/77399'),
    'https://fa-exhh-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%2277399%22,siteNumber=CX_1');
});

test('the daily pass: kept from yesterday, read once, misses retried after a week, old jobs skipped, a daily limit', async () => {
  const now = Date.parse('2026-11-10T05:00:00Z');
  const job = (id, extra = {}) => ({ id, source: 'workday', url: `https://acme.wd3.myworkdayjobs.com/Ext/job/X/${id}`, description: '', firstSeen: '2026-11-10', ...extra });
  const pool = [
    job('kept'), job('new1', { postedAt: '2026-11-09T00:00:00Z' }), job('new2'), job('miss-recent'), job('miss-old'),
    job('ancient', { postedAt: '2026-09-01T00:00:00Z', firstSeen: undefined }),
    { id: 'gh', source: 'greenhouse', url: 'https://boards.greenhouse.io/a/jobs/1', description: '' }, // lists that carry descriptions aren't re-read
    job('has', { description: 'Already here.' }),
  ];
  const read = [];
  const r = await describeMissing(pool, new Map([['kept', LONG]]), { 'miss-recent': '2026-11-07', 'miss-old': '2026-11-01', gone: '2026-11-09' }, {
    today: '2026-11-10', now, perDay: 2,
    read: async j => { read.push(j.id); return j.id === 'miss-old' ? { description: '' } : { description: `${LONG} Pay: $90,000 - $110,000 per year.`, postedAt: '2026-11-08T00:00:00.000Z' }; },
  });
  assert.deepEqual(read.sort(), ['miss-old', 'new2']); // newest first, two a day: new1 (posted yesterday) waits for tomorrow
  assert.equal(pool[0].description, LONG); // read on an earlier day
  assert.match(pool[2].description, /payments services/);
  assert.equal(pool[2].salary, '$90,000 - $110,000 per year');
  assert.equal(pool[2].postedAt, '2026-11-08T00:00:00.000Z'); // a page's date fills a missing one
  assert.equal(pool[1].description, ''); // not read today
  assert.equal(pool[3].description, ''); // tried 3 days ago: not again yet
  assert.deepEqual([r.carried, r.read, r.missed, r.left, r.skipped], [1, 1, 1, 1, 2]);
  assert.deepEqual(r.misses, { 'miss-recent': '2026-11-07', 'miss-old': '2026-11-10' }); // closed jobs are forgotten

  const r2 = await describeMissing([job('blank')], new Map(), {}, { today: '2026-11-10', now, read: async () => ({ description: 'Apply' }) });
  assert.deepEqual([r2.read, r2.missed, r2.misses], [0, 1, { blank: '2026-11-10' }]);
});

test('a host that keeps failing is left alone for the day instead of using up the limit', async () => {
  const now = Date.parse('2026-11-10T05:00:00Z');
  const pool = Array.from({ length: 40 }, (_, i) => ({ id: `j${i}`, source: 'successfactors', url: `https://jobs.blocked.example/job/${i}/`, description: '', firstSeen: '2026-11-10' }));
  let calls = 0;
  const r = await describeMissing(pool, new Map(), {}, { today: '2026-11-10', now, read: async () => { calls++; throw new Error('HTTP 403'); } });
  assert.equal(calls, 15);
  assert.equal(r.left, 25);
});
