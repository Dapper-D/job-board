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
    { id: 'old', title: 'Old', location: 'Vancouver, BC', postedAt: '2026-10-20T00:00:00Z', match: { label: 'Strong', score: 90 } },
    { id: 'nodate', title: 'No date', location: 'Vancouver, BC', match: { label: 'Strong', score: 90 } },
    { id: 'b', title: 'B', location: 'Vancouver, BC', match: { label: 'Strong', score: 80 }, track: { status: 'not-interested' } },
    { id: 'c', title: 'C', location: 'Toronto, ON', match: { label: 'Skip', score: 10 }, track: { status: 'applied', followUp: '2026-11-01' } },
    { id: 'r', title: 'R', location: 'Vancouver, BC', match: { label: 'Good', score: 50 }, track: { status: 'rejected' } },
  ];
  const now = Date.parse('2026-11-05T12:00:00Z');
  const ids = o => queryJobs(jobs, { now, ...o }).jobs.map(j => j.id);
  assert.deepEqual(ids({}), ['a', 's']); // applied, rejected and not-interested jobs leave To apply; old and undated jobs hidden
  assert.deepEqual(ids({ maxAgeDays: 30 }), ['a', 's']); // never more than 3 days
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
