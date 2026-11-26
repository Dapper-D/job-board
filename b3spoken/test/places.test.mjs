// Board province filter: employers often name only the city.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provincesOf } from '../src/helper/places.mjs';
import { inProvince, queryJobs } from '../src/helper/jobs.mjs';
import * as jobsMod from '../src/helper/jobs.mjs';
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

// ---- Private build: the job's city as the address ----
import { jobCity, addressFor } from '../src/helper/places.mjs';
import { planResume } from '../src/helper/tailor/tailor.mjs';

test('private build: the first city a posting names, with its province', () => {
  const is = (loc, want) => assert.equal(jobCity(loc), want, loc);
  is('Surrey, BC', 'Surrey, BC'); is('Burnaby, Canada', 'Burnaby, BC'); is('Toronto Office', 'Toronto, ON');
  is('SAANICH STORE - 7055', 'Saanich, BC'); is('CA-BC-Vancouver', 'Vancouver, BC'); is('North Vancouver, BC', 'North Vancouver, BC');
  is('Vancouver / Toronto / Montreal', 'Vancouver, BC'); is('London, United Kingdom / Toronto, ON', 'Toronto, ON');
  is('Toronto, ON (Remote)', 'Toronto, ON'); is('Tofino, BC', 'Tofino, BC'); is("St. John's, NL", "St. John's, NL");
  is('Portage la Prairie, MB', 'Portage la Prairie, MB'); is('Montréal, Québec, CA, H3A 0A8', 'Montreal, QC');
  for (const none of ['Remote', 'Canada', 'Remote - Canada', 'British Columbia', 'Remote, ON', 'Lower Mainland, BC', 'GTA', 'Various Locations, BC',
    'Ontario, CA, United States', 'Kirkland, WA', 'Richmond, Virginia', '']) is(none, '');
});

test('private build: the resume address becomes the job\'s city; everything else on the line stays', () => {
  const j = { location: 'Toronto, ON' };
  assert.deepEqual(addressFor(['Surrey, BC | 778-555-0100 | a@gmail.com | github.com/me | linkedin.com/in/me'], j), ['Toronto, ON | 778-555-0100 | a@gmail.com | github.com/me | linkedin.com/in/me']);
  assert.deepEqual(addressFor(['123 Main St, Surrey, BC V3T 1A1 • a@b.com'], j), ['Toronto, ON • a@b.com']);
  assert.deepEqual(addressFor(['604-555-1234 | a@b.com', 'Burnaby, British Columbia'], j), ['604-555-1234 | a@b.com', 'Toronto, ON']);
  assert.deepEqual(addressFor(['a@b.com | 604-555-1234'], j), ['Toronto, ON | a@b.com | 604-555-1234']); // no address on the resume: added first
  assert.deepEqual(addressFor(['Surrey, BC | a@b.com'], { location: 'Remote' }), ['Surrey, BC | a@b.com']); // no city in the posting: unchanged
  const lib = { contact: { name: 'A B', lines: ['Surrey, BC | a@b.com'] }, summary: '', skills: [], entries: [{ kind: 'experience', heading: 'Developer, Acme', dates: '2022 - 2024', details: [], bullets: [{ text: 'Built internal tools in Python.' }] }] };
  assert.deepEqual(planResume(lib, { title: 'Developer', company: 'Acme', location: 'Calgary, Alberta', description: '' }).contact, ['Calgary, AB | a@b.com']);
  assert.deepEqual(lib.contact.lines, ['Surrey, BC | a@b.com']); // the saved resume itself is never changed
});

test('a job open to several regions lists its Canadian places first', () => {
  const { canadaFirst } = jobsMod;
  assert.deepEqual(canadaFirst('Remote - US / Remote - Canada / United States'.split(' / '), true), ['Remote - Canada', 'Remote - US', 'United States']);
  assert.deepEqual(canadaFirst('Remote (United Kingdom) / Remote (Canada)'.split(' / '), true), ['Remote (Canada)', 'Remote (United Kingdom)']);
  assert.deepEqual(canadaFirst(['Toronto, ON', 'Montreal, QC'], false), ['Toronto, ON', 'Montreal, QC']); // all Canadian: order kept
  assert.deepEqual(canadaFirst(['New York, NY', 'London, UK'], true), ['New York, NY', 'London, UK']); // none Canadian: order kept
  assert.deepEqual(canadaFirst(['Vancouver, BC'], false), ['Vancouver, BC']);
  // The board's own list leads with the Canadian place.
  const j = { id: 'x', title: 'Developer', company: 'Acme', location: 'Remote US / Remote Canada', remote: true, postedAt: new Date().toISOString(), description: 'Build things' };
  assert.equal(jobsMod.queryJobs([j], { sort: 'date' }).jobs[0].location, 'Remote Canada / Remote US');
});

test('a posting with no city borrows the employer\'s own, read off its other postings', async () => {
  const { employerCities, cityForJob, addressFor } = await import('../src/helper/places.mjs');
  const pool = [
    { company: 'Scotiabank', location: 'Toronto, ON' },
    { company: 'Scotiabank Inc.', location: 'Toronto, Ontario, Canada' },
    { company: 'Scotiabank', location: 'Montreal, QC' },
    { company: 'Arctic Wolf', location: 'Waterloo, ON' },
    { company: 'Boosta', location: 'Remote (worldwide)' }, // nothing to learn from
  ];
  const cities = employerCities(pool);
  // The posting's own city always wins.
  assert.equal(cityForJob({ company: 'Scotiabank', location: 'Burnaby, BC' }, cities), 'Burnaby, BC');
  // No city in the posting: the employer's commonest one, and company names match through Inc./Ltd.
  assert.equal(cityForJob({ company: 'Scotiabank', location: 'Remote (Canada)' }, cities), 'Toronto, ON');
  assert.equal(cityForJob({ company: 'Arctic Wolf Ltd.', location: 'Canada' }, cities), 'Waterloo, ON');
  assert.equal(cityForJob({ company: 'Arctic Wolf Networks', location: 'Canada' }, cities), ''); // a different name is a different employer
  // A posting that names a province said something: only a city in that province will do.
  assert.equal(cityForJob({ company: 'Scotiabank', location: 'Remote - British Columbia' }, cities), '');
  assert.equal(cityForJob({ company: 'Scotiabank', location: 'Remote - Quebec' }, cities), 'Montreal, QC');
  // Nothing known about the employer: the resume keeps the address it had.
  assert.equal(cityForJob({ company: 'Boosta', location: 'Remote (Canada)' }, cities), '');
  assert.equal(cityForJob({ company: 'Someone Else', location: 'Remote (Canada)' }, cities), '');
  const lines = ['Surrey, BC | 604-555-0123 | me@example.com'];
  assert.equal(addressFor(lines, { company: 'Scotiabank', location: 'Remote (Canada)' }, cities)[0],
    'Toronto, ON | 604-555-0123 | me@example.com');
  assert.equal(addressFor(lines, { company: 'Boosta', location: 'Remote (Canada)' }, cities)[0], lines[0]);
  assert.deepEqual(addressFor(lines, { company: 'Scotiabank', location: 'Remote (Canada)' }), lines); // public build: unchanged
});
