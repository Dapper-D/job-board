// Board province filter: employers often name only the city.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provincesOf } from '../src/helper/places.mjs';
import { inProvince, queryJobs } from '../src/helper/jobs.mjs';
import { stampFirstSeen } from '../src/scan/daily.mjs';

const P = l => [...provincesOf(l)].sort().join(',');

test('cities, codes and province names give the province', () => {
  assert.equal(P('Burnaby, Canada'), 'BC');
  assert.equal(P('Surrey, Canada'), 'BC');
  assert.equal(P('Vancouver / Toronto'), 'BC,ON');
  assert.equal(P('Toronto - 100 Adelaide St W'), 'ON');
  assert.equal(P('SAANICH STORE - 7055'), 'BC');
  assert.equal(P('Chilliwack, CA-BC, Canada'), 'BC');
  assert.equal(P('(CAN) ON LISTOWEL 01160 WAL-MART'), 'ON');
  assert.equal(P('Canada - Montreal QC 630 boul René Lévesque Ouest'), 'QC');
  assert.equal(P('Montréal, Québec, CA, H3A 0A8'), 'QC');
  assert.equal(P('Maple Ridge / Pitt Meadows, Canada'), 'BC');
});

test('look-alike names go to the right place or nowhere', () => {
  assert.equal(P('Richmond Hill, ON'), 'ON'); // not also Richmond, BC
  assert.equal(P('Richmond, Canada'), 'BC');
  assert.equal(P('North Vancouver'), 'BC');
  assert.equal(P('Victoriaville'), 'QC'); // not Victoria, BC
  assert.equal(P('Richmond, VA / Toronto'), 'ON');
  assert.equal(P('Kirkland, WA'), '');
  assert.equal(P('London, England / Vancouver, WA'), '');
  assert.equal(P('Ontario, CA, United States'), ''); // Ontario, California
  assert.equal(P('Abbotsford, Victoria, Australia'), '');
  assert.equal(P('Hybrid - On site'), '');
  assert.equal(P('Canada (Hybrid)'), '');
});

test('the board keeps BC jobs named by city only', () => {
  assert.ok(inProvince({ location: 'Burnaby, Canada' }, 'BC'));
  assert.ok(!inProvince({ location: 'Burnaby, Canada' }, 'ON'));
  const now = Date.parse('2026-11-10T12:00:00Z');
  const jobs = [
    { id: 'a', title: 'Developer', location: 'Surrey, Canada', postedAt: '2026-11-09T00:00:00Z' },
    { id: 'b', title: 'Developer', location: 'Toronto Office', postedAt: '2026-11-09T00:00:00Z' },
    { id: 'c', title: 'Developer', location: 'Vancouver, Canada', firstSeen: '2026-11-10' }, // no posting date: first seen today
    { id: 'd', title: 'Developer', location: 'Vancouver, Canada', firstSeen: '2026-10-01' }, // first seen long ago
    { id: 'e', title: 'Developer', location: 'Vancouver, Canada' }, // no date at all
  ];
  assert.deepEqual(queryJobs(jobs, { province: 'BC', now }).jobs.map(j => j.id).sort(), ['a', 'c']);
});

test('undated jobs keep the day the scan first saw them', () => {
  const pool = [{ id: 'x', postedAt: '2026-11-09T00:00:00Z' }, { id: 'y' }, { id: 'z' }];
  const keep = stampFirstSeen(pool, { y: '2026-11-01', gone: '2026-10-01' }, '2026-11-10');
  assert.deepEqual(keep, { y: '2026-11-01', z: '2026-11-10' }); // closed jobs are forgotten
  assert.equal(pool[0].firstSeen, undefined);
  assert.equal(pool[1].firstSeen, '2026-11-01');
});
