import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCanada, htmlToText, makeJob, decodeEntities, salaryText, salaryFromText } from '../src/scan/job.mjs';
import { SOURCES } from '../src/scan/sources/index.mjs';

test('isCanada: provinces, codes, cities, remote', () => {
  for (const l of ['Vancouver, BC', 'Toronto, Ontario', 'Remote - Canada', 'Montréal (QC)', 'Calgary', 'Ottawa, ON, CAN', 'Halifax, Nova Scotia', 'Remote, North America'])
    assert.equal(isCanada(l, /remote/i.test(l)), true, l);
  for (const l of ['London, England', 'Vancouver, WA', 'Amsterdam, NL', 'Bratislava, SK', 'Lima, PE', 'Victoria, Australia', 'Remote', 'New York, NY', '', 'Remote, North America'])
    assert.equal(isCanada(l, false), false, l);
});

test('htmlToText keeps structure and decodes entities', () => {
  assert.equal(htmlToText('<p>One &amp; two</p><ul><li>A</li><li>B</li></ul><script>x()</script>'), 'One & two\n• A\n• B');
  assert.equal(decodeEntities('&#233;t&#xE9; &lt;3'), 'été <3');
});

test('makeJob refuses jobs without a title or an https link', () => {
  assert.equal(makeJob({ source: 's', title: '', url: 'https://x.example' }), null);
  assert.equal(makeJob({ source: 's', title: 'T', url: 'http://x.example' }), null);
  assert.equal(makeJob({ source: 's', title: 'T', url: 'javascript:alert(1)' }), null);
  const j = makeJob({ source: 's', company: 'C', nativeId: 1, title: '  Dev  ', url: 'https://x.example/j', location: 'Remote', postedAt: 1762300000 });
  assert.equal(j.title, 'Dev');
  assert.equal(j.remote, true);
  assert.equal(j.postedAt, new Date(1762300000 * 1000).toISOString());
});

const base = { source: 'greenhouse', company: 'Acme', title: 'Developer', url: 'https://job-boards.greenhouse.io/acme/jobs/1', location: 'Vancouver, BC' };

test('a posting date far in the future is dropped (closing date or misread format)', () => {
  const later = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
  assert.equal(makeJob({ ...base, postedAt: later }).postedAt, null);
  const past = '2026-11-03T10:00:00.000Z';
  assert.equal(makeJob({ ...base, postedAt: past }).postedAt, past);
  const soon = new Date(Date.now() + 3600 * 1000).toISOString(); // time-zone slack is kept
  assert.equal(makeJob({ ...base, postedAt: soon }).postedAt, soon);
});

test('salary objects become readable text, never "[object Object]"', () => {
  assert.equal(salaryText({ min_value: '67700.0', max_value: '94700.0', unit: 'CAD' }), 'CAD 67,700 – 94,700');
  assert.equal(salaryText({ value: '$90k' }), '$90k');
  assert.equal(salaryText({ foo: 1 }), '');
  assert.equal(salaryText('[object Object]'), '');
  assert.equal(makeJob({ ...base, salary: { min_value: 100000, max_value: 120000, unit: 'USD' } }).salary, 'USD 100,000 – 120,000');
});

test('Greenhouse currency_range metadata is read as a pay range', () => {
  const jobs = SOURCES.greenhouse.parse({ jobs: [{ id: 5, title: 'Junior Software Developer', absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/5', location: { name: 'Vancouver, British Columbia, Canada' }, content: '<p>Build things</p>',
    metadata: [{ name: 'Salary Range', value: { min_value: '67700.0', max_value: '94700.0', unit: 'CAD' }, value_type: 'currency_range' }] }] }, { board: 'acme', name: 'Acme' });
  assert.equal(jobs[0].salary, 'CAD 67,700 – 94,700');
});

test('with no salary field, a pay range stated in the description is used', () => {
  assert.equal(salaryFromText('Canada Pay Range For This Role\n$67,700 — $94,700 CAD\nUse of AI'), '$67,700 — $94,700 CAD');
  assert.equal(salaryFromText('CAN base pay range per year: $133,000 - $183,000 CAD'), '$133,000 - $183,000 CAD');
  assert.equal(salaryFromText('We pay well and offer $500 for your home office.'), '');
  assert.equal(makeJob({ ...base, description: 'The salary range is $80,000 to $95,000 per year.' }).salary, '$80,000 to $95,000 per year');
});
