import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCanada, htmlToText, makeJob, decodeEntities } from '../src/scan/job.mjs';

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
