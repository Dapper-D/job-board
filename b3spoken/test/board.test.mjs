import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEntry, dueToday } from '../src/helper/tracker.mjs';
import { queryJobs } from '../src/helper/jobs.mjs';
import { checkLink } from '../src/helper/paste.mjs';
import { makeJob } from '../src/scan/job.mjs';

test('tracker: applying sets a follow-up a week later; due dates', () => {
  const e = cleanEntry({ status: 'applied' }, {});
  assert.ok(e.appliedAt && /^\d{4}-\d{2}-\d{2}$/.test(e.followUp));
  assert.equal(cleanEntry({ status: 'bogus', notes: 'hi' }, { status: 'saved' }).status, 'saved');
  assert.equal(dueToday({ followUp: '2026-11-01', status: 'applied' }, '2026-11-05'), true);
  assert.equal(dueToday({ followUp: '2026-11-01', status: 'rejected' }, '2026-11-05'), false);
});

test('board tabs: To apply holds only jobs not acted on; each status has its own tab, with counts', async () => {
  const { viewCounts } = await import('../src/helper/jobs.mjs');
  const jobs = [
    { id: 'a', title: 'A', location: 'Vancouver, BC', postedAt: '2026-11-04T00:00:00Z', match: { label: 'Good', score: 60 } },
    { id: 's', title: 'S', location: 'Vancouver, BC', postedAt: '2026-11-04T00:00:00Z', match: { label: 'Good', score: 55 }, track: { status: 'saved' } },
    { id: 'old', title: 'Old', location: 'Vancouver, BC', postedAt: '2026-10-25T00:00:00Z', match: { label: 'Strong', score: 90 } },
    { id: 'ancient', title: 'Ancient', location: 'Vancouver, BC', postedAt: '2026-10-01T00:00:00Z', match: { label: 'Strong', score: 95 } },
    { id: 'nodate', title: 'No date', location: 'Vancouver, BC', match: { label: 'Strong', score: 90 } },
    { id: 'b', title: 'B', location: 'Vancouver, BC', match: { label: 'Strong', score: 80 }, track: { status: 'not-interested' } },
    { id: 'c', title: 'C', location: 'Toronto, ON', match: { label: 'Skip', score: 10 }, track: { status: 'applied', followUp: '2026-11-01' } },
    { id: 'r', title: 'R', location: 'Vancouver, BC', match: { label: 'Good', score: 50 }, track: { status: 'rejected' } },
  ];
  const now = Date.parse('2026-11-05T12:00:00Z');
  const ids = o => queryJobs(jobs, { now, ...o }).jobs.map(j => j.id);
  assert.deepEqual(ids({}), ['a', 's']); // applied, rejected and not-interested jobs leave To apply; old and undated jobs hidden
  assert.deepEqual(ids({ maxAgeDays: 14 }), ['old', 'a', 's']); // the 14-day choice reaches back further
  assert.deepEqual(ids({ maxAgeDays: 30 }), ['old', 'a', 's']); // never more than 14 days ('ancient' stays hidden)
  assert.deepEqual(ids({ maxAgeDays: 7 }), ['a', 's']);
  assert.deepEqual(ids({ maxAgeDays: 1 }), ['s']); // a saved job stays even when older than the window
  assert.deepEqual(ids({ view: 'applied' }), ['c']); // tracked jobs show in their tab whatever their age or score
  assert.deepEqual(ids({ view: 'rejected' }), ['r']);
  assert.deepEqual(ids({ view: 'not-interested' }), ['b']);
  assert.deepEqual(ids({ view: 'tracked' }).sort(), ['b', 'c', 'r', 's']);
  assert.deepEqual(ids({ view: 'due' }), ['c']);
  assert.deepEqual(viewCounts(jobs, now), { tracked: 4, due: 1, applied: 1, interview: 0, offer: 0, rejected: 1, 'not-interested': 1 });
});

test('paste a link: checked on the employer’s live list; job boards and stale postings refused', async () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const fresh = makeJob({ source: 'greenhouse', company: 'Acme', nativeId: 4012345, title: 'Developer', url: 'https://boards.greenhouse.io/acme/jobs/4012345', location: 'Vancouver, BC', postedAt: '2026-11-04T12:00:00Z' });
  const old = makeJob({ source: 'greenhouse', company: 'Acme', nativeId: 4099999, title: 'Analyst', url: 'https://boards.greenhouse.io/acme/jobs/4099999', location: 'Vancouver, BC', postedAt: '2026-10-01T00:00:00Z' });
  let fetched = 0;
  const sources = { greenhouse: { label: 'Greenhouse', fetchJobs: async t => { fetched++; assert.equal(t.board, 'acme'); return [fresh, old]; } } };
  const r = await checkLink('https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=x', { sources, now });
  assert.equal(r.job.title, 'Developer'); assert.equal(r.job.pasted, true);
  await assert.rejects(checkLink('https://boards.greenhouse.io/acme/jobs/4099999', { sources, now }), /72 hours/);
  await assert.rejects(checkLink('https://boards.greenhouse.io/acme/jobs/1234567', { sources, now }), /isn.t on the employer/);
  await assert.rejects(checkLink('https://www.linkedin.com/jobs/view/123', { sources, now }), /doesn.t read linkedin\.com/);
  await assert.rejects(checkLink('https://example.com/careers/1', { sources, now, catalogFile: '/nonexistent.json' }), /can.t check this site/);
  await assert.rejects(checkLink('http://boards.greenhouse.io/acme/jobs/1', { sources, now }), /https/);
  const before = fetched;
  assert.equal((await checkLink('https://boards.greenhouse.io/acme/jobs/4012345', { jobs: [fresh], sources, now })).how, 'already in your list');
  assert.equal(fetched, before); // no network call when it's already in the list
});

test('jobs nobody applied to leave the board after 14 days; applied ones stay in their tabs', async () => {
  const { viewCounts, expired } = await import('../src/helper/jobs.mjs');
  const now = Date.parse('2026-11-20T12:00:00Z');
  const old = '2026-11-01T00:00:00Z', recent = '2026-11-15T00:00:00Z';
  const jobs = [
    { id: 'saved-old', title: 'A', location: 'Vancouver, BC', postedAt: old, track: { status: 'saved' } },
    { id: 'saved-new', title: 'B', location: 'Vancouver, BC', postedAt: recent, track: { status: 'saved' } },
    { id: 'notes-old', title: 'C', location: 'Vancouver, BC', postedAt: old, track: { notes: 'call Sam' } },
    { id: 'pasted-old', title: 'D', location: 'Vancouver, BC', pasted: true, pastedAt: old },
    { id: 'pasted-new', title: 'E', location: 'Vancouver, BC', pasted: true, pastedAt: recent },
    { id: 'undated-old', title: 'F', location: 'Vancouver, BC', firstSeen: '2026-11-01' },
    { id: 'applied-old', title: 'G', location: 'Vancouver, BC', postedAt: old, track: { status: 'applied', followUp: '2026-11-10' } },
    { id: 'interview-old', title: 'H', location: 'Vancouver, BC', postedAt: old, track: { status: 'interview' } },
  ];
  const ids = o => queryJobs(jobs, { now, maxAgeDays: 14, ...o }).jobs.map(j => j.id).sort();
  assert.deepEqual(ids({}), ['pasted-new', 'saved-new']);
  assert.deepEqual(ids({ view: 'tracked' }), ['applied-old', 'interview-old', 'saved-new']);
  assert.deepEqual(ids({ view: 'applied' }), ['applied-old']);
  assert.deepEqual(ids({ view: 'due' }), ['applied-old']);
  assert.deepEqual(viewCounts(jobs, now), { tracked: 3, due: 1, applied: 1, interview: 1, offer: 0, rejected: 0, 'not-interested': 0 });
  assert.equal(expired({ postedAt: old }, Date.parse('2026-11-14T00:00:00Z')), false); // exactly 13 days: still there
});

test('every tab holds exactly as many jobs as its count says, whatever the filters', async () => {
  const { viewCounts, VIEWS } = await import('../src/helper/jobs.mjs');
  const now = Date.parse('2026-11-20T12:00:00Z');
  const labels = ['Skip', 'Stretch', 'Good', 'Strong'], statuses = ['', 'saved', 'applied', 'interview', 'offer', 'rejected', 'not-interested'];
  let seed = 7; const rnd = n => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const jobs = Array.from({ length: 400 }, (_, i) => {
    const st = statuses[rnd(statuses.length)];
    return { id: `j${i}`, title: `Job ${i}`, location: ['Burnaby, Canada', 'Toronto, ON', 'Remote (Canada)'][rnd(3)], remote: !rnd(3),
      postedAt: new Date(now - rnd(20) * 864e5).toISOString(), match: { label: labels[rnd(4)], score: rnd(100) },
      ...(st || !rnd(5) ? { track: { status: st, notes: rnd(4) ? '' : 'note', followUp: rnd(3) ? '' : '2026-11-15' } } : {}) };
  });
  const counts = viewCounts(jobs, now);
  for (const minLabel of ['', 'Good', 'Strong']) for (const province of ['', 'BC']) for (const maxAgeDays of [1, 3, 14]) {
    for (const view of VIEWS.filter(Boolean)) {
      const r = queryJobs(jobs, { now, view, minLabel, province, maxAgeDays, limit: 1000 });
      assert.equal(r.total, counts[view], `${view} with ${JSON.stringify({ minLabel, province, maxAgeDays })}`);
      let seen = 0; for (let off = 0; off < r.total; off += 200) seen += queryJobs(jobs, { now, view, minLabel, province, maxAgeDays, offset: off, limit: 200 }).jobs.length;
      assert.equal(seen, r.total); // paging through the tab shows every one
    }
  }
});
