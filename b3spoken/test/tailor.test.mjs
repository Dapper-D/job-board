import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractText } from '../src/helper/resume/extract.mjs';
import { buildLibrary } from '../src/helper/resume/library.mjs';
import { parsePay, scoreJob, makeContext, yearsOfExperience } from '../src/helper/tailor/match.mjs';
import { planResume, renderResume, coverLetter, renderCoverLetter, libraryText as libraryTextFor } from '../src/helper/tailor/tailor.mjs';
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
  // Formats from the job boards the pool reads
  assert.deepEqual(parsePay('CA$40.9K – CA$54.5K'), { min: 40900, max: 54500, unit: 'year' });
  assert.deepEqual(parsePay('CA$152K – CA$190K • Offers Equity'), { min: 152000, max: 190000, unit: 'year' });
  assert.deepEqual(parsePay('CAD 101000 – 132500 annual'), { min: 101000, max: 132500, unit: 'year' });
  assert.deepEqual(parsePay('CAD 135300 – 169100 per-year-salary'), { min: 135300, max: 169100, unit: 'year' });
  assert.deepEqual(parsePay('CAD 20 – 25 per-hour-wage'), { min: 41600, max: 52000, unit: 'hour' });
  assert.deepEqual(parsePay('$800 – $1,200 per week'), { min: 41600, max: 62400, unit: 'year' });
  assert.deepEqual(parsePay('USD 100000 – 140000 yearly'), { min: 137000, max: 191800, unit: 'year', currency: 'USD' });
  assert.deepEqual(parsePay('$112,000 - $140,00 CAD'), { min: 112000, max: 140000, unit: 'year' }); // a typo in the posting
  // A lone amount is pay only in the salary field; placeholders and funding news are never pay.
  assert.equal(parsePay('$220K • Offers Equity'), null);
  assert.deepEqual(parsePay('$220K • Offers Equity', { salaryField: true }), { min: 220000, max: 220000, unit: 'year' });
  assert.equal(parsePay('$500 signing bonus'), null);
  assert.equal(parsePay('We raised $15 million last year'), null);
  assert.equal(parsePay('CA$1 – CA$999,999'), null);
  assert.equal(parsePay('$1 — $1 USD'), null);
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
  assert.match(raw, /\/Author \(Jordan Lee\)/); // only the person's name and the title
  assert.match(raw, /\/FontFile2 .*|\/BaseFont \/[A-Z]{6}\+Carlito/);
  assert.doesNotMatch(raw, /\/Producer|\/Creator|\/CreationDate|\/ModDate|\/Metadata|Helvetica/);
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

test('PDF basics: embedded Carlito subset, widths, wrapping and readable text', () => {
  assert.deepEqual(toWinAnsi('é–•'), [0xe9, 0x96, 0x95]);
  assert.equal(Math.round(textWidth('ii', 10) * 100) / 100, 4.59); // Carlito (Calibri widths)
  assert.ok(textWidth('Bold', 10, true) > textWidth('Bold', 10));
  assert.ok(wrap('one two three four five six', 10, 50).length > 1);
  const pdf = new Doc({ title: 'T', author: 'Jordan Lee' }).text(10, 10, 'a (b) \\ c é–•').build();
  const raw = pdf.toString('latin1');
  assert.match(raw, /\/Type0 .*\/Encoding \/Identity-H/);
  assert.match(raw, /\/ToUnicode/);
  assert.match(raw, /\/Info \d+ 0 R/);
  assert.ok(pdf.length < 60000, `subset should be small, got ${pdf.length}`);
  assert.match(extractText(pdf, 'x.pdf').text, /a \(b\) \\ c é–•/);
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
  assert.ok(back.indexOf('PROFESSIONAL EXPERIENCE') < back.indexOf('EDUCATION')); // strongest evidence first, education last
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
  assert.doesNotMatch(raw, /\/Producer|\/Creator|\/Metadata/);
  assert.equal(withSeeking('Builds APIs.', 'Software Developer - Remote'), 'Builds APIs. Seeking a Software Developer role.');
  assert.equal(withSeeking('Software developer who builds APIs.', 'Software Developer'), 'Software developer who builds APIs.');
});

test('AI tailoring: work history is put newest first even if the AI returns it oldest first', async () => {
  const { newestFirst } = await import('../src/helper/tailor/tailor.mjs');
  const a = { id: 'a', dates: 'Mar 2021 - Aug 2021' }, b = { id: 'b', dates: 'Mar 2022 - Mar 2023' }, c = { id: 'c', dates: 'Jan 2024 - Present' };
  assert.deepEqual(newestFirst([a, b, c]).map(e => e.id), ['c', 'b', 'a']);
  assert.deepEqual(newestFirst([a, { id: 'x', dates: '' }]).map(e => e.id), ['a', 'x']);
});

test('polish: brackets touch their links, the role sought drops the team name, and AI JSON slips are forgiven', async () => {
  const { roleOnly } = await import('../src/helper/tailor/tailor.mjs');
  const { parseAiJson } = await import('../src/helper/resume/library.mjs');
  const t = tokens('Tool (github.com/a/tool | Python)');
  assert.deepEqual(t.map(x => x.w), ['Tool', '(', 'github.com/a/tool', '|', 'Python)']);
  assert.equal(t[2].glue, true); // "(" and the link touch: "(github.com/a/tool"
  assert.equal(t[3].glue, undefined);
  assert.equal(tokens('see (github.com/a/b)')[3].w, ')'); assert.equal(tokens('see (github.com/a/b)')[3].glue, true);
  assert.equal(roleOnly('Software Engineer I, Fullstack (Search)'), 'Software Engineer I');
  assert.equal(roleOnly('Backend Engineer, AI Engineering: Duo Chat'), 'Backend Engineer');
  assert.equal(roleOnly('IT Security Analyst - Burnaby, BC'), 'IT Security Analyst');
  assert.equal(withSeeking('Builds APIs.', 'Backend Engineer, AI Engineering: Duo Chat'), 'Builds APIs. Seeking a Backend Engineer role.');
  assert.deepEqual(parseAiJson('```json\n{"a": [1, 2,], "b": “x”,}\n```'), { a: [1, 2], b: 'x' });
});

test('resume: as many projects as fit on one page, best fit first, at most 2 bullets each', async () => {
  const many = structuredClone(lib);
  for (let i = 0; i < 6; i++) many.entries.push({ id: `p${i}`, kind: 'projects', heading: `Project ${i} (github.com/x/p${i} | Python)`, dates: '', details: [], bullets: [0, 1, 2].map(k => ({ id: `p${i}b${k}`, text: `Built part ${k} of project ${i} in Python with tests.`, flagged: false })) });
  const pdf = renderResume(planResume(many, job('Developer', 'Python')));
  const text = extractText(pdf, 'r.pdf').text;
  assert.match(pdf.toString('latin1'), /\/Count 1 /);
  const shown = [0, 1, 2, 3, 4, 5].filter(i => text.includes(`Project ${i} (`));
  assert.ok(shown.length >= 4, `expected most projects on the page, got ${shown.length}`);
  for (const i of shown) assert.doesNotMatch(text, new RegExp(`Built part 2 of project ${i} `)); // never a third bullet
});

test('the pay floor applies to "CA$…K" ranges', () => {
  const p = cleanProfile({ targetRoles: ['Software Developer'], payFloor: 35, payFloorUnit: 'hour', workAuth: 'citizen', done: true });
  const ctx = makeContext(lib, text, p, ['Software Developer']);
  const m = scoreJob({ title: 'Software Developer', company: 'Docebo', salary: 'CA$40.9K – CA$54.5K', description: 'Python and SQL.' }, ctx);
  assert.equal(m.label, 'Skip');
  assert.match(m.stops.join(' '), /below your lowest/);
});

test('French postings need French on the resume', async () => {
  const { asksForFrench } = await import('../src/helper/tailor/match.mjs');
  assert.equal(asksForFrench({ title: 'Développeur.euse Wordpress' }), true);
  assert.equal(asksForFrench({ title: 'Analyst', description: 'Bilingualism (English/French) is required.' }), true);
  assert.equal(asksForFrench({ title: 'Software Developer', description: 'Build tools with the team. French is an asset.' }), false);
  assert.equal(asksForFrench({ title: 'Registered Nurse', description: 'Excellent English skills. Bilingual proficiency in French is a significant asset but not required.' }), false);
  assert.equal(asksForFrench({ title: 'Analyst', description: 'Fluency in English and French is required for this role.' }), true);
  const p = cleanProfile({ targetRoles: ['Software Developer'], workAuth: 'citizen', done: true });
  const job = { title: 'Développeur Python', company: 'Acme', description: 'Python et SQL.' };
  assert.match(scoreJob(job, makeContext(lib, text, p, ['Software Developer'])).stops.join(' '), /French/);
  assert.doesNotMatch(scoreJob(job, makeContext(lib, text + '\nLanguages: English, French', p, ['Software Developer'])).stops.join(' '), /French/);
});

test('the cover letter says "used in the work above" only for skills the quoted work names', () => {
  const l = buildLibrary('Jo Lee\njo@example.com\nSKILLS\nPython, C++, SQL\nEXPERIENCE\nDeveloper, Acme, 2023 - Present\n- Built a Python service for invoices.\nEDUCATION\nBCIT, 2022');
  const j = { title: 'Software Developer', company: 'Beta', description: 'We use Python and C++ every day.' };
  const p = cleanProfile({ targetRoles: ['Software Developer'], workAuth: 'citizen', done: true });
  const m = scoreJob(j, makeContext(l, libraryTextFor(l), p, ['Software Developer']));
  const text = coverLetter(planResume(l, j), j, m, {}, new Date(2026, 10, 5)).paragraphs.join(' ');
  assert.match(text, /asks for Python, which I used in the work above\. My skills also include C\+\+\./);
  assert.doesNotMatch(text, /C\+\+[^.]*used in the work above/);
});

test('PDF: names beyond Latin-1 keep their letters in the metadata; emoji are left out; missing letters are reported', async () => {
  const { Doc, unsupported } = await import('../src/helper/tailor/pdf.mjs');
  const d = new Doc({ title: 'Nguyễn Văn An - Resume', author: 'Nguyễn Văn An' });
  d.text(72, 700, 'Shipped it 🚀 ✅ → done ➜ next');
  const pdf = d.build().toString('latin1');
  assert.match(pdf, /\/Author <FEFF004E00670075/); // UTF-16, not garbled bytes
  assert.deepEqual(unsupported('Shipped 🚀 ➜ Nguyễn'), []);
  assert.deepEqual(unsupported('李明 Li'), ['李', '明']);
});

test('level fit: staff/director titles need 7+ years; co-ops and internships are not for people with 4+ years', () => {
  const p = cleanProfile({ targetRoles: ['DevOps Engineer', 'Software Developer'], workAuth: 'citizen', done: true });
  const libFor = years => buildLibrary(`Tom Novak\ntom@example.com\nSKILLS\nPython, AWS\nEXPERIENCE\nDevOps Engineer, Acme, Jan ${2026 - years} - Present\n- Ran AWS infrastructure with Python tooling.\nEDUCATION\nCarleton, 2014`);
  const score = (years, title) => { const l = libFor(years); return scoreJob({ title, company: 'X', description: 'Python and AWS.' }, makeContext(l, libraryTextFor(l), p, p.targetRoles)); };
  assert.match(score(5, 'Staff DevOps Engineer').stops.join(' '), /Staff-level title/);
  assert.doesNotMatch(score(9, 'Staff DevOps Engineer').stops.join(' '), /level title/);
  assert.match(score(9, 'Cloud & DevOps Engineer Co-op (May 2027)').stops.join(' '), /co-op/);
  assert.doesNotMatch(score(1, 'Cloud & DevOps Engineer Co-op (May 2027)').stops.join(' '), /co-op/);
});

test('"Quality Assurance" counts as software testing only when the posting is about software', () => {
  const p = cleanProfile({ targetRoles: ['QA Analyst', 'Software Developer'], workAuth: 'citizen', done: true });
  const ctx = makeContext(lib, text, p, p.targetRoles);
  const lab = scoreJob({ title: 'Quality Assurance Associate', company: 'Canadian Blood Services', description: 'Review batch records and deviations under GMP for blood products; support audits and compliance documentation.' }, ctx);
  assert.match(lab.stops.join(' '), /different field/);
  const sw = scoreJob({ title: 'Quality Assurance Analyst', company: 'Acme', description: 'Write test cases and automated tests with Playwright for our web app; log bugs in Jira.' }, ctx);
  assert.doesNotMatch(sw.stops.join(' '), /different field/);
  assert.doesNotMatch(scoreJob({ title: 'Software QA Engineer', company: 'Acme', description: 'Quality checks.' }, ctx).stops.join(' '), /different field/);
});

test('fields: a help desk technician is IT, not a trade; a store customer service desk is not an IT service desk', async () => {
  const { familiesOf } = await import('../src/helper/tailor/match.mjs');
  assert.deepEqual(familiesOf('Help Desk Technician'), ['it']);
  assert.deepEqual(familiesOf('Journey Person Parts Technician'), ['trades']);
  assert.deepEqual(familiesOf('Industrial Electrician'), ['trades']);
  assert.ok(familiesOf('Field Service Technician, Network Infrastructure').includes('it'));
  assert.deepEqual(familiesOf('Customer Service Desk Associate'), ['customer']);
  assert.ok(familiesOf('IT Service Desk Analyst').includes('it'));
});
