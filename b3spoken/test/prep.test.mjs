import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractText } from '../src/helper/resume/extract.mjs';
import { buildLibrary } from '../src/helper/resume/library.mjs';
import { buildPrep, cleanQuestions } from '../src/helper/tailor/prep.mjs';
import { scoreJob, makeContext } from '../src/helper/tailor/match.mjs';

const text = extractText(readFileSync(new URL('./fixtures/resume/sample-resume.docx', import.meta.url)), 'x.docx').text;
const lib = buildLibrary(text);

test('interview prep: questions from the posting, answered only with the person’s own lines; honest gaps', () => {
  lib.entries[1].bullets.push({ id: 'e2b9', text: 'Ran the whole SOC for a bank.', flagged: true });
  const job = { id: 'j1', title: 'IT Support Analyst', company: 'Acme', location: 'Remote', description: 'Troubleshoot tickets and Active Directory access for our team. Work with non-technical stakeholders. Kubernetes a plus. Fast-paced.' };
  const m = scoreJob(job, makeContext(lib, text, {}, ['IT Support Specialist']));
  const p = buildPrep(lib, job, m, {}, { extraQuestions: ['How would you handle a locked-out executive?'] });
  const groups = new Set(p.items.map(i => i.group));
  for (const g of ['Openers', 'Skills they asked for', 'Skills you don’t have yet', 'Situations', 'Role-specific (from your AI)']) assert.ok(groups.has(g), g);
  const own = new Set(lib.entries.flatMap(e => e.bullets.filter(b => !b.flagged).map(b => b.text)));
  for (const it of p.items) for (const l of it.lines) assert.ok(own.has(l.text), l.text); // never flagged or invented lines
  const gap = p.items.find(i => /Kubernetes/.test(i.question));
  assert.match(gap.tip, /haven't used Kubernetes in a paid role yet/);
  const ad = p.items.find(i => /Active Directory/.test(i.question));
  assert.match(ad.lines[0].text, /Active Directory/);
  assert.ok(p.ask.some(q => /90 days/.test(q)) && p.ask.some(q => /remote/.test(q)));
});

test('AI questions: questions only, cleaned', () => {
  assert.deepEqual(cleanQuestions({ questions: ['How do you prioritise tickets?', 'Here is a great answer for you.', 42, 'Why?'] }), ['How do you prioritise tickets?']);
  assert.deepEqual(cleanQuestions(null), []);
});
