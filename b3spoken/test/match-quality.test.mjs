// Jobs that slipped onto a junior tech person's board on 2026-11-16, and the ones next to them that must stay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractText } from '../src/helper/resume/extract.mjs';
import { buildLibrary } from '../src/helper/resume/library.mjs';
import { scoreJob, makeContext, parsePay, familiesOf } from '../src/helper/tailor/match.mjs';
import { cleanProfile } from '../src/helper/profile.mjs';
import { libraryText } from '../src/helper/tailor/tailor.mjs';

const text = extractText(readFileSync(new URL('./fixtures/resume/sample-resume.docx', import.meta.url)), 'x.docx').text;
const lib = buildLibrary(text);
const profile = cleanProfile({ targetRoles: ['Security Analyst', 'Junior Software Developer', 'IT Support Analyst'], workAuth: 'citizen', done: true });
const ctxWith = (years) => ({ ...makeContext(lib, text, profile, ['Security Analyst', 'Junior Software Developer', 'IT Support Analyst']), years });
const junior = ctxWith(1.6);
const DESC = 'Python, SQL, REST APIs, Docker, security, documentation and troubleshooting.';
const score = (title, extra = {}, ctx = junior) => scoreJob({ id: title, title, company: 'Acme', description: DESC, location: 'Vancouver, BC', ...extra }, ctx);
const otherField = (m) => m.stops.some((s) => /different field/.test(s));

test('guarding a store or an event is not cybersecurity', () => {
  for (const t of ['*MUST HAVE VALID SECURITY LICENSE (CAN) Asset Protection Associate', 'Full Time Asset Protection Associate - Security License Required', 'Event Security Officer CCC', 'Security Guard', 'Loss Prevention Officer'])
    assert.ok(otherField(score(t)), t);
  for (const t of ['Security Analyst', 'Information Security Officer', 'Cyber Security Officer', 'IT Security Guard Duty Engineer'])
    assert.ok(!otherField(score(t)), t);
});

test('a tech word inside another trade’s title does not make it a tech job', () => {
  for (const t of ['Logyard/Mobile Equipment Supervisor', 'Cryogenic Systems Engineer II [639]', 'Accountant (Systems Analyst)', 'OT Security Sales Specialist'])
    assert.ok(otherField(score(t)), t);
  for (const t of ['Software Developer, Mobile Platform', 'Mobile Software Engineer I (iOS)', 'Mobile Developer', 'Systems Engineer', 'Systems Analyst (2 Positions)'])
    assert.ok(!otherField(score(t)), t);
});

test('level III and up is a senior title for someone with under 3 years', () => {
  for (const t of ['Software Engineer III, Sensor - Mac, Linux, or Windows (Hybrid)', 'IT Operations Analyst IV', 'SOC Analyst, Tier III', 'Systems Analyst 3', 'Threat Analyst 3', 'Support Engineer, Level 3']) {
    const m = score(t);
    assert.equal(m.label, 'Skip', t);
    assert.ok(m.stops.some((s) => /Senior-level title/.test(s)), t);
  }
  for (const t of ['Software Engineer II', 'Software Engineer I, Backend', 'Programmer Analyst I-2', 'IT Support Analyst', 'IV Therapy Support Analyst'])
    assert.ok(!score(t).stops.some((s) => /Senior-level/.test(s)), t);
  assert.notEqual(score('Software Engineer III', {}, ctxWith(5.4)).label, 'Skip');
});

test('"Bilingual" in the title asks for French', () => {
  for (const t of ['Bilingual Data Engineer', 'Bilingual IT Support Specialist', 'Service Ontario - Bilingual Customer Support Specialist - French'])
    assert.ok(score(t).stops.some((s) => /French/.test(s)), t);
  assert.ok(!score('Bilingual (Mandarin) IT Support Analyst').stops.some((s) => /French/.test(s)));
  assert.ok(!score('IT Support Analyst').stops.some((s) => /French/.test(s)));
});

test('a remote job whose title names another region is not open to Canada', () => {
  const remote = { remote: true, location: 'Remote (Anguilla, Antigua and Barbuda, Argentina, Canada, Chile)' };
  for (const t of ['RevOps Data Infrastructure Engineer (LatAm, Remote)', 'Software Developer - EMEA', 'IT Support Analyst (UK)', 'Security Analyst, APAC'])
    assert.ok(score(t, remote).stops.some((s) => /another region/.test(s)), t);
  for (const t of ['Software Engineer, AI & Automation - Canada', 'Product Support Engineer - NAMER', 'Software Developer (Americas)', 'Security Analyst (Canada or UK)'])
    assert.ok(!score(t, remote).stops.some((s) => /another region/.test(s)), t);
  // An office job in a Canadian city that serves another region is still a job here.
  assert.ok(!score('IT Support Analyst (EMEA hours)', { remote: false }).stops.some((s) => /another region/.test(s)));
});

test('a title that shares no word with the roles picked is a Stretch at most', () => {
  const m = score('Platform Engineer', { description: 'Python, SQL, REST APIs, Docker, PostgreSQL, pytest, Git and CI/CD. $110,000 - $130,000 per year.' });
  assert.ok(m.score >= 50, `score ${m.score}`); // the skills fit well...
  assert.equal(m.label, 'Stretch'); // ...but it isn't a role they picked
  assert.equal(score('Junior Software Developer', { description: 'Python, SQL, REST APIs, Docker, PostgreSQL, pytest, Git and CI/CD.' }).label, 'Strong');
});

test('documents are made ahead only for matches scoring 45 or more (and for jobs the person saved or added)', async () => {
  const { queryJobs, PREP_MIN_SCORE } = await import('../src/helper/jobs.mjs');
  assert.equal(PREP_MIN_SCORE, 45);
  const now = Date.parse('2026-11-16T12:00:00Z');
  const j = (id, s, extra = {}) => ({ id, title: id, company: 'Acme', location: 'Vancouver, BC', postedAt: '2026-11-15T00:00:00Z', match: { score: s, label: s >= 50 ? 'Good' : 'Stretch' }, ...extra });
  const jobs = [j('a', 61), j('b', 45), j('c', 44), j('d', 31), j('saved', 33, { track: { status: 'saved' } }), j('pasted', 30, { pasted: true })];
  const ids = (o) => queryJobs(jobs, { now, limit: 50, ...o }).jobs.map((x) => x.id).sort();
  assert.deepEqual(ids({ minScore: PREP_MIN_SCORE }), ['a', 'b', 'pasted', 'saved']);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd', 'pasted', 'saved']); // the board itself still lists every Stretch
});

// Wrong calls found by an audit of the real pool, 2026-11-25.
test('a resume that says Cybersecurity counts as security experience', () => {
  const lib = buildLibrary(`Jo Lee\njo@example.com\nSKILLS\nPython\nEXPERIENCE\nAnalyst, Acme, 2023 - 2024\n- Did the work.\nEDUCATION\nDiploma in Cybersecurity, 2026`);
  const ctx = makeContext(lib, libraryText(lib), cleanProfile({ targetRoles: ['Security Analyst'], workAuth: 'citizen', done: true }), ['Security Analyst']);
  const m = scoreJob({ title: 'Security Compliance Analyst', company: 'Acme', location: 'Burnaby, BC', description: 'You will use security tools and Python.' }, ctx);
  assert.ok(m.have.includes('security'), `have: ${m.have}`);
  assert.ok(!m.missing.includes('security'), `missing: ${m.missing}`);
});

test('pay: a month is a month, not the start of Montreal, and a stated Canadian range wins over a US one', () => {
  assert.deepEqual(parsePay('CAD 70,000 - 90,000 More about Zafin'), { min: 70000, max: 90000, unit: 'year' });
  assert.deepEqual(parsePay('$70,000 - $90,000 Montreal'), { min: 70000, max: 90000, unit: 'year' });
  assert.deepEqual(parsePay('$122,400 - $176,000 USD and $115,700 - $166,399 CAD'), { min: 115700, max: 166399, unit: 'year' });
  assert.equal(parsePay('$122,400 - $176,000 USD').currency, 'USD'); // US-only postings still convert, and say so
  assert.deepEqual(parsePay('$25 - $30 an hour'), { min: 52000, max: 62400, unit: 'hour' }); // hourly is kept as a yearly figure
});

test('titles written with a slash or back to front are not thrown away', () => {
  const ctx = (roles) => makeContext(lib, text, cleanProfile({ targetRoles: roles, workAuth: 'citizen', done: true }), roles);
  const score = (title) => scoreJob({ title, company: 'Acme', location: 'Vancouver, BC', description: 'Support staff, troubleshoot systems and write documentation.' }, ctx(['IT Support Analyst']));
  // A slash used to glue two words into one token, dropping the title below the field gate.
  const slash = score('Systems Support/Data Analyst');
  assert.ok(!slash.stops.length, `stopped: ${slash.stops}`);
  assert.ok(slash.score >= score('Systems Support Data Analyst').score - 5, `${slash.score}`);
  // "Noun, Qualifier" is how many Canadian employers write a title.
  assert.ok(familiesOf('Technician, Staging and Support').includes('it'));
  assert.ok(familiesOf('Analyst, Business Systems').includes('it'));
  assert.ok(familiesOf('Administrator, Systems').includes('it'));
  assert.deepEqual(familiesOf('Developer, Software'), familiesOf('Software Developer')); // same job either way round
});
