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

test('board views: tracked, follow-ups due, and not-interested hidden', () => {
  const jobs = [
    { id: 'a', title: 'A', location: 'Vancouver, BC', match: { label: 'Good', score: 60 } },
    { id: 'b', title: 'B', location: 'Vancouver, BC', match: { label: 'Strong', score: 80 }, track: { status: 'not-interested' } },
    { id: 'c', title: 'C', location: 'Toronto, ON', match: { label: 'Skip', score: 10 }, track: { status: 'applied', followUp: '2026-11-01' } },
  ];
  const now = Date.parse('2026-11-05T12:00:00Z');
  assert.deepEqual(queryJobs(jobs, { now }).jobs.map(j => j.id), ['a', 'c']); // tracked Skip still shows; not-interested hidden
  assert.deepEqual(queryJobs(jobs, { view: 'tracked', now }).jobs.map(j => j.id).sort(), ['b', 'c']);
  assert.deepEqual(queryJobs(jobs, { view: 'due', now }).jobs.map(j => j.id), ['c']);
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
