// The cover letter made without an AI: wording problems seen in the letters of 2026-11-16.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLibrary } from '../src/helper/resume/library.mjs';
import { scoreJob, makeContext } from '../src/helper/tailor/match.mjs';
import { planResume, coverLetter, libraryText } from '../src/helper/tailor/tailor.mjs';
import { cleanProfile } from '../src/helper/profile.mjs';

const RESUME = `Jo Lee
jo@example.com
SKILLS
Python, SQL, REST APIs, Docker
EXPERIENCE
IT Support Engineer, Acme, 2023 - 2024
- Supported 200 staff and explained fixes to non-technical stakeholders.
PROJECTS
Threat Detection Platform (In Progress)
- Developing a Python platform that reads live network traffic to detect attacks.
Invoice Service
- Built a Python service with REST APIs and Docker.
EDUCATION
Douglas College - Diploma in Cybersecurity, 2026`;
const lib = buildLibrary(RESUME);
const profile = cleanProfile({ targetRoles: ['Software Developer'], workAuth: 'citizen', done: true });
const letterFor = (j) => {
  const m = scoreJob(j, makeContext(lib, libraryText(lib), profile, ['Software Developer']));
  return { m, text: coverLetter(planResume(lib, j), j, m, {}, new Date(2026, 10, 16)).paragraphs.join('\n') };
};
const DEV = { title: 'Software Developer', company: 'Beta', description: 'Python, REST APIs and Docker. You work with stakeholders, write documentation, and use Jira, Kafka, cloud and security tools.' };

test('a line that starts with "Developing" reads "I am developing"', () => {
  const { text } = letterFor(DEV);
  assert.match(text, /In my Threat Detection Platform project, I am developing a Python platform/);
  assert.doesNotMatch(text, /\bI developing\b/);
});

test('the letter opens with the skills the posting asks for, and never calls a soft word a tool', () => {
  const { m, text } = letterFor(DEV);
  assert.ok(m.have.includes('stakeholders'), 'the matcher sees the word'); // ...the letter just doesn't say "I used stakeholders"
  const first = text.split('\n')[0];
  assert.match(first, /^The Software Developer role at Beta asks for Python, Docker and REST APIs, all of which I bring\.$/);
  assert.doesNotMatch(text, /asks for[^.]*(stakeholders|documentation)/);
  assert.doesNotMatch(text, /used in the work above|among my skills/);
});

test('with only soft words in common, there is no skills sentence at all', () => {
  const { text } = letterFor({ title: 'Business Systems Analyst', company: 'Beta', description: 'Work with stakeholders on Agile teams.' });
  assert.doesNotMatch(text, /asks for/);
});

test('gaps name concrete tools only, and never something the resume covers under a longer word', () => {
  const { m, text } = letterFor(DEV);
  assert.ok(m.have.includes('security'), `have: ${m.have}`); // the resume says Cybersecurity
  assert.ok(m.missing.includes('cloud'), `missing: ${m.missing}`);
  const gap = text.split('\n').find((p) => /haven't used/.test(p)) || '';
  assert.match(gap, /Jira/); assert.match(gap, /Kafka/);
  assert.doesNotMatch(gap, /security/i); // the resume says Cybersecurity
  assert.doesNotMatch(gap, /cloud/i); // too vague to be a gap
});

test('the work closest to the job comes first: projects lead when the resume plan puts projects first', () => {
  const j = DEV;
  const m = scoreJob(j, makeContext(lib, libraryText(lib), profile, ['Software Developer']));
  const plan = planResume(lib, j);
  const body = (p) => coverLetter(p, j, m, {}, new Date(2026, 10, 16)).paragraphs.find((x) => /^(In my|As an?) /.test(x));
  assert.match(body({ ...plan, projectsFirst: true }), /^In my /);
  assert.match(body({ ...plan, projectsFirst: false }), /^As an IT Support Engineer at Acme/);
});
