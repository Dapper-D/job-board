import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractText } from '../src/helper/resume/extract.mjs';
import { buildLibrary } from '../src/helper/resume/library.mjs';
import { parsePay, scoreJob, makeContext, yearsOfExperience } from '../src/helper/tailor/match.mjs';
import { planResume, renderResume, coverLetter, renderCoverLetter } from '../src/helper/tailor/tailor.mjs';
import { Doc, wrap, textWidth, toWinAnsi } from '../src/helper/tailor/pdf.mjs';
import { cleanProfile } from '../src/helper/profile.mjs';

const text = extractText(readFileSync(new URL('./fixtures/resume/sample-resume.docx', import.meta.url)), 'x.docx').text;
const lib = buildLibrary(text);
const profile = cleanProfile({ targetRoles: ['Software Developer'], payFloor: 35, payFloorUnit: 'hour', payGoal: 100000, payGoalUnit: 'year', workAuth: 'needs-sponsorship', avoidIndustries: ['gambling'], done: true });
const ctx = makeContext(lib, text, profile, ['Software Developer', 'Python Developer']);
const job = (title, description, extra = {}) => ({ id: title, title, company: 'Acme', description, location: 'Vancouver, BC', ...extra });

test('pay is read from common formats and turned into yearly amounts', () => {
  assert.deepEqual(parsePay('$90,000 - $110,000 per year'), { min: 90000, max: 110000, unit: 'year' });
  assert.deepEqual(parsePay('CA$95K–120K'), { min: 95000, max: 120000, unit: 'year' });
  assert.deepEqual(parsePay('$35/hr'), { min: 72800, max: 72800, unit: 'hour' });
  assert.deepEqual(parsePay('$28 - $32 hourly'), { min: 58240, max: 66560, unit: 'hour' });
  assert.equal(parsePay('We have 3 offices'), null);
  assert.ok(Math.abs(yearsOfExperience(lib, new Date(2026, 10, 1)) - 5.4) < 0.3);
});

test('scores: strong fits rank high; hard stops make a job Skip with a reason', () => {
  const good = scoreJob(job('Software Developer', 'Python, Flask, REST APIs, pytest, Docker and PostgreSQL. $95,000 - $120,000 per year.'), ctx);
  assert.equal(good.label, 'Strong'); assert.ok(good.score >= 70);
  assert.ok(good.reasons.some(r => /goal/.test(r)));
  assert.equal(scoreJob(job('Software Developer', 'Python. $20 - $25 per hour.'), ctx).label, 'Skip'); // below the $35/h floor
  assert.match(scoreJob(job('Software Developer', 'Python and Flask. We are unable to sponsor work permits.'), ctx).stops[0], /sponsor/);
  assert.match(scoreJob(job('Developer', 'Python for an online gambling platform.'), ctx).stops[0], /avoid/);
  assert.equal(scoreJob(job('Store Associate', 'Stock shelves and greet guests.'), ctx).label, 'Skip');
  const senior = scoreJob(job('Senior Staff Software Developer', 'Python. 10+ years of professional experience.'), ctx);
  assert.ok(senior.score < good.score && senior.reasons.some(r => /10\+ years/.test(r)));
});

test('tailored resume: own bullets only, closest first, flagged lines left out, one page, no metadata', () => {
  const l = structuredClone(lib);
  l.entries[1].bullets.push({ id: 'e2b9', text: 'Led SOC incident response for a bank.', flagged: true });
  const j = job('IT Security Analyst - Burnaby, BC', 'Active Directory access reviews, security tickets and incident response.');
  const plan = planResume(l, j);
  assert.equal(plan.headline, 'IT Security Analyst');
  const it = plan.experience.find(e => /Contoso/.test(e.heading));
  assert.equal(it.bullets[0].text, 'Managed user accounts and access reviews in Active Directory.'); // moved up for this job
  assert.ok(!it.bullets.some(b => b.flagged));
  const all = new Set(l.entries.flatMap(e => e.bullets.map(b => b.text)));
  for (const e of [...plan.experience, ...plan.projects]) for (const b of e.bullets) assert.ok(all.has(b.text));
  const pdf = renderResume(plan);
  const raw = pdf.toString('latin1');
  assert.match(raw, /\/Count 1 /);
  assert.doesNotMatch(raw, /\/Info|\/Producer|\/Creator|\/CreationDate|\/Metadata|\/Author/);
  const back = extractText(pdf, 'r.pdf').text;
  assert.match(back, /Jordan Lee/);
  assert.match(back, /Managed user accounts and access reviews in Active Directory\./);
  assert.doesNotMatch(back, /bank/);
  // AI order wins over keyword order, and unknown IDs are ignored.
  const ai = planResume(l, j, { order: ['e2b2', 'zz9'] });
  assert.equal(ai.experience.find(e => /Contoso/.test(e.heading)).bullets[0].id, 'e2b2');
});

test('long resumes are trimmed to one page', () => {
  const big = structuredClone(lib);
  for (let i = 0; i < 8; i++) big.entries.push({ id: `x${i}`, kind: 'experience', heading: `Analyst ${i}, Example Co`, dates: '2010 – 2012', details: [], bullets: Array.from({ length: 6 }, (_, k) => ({ id: `x${i}b${k}`, text: `Did a long and detailed piece of work number ${k} that took many words to describe properly here.`, flagged: false })) });
  assert.match(renderResume(planResume(big, job('Analyst', 'analysis'))).toString('latin1'), /\/Count 1 /);
});

test('cover letter is honest about gaps and uses the person’s own achievements', () => {
  const j = job('Software Developer', 'Python, Kubernetes and Kafka.');
  const m = scoreJob(j, ctx);
  const plan = planResume(lib, j);
  const letter = coverLetter(plan, j, m, { missingSkills: ['Kubernetes'] }, new Date(2026, 10, 5));
  const all = letter.paragraphs.join(' ');
  assert.match(all, /As a Software Developer at Northwind Logistics, I built a Python service/);
  assert.match(all, /also mentions (Kubernetes and Kafka|Kafka and Kubernetes)\. I haven't used these in a paid role yet/);
  assert.doesNotMatch(all.replace(/also mentions[^.]*\./, ''), /Kubernetes|Kafka/);
  assert.match(renderCoverLetter(plan, letter).toString('latin1'), /\/Count 1 /);
});

test('PDF basics: Windows-1252 text, widths and wrapping', () => {
  assert.deepEqual(toWinAnsi('é–•'), [0xe9, 0x96, 0x95]);
  assert.equal(textWidth('ii', 10), 4.44);
  assert.ok(wrap('one two three four five six', 10, 50).length > 1);
  assert.match(new Doc().text(10, 10, 'a (b) \\ c').build().toString('latin1'), /\(a \\\(b\\\) \\\\ c\) Tj/);
});

// ---- AI tailoring, as in the Job Hunt Kit ----
import { checkTailored, TAILOR_PROMPT, withSeeking, tokens } from '../src/helper/tailor/tailor.mjs';

const goodDraft = () => ({
  summary: 'Developer with two years of Python experience building REST APIs and internal tools, plus IT support in a health setting.',
  skills: [{ group: 'Backend', items: ['python', 'PostgreSQL', 'Kubernetes'] }, { group: 'Testing', items: ['pytest'] }],
  experience: [{ id: 'e1', bullets: ['e1b2', 'e1b1', 'zz'] }, { id: 'e3', bullets: ['e3b1'] }],
  projects: [{ id: 'e3', bullets: ['e3b1'] }],
  expFirst: true,
  cover: {
    hook: 'Acme moves freight data for thousands of carriers, and its API team keeps that data flowing.',
    proof: 'At Northwind Logistics I built a Python service that cut invoice processing time by 40%.',
    bullets: [{ label: 'REST APIs:', text: 'Wrote Flask APIs used by three internal teams.' }, { label: 'Testing', text: 'Added pytest coverage and a GitHub Actions pipeline.' }, { label: 'Support:', text: 'Resolved L1/L2 tickets for 200 staff.' }],
    why: 'Acme’s focus on logistics matches the work I already know.',
    gap: 'I haven’t used Kafka yet, and I would learn it quickly.',
    close: 'Thank you for your time; I would welcome a conversation.',
  },
});

test('AI tailoring: only real IDs and skills are kept, in the AI’s order, with the role sought in the summary', () => {
  const j = job('Backend Developer - Vancouver, BC', 'Python, PostgreSQL, REST APIs and Kafka.');
  const { tailored, problem } = checkTailored(goodDraft(), lib, { missingSkills: [] }, j);
  assert.equal(problem, '');
  assert.deepEqual(tailored.skills, [{ label: 'Backend', items: ['Python', 'PostgreSQL'] }, { label: 'Testing', items: ['pytest'] }]); // library spelling, Kubernetes dropped
  assert.deepEqual(tailored.experience, [{ id: 'e1', bullets: ['e1b2', 'e1b1'] }]); // unknown bullet and a project listed as experience dropped
  const plan = planResume(lib, j, { ai: tailored });
  assert.match(plan.summary, /internal tools, plus IT support in a health setting\. Seeking a Backend Developer role\.$/);
  assert.equal(plan.experience.length, 1);
  assert.deepEqual(plan.experience[0].bullets.map(b => b.id), ['e1b2', 'e1b1']);
  assert.equal(plan.projectsFirst, false);
  const back = extractText(renderResume(plan), 'r.pdf').text;
  for (const h of ['PROFESSIONAL SUMMARY', 'SKILLS', 'EDUCATION', 'PROFESSIONAL EXPERIENCE', 'KEY PROJECTS']) assert.match(back, new RegExp(h));
  assert.ok(back.indexOf('EDUCATION') < back.indexOf('PROFESSIONAL EXPERIENCE')); // same order as the kit
  assert.doesNotMatch(back, /Contoso/); // the AI left it out
  assert.ok(TAILOR_PROMPT(j, lib, { missingSkills: ['Kafka'] }).includes('Never claim these (the person said they don\'t have them): Kafka'));
});

test('AI tailoring: drafts that claim more than the resume shows are rejected', () => {
  const j = job('Backend Developer', 'Python, Kafka and Kubernetes. 5+ years.');
  const bad = (edit) => { const d = goodDraft(); edit(d); return checkTailored(d, lib, { missingSkills: ['Kafka'] }, j).problem; };
  assert.match(bad(d => { d.cover.bullets[0].text = 'Built Kafka pipelines.'; }), /Kafka.*don't have/);
  assert.match(bad(d => { d.summary += ' Experienced with Kubernetes.'; }), /"kubernetes", which isn't on the resume/);
  assert.match(bad(d => { d.summary = 'Developer with 7 years of Python.'; }), /number "7"/);
  assert.match(bad(d => { d.cover.hook = "I'm applying for the Backend Developer role."; }), /generic/);
  assert.equal(bad(d => { d.cover.gap = 'I have not used Kafka yet.'; }), ''); // naming a missing skill in the gap line is honest, so it's allowed
  assert.equal(checkTailored('nope', lib, {}, j).tailored, null);
});

test('AI cover letter follows the template: subject, hook, three labelled bullets, why and gap, close; one page', () => {
  const j = job('Backend Developer', 'Python and REST APIs.');
  const plan = planResume(lib, j, { ai: checkTailored(goodDraft(), lib, {}, j).tailored });
  const letter = coverLetter(plan, j, null, {}, new Date(2026, 10, 5));
  assert.equal(letter.subject, 'Application for Backend Developer');
  assert.match(letter.paragraphs[0], /^Acme moves freight/);
  assert.deepEqual(letter.paragraphs.filter(p => p.startsWith('• ')).map(p => p.split(':')[0]), ['• REST APIs', '• Testing', '• Support']);
  assert.match(letter.paragraphs.at(-1), /^Thank you/);
  const pdf = renderCoverLetter(plan, letter);
  assert.match(pdf.toString('latin1'), /\/Count 1 /);
  const back = extractText(pdf, 'c.pdf').text;
  assert.match(back, /Subject: Application for Backend Developer/);
  assert.match(back, /Dear Hiring Manager/);
  assert.doesNotMatch(back, /I'm applying/);
});

test('links: addresses in the resume are clickable; the header shows GitHub as a word', () => {
  assert.deepEqual(tokens('Burnaby | jordan@example.com | github.com/jl | linkedin.com/in/jl', { header: true }).filter(t => t.uri),
    [{ w: 'jordan@example.com', uri: 'mailto:jordan@example.com' }, { w: 'GitHub', uri: 'https://github.com/jl' }, { w: 'linkedin.com/in/jl', uri: 'https://linkedin.com/in/jl' }]);
  assert.deepEqual(tokens('See github.com/Dapper-D/Under50.').at(-1), { w: 'github.com/Dapper-D/Under50.', uri: 'https://github.com/Dapper-D/Under50' });
  const raw = renderResume(planResume(lib, job('Developer', 'Python'))).toString('latin1');
  assert.match(raw, /\/Subtype \/Link .*\/URI \(https:\/\/github\.com\/jordanlee-example\)/);
  assert.match(raw, /\/URI \(mailto:jordan\.lee@example\.com\)/);
  assert.doesNotMatch(raw, /\/Info|\/Producer|\/Creator|\/Author|\/Metadata/);
  assert.equal(withSeeking('Builds APIs.', 'Software Developer - Remote'), 'Builds APIs. Seeking a Software Developer role.');
  assert.equal(withSeeking('Software developer who builds APIs.', 'Software Developer'), 'Software developer who builds APIs.');
});

test('AI tailoring: work history is put newest first even if the AI returns it oldest first', async () => {
  const { newestFirst } = await import('../src/helper/tailor/tailor.mjs');
  const a = { id: 'a', dates: 'Mar 2021 - Aug 2021' }, b = { id: 'b', dates: 'Mar 2022 - Mar 2023' }, c = { id: 'c', dates: 'Jan 2024 - Present' };
  assert.deepEqual(newestFirst([a, b, c]).map(e => e.id), ['c', 'b', 'a']);
  assert.deepEqual(newestFirst([a, { id: 'x', dates: '' }]).map(e => e.id), ['a', 'x']);
});
