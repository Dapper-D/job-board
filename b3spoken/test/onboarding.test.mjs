import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractText } from '../src/helper/resume/extract.mjs';
import { buildLibrary, checkAiLibrary, parseAiJson } from '../src/helper/resume/library.mjs';
import { suggestRoles, checkTarget } from '../src/helper/roles.mjs';
import { cleanProfile, yearly, searchRoles } from '../src/helper/profile.mjs';
import { createApp } from '../src/helper/main.mjs';

const fx = f => readFileSync(new URL(`./fixtures/resume/${f}`, import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'b3-onb-'));

test('reads text from Word, LibreOffice PDF and Chrome PDF resumes', () => {
  for (const f of ['sample-resume.docx', 'sample-resume.pdf']) {
    const r = extractText(fx(f), f);
    assert.ok(r.readable, f);
    assert.match(r.text, /• Built a Python service that cut invoice processing time by 40%\./, f);
    assert.match(r.text, /IT Support Analyst, Contoso Health/, f);
  }
  const c = extractText(fx('sample-chrome.pdf'), 'x.pdf');
  assert.match(c.text, /Software Developer, Northwind Logistics Jan 2023 – Present/);
  assert.match(c.text, /Wrote REST APIs in Flask used by three internal teams\./);
  assert.throws(() => extractText(Buffer.from('x'), 'old.doc'), /\.docx/);
});

test('rule-based library: sections, entries, dates, bullets with IDs', () => {
  for (const f of ['sample-resume.docx', 'sample-resume.pdf']) {
    const lib = buildLibrary(extractText(fx(f), f).text);
    assert.equal(lib.contact.name, 'Jordan Lee');
    assert.deepEqual(lib.skills[0], { label: 'Languages', items: ['Python', 'JavaScript', 'SQL'] });
    const [a, b, p, e] = lib.entries;
    assert.deepEqual([a.kind, a.heading, a.dates, a.bullets.length], ['experience', 'Software Developer, Northwind Logistics', 'Jan 2023 – Present', 3]);
    assert.equal(a.bullets[1].id, 'e1b2');
    assert.deepEqual([b.dates, b.bullets.length], ['Jun 2021 – Dec 2022', 2]);
    assert.deepEqual([p.kind, p.bullets.length], ['projects', 1]);
    assert.deepEqual([e.kind, e.dates], ['education', '2021']);
  }
  // Wrapped bullet lines join; sentences without bullet symbols still count as bullets.
  const lib = buildLibrary('Sam\nEXPERIENCE\nAnalyst, Acme 2020 – 2022\n• Built dashboards for the finance\nteam in Power BI.\nWrote weekly reports for twelve regional managers on time.');
  assert.deepEqual(lib.entries[0].bullets.map(b => b.text), ['Built dashboards for the finance team in Power BI.', 'Wrote weekly reports for twelve regional managers on time.']);
});

test('AI library: anything not in the resume word for word is flagged; JSON is pulled out of chatter', () => {
  const text = extractText(fx('sample-resume.docx'), 'x.docx').text;
  const ai = parseAiJson('Here you go:\n```json\n' + JSON.stringify({
    name: 'Jordan Lee',
    summary: 'A world-class engineer.',
    skills: [{ label: 'Languages', items: ['Python', 'Rust'] }],
    entries: [{ kind: 'experience', heading: 'Software Developer, Northwind Logistics', dates: 'Jan 2023 – Present', bullets: ['Built a Python service that cut invoice processing time by 40%.', 'Led a team of 50 engineers.'] }],
  }) + '\n```');
  const lib = checkAiLibrary(ai, text, 'claude');
  assert.equal(lib.summary, ''); // invented summary dropped
  assert.deepEqual(lib.skills[0].items, ['Python']); // invented skill dropped
  assert.deepEqual(lib.entries[0].bullets.map(b => b.flagged), [false, true]);
  assert.equal(lib.flaggedCount, 1);
  assert.throws(() => parseAiJson('sorry'), /JSON/);
});

test('roles: suggestions from the resume, and a warning for far targets', () => {
  const text = extractText(fx('sample-resume.docx'), 'x.docx').text;
  const roles = suggestRoles(text).map(r => r.title);
  assert.ok(roles.includes('Software Developer') && roles.includes('IT Support Specialist'));
  assert.equal(checkTarget(text, 'Registered Nurse').far, true);
  assert.equal(checkTarget(text, 'Software Developer').far, false);
});

test('profile answers are cleaned; pay floor and goal keep their own units', () => {
  const p = cleanProfile({ targetRoles: 'Software Developer, , Software Developer', payFloor: '$35', payFloorUnit: 'hour', payGoal: '100,000', province: 'BC', workAuth: 'bogus', startDate: 'soon', extraRoles: ['Python Developer'] });
  assert.deepEqual(p.targetRoles, ['Software Developer']);
  assert.deepEqual([p.payFloor, p.payFloorUnit, p.payGoal, p.payGoalUnit], [35, 'hour', 100000, 'year']);
  assert.equal(yearly(35, 'hour'), 72800);
  assert.deepEqual([p.workAuth, p.startDate], ['', '']);
  assert.deepEqual(searchRoles(p), ['Software Developer', 'Python Developer']);
});

test('onboarding through the app: upload, AI pass, fix a flagged line, finish sets search keywords', async () => {
  const dir = tmp();
  const fakeAsk = async () => JSON.stringify({ name: 'Jordan Lee', entries: [{ kind: 'experience', heading: 'Software Developer, Northwind Logistics', bullets: ['Built a Python service that cut invoice processing time by 40%.', 'Invented line.'] }], roles: [{ title: 'Automation Engineer', reason: 'Python service work' }] });
  const app = createApp(dir, { offline: true, log: () => {}, deps: { detect: async () => ({}), ask: fakeAsk } });
  // Pasted text is judged by what's in it, not its length: no sections is the reason given, never "a scanned picture".
  assert.throws(() => app.uploadResume({ text: 'too short' }), /No usable experience/);
  assert.throws(() => app.uploadResume({ text: '   ' }), /Paste the text/);
  const lib = app.uploadResume({ filename: 'r.docx', dataBase64: fx('sample-resume.docx').toString('base64') });
  assert.equal(lib.entries.length, 4);
  const ai = await app.resumeWithAi('claude');
  assert.equal(ai.roles[0].title, 'Automation Engineer');
  const flagged = ai.entries[0].bullets.find(b => b.flagged);
  const fixed = app.updateBullet(flagged.id, { text: 'Built internal tools.', flagged: false });
  assert.deepEqual([fixed.flagged, fixed.checkedByYou], [false, true]);
  await assert.rejects(app.resumeWithAi('gemini'), /pick/);
  app.saveProfile({ targetRoles: ['Software Developer'], extraRoles: ['Automation Engineer'], province: 'BC', remote: 'yes', done: true });
  assert.deepEqual(app.settings().keywords, ['Software Developer', 'Automation Engineer']);
  assert.equal(app.settings().province, 'BC');
});

test('a short pasted resume with real experience is accepted; a short French one too', () => {
  const app = createApp(tmp(), { offline: true, log: () => {}, deps: { detect: async () => ({}) } });
  const lib = app.uploadResume({ text: 'Sam Lee\nsam@example.com\nEXPERIENCE\nCashier, Save-On-Foods, 2023 - Present\n- Handled cash and card payments for 200 customers a day.\nEDUCATION\nBurnaby South Secondary, 2022' });
  assert.ok(lib.entries.some(e => e.kind === 'experience' && e.bullets.length === 1));
  const fr = app.uploadResume({ text: 'Julien Tremblay\nMontréal, QC\nEXPÉRIENCE\nStagiaire développeur, Desjardins, mai 2025 - août 2025\n- Corrigé des bogues dans une application Java interne.\nFORMATION\nUniversité de Montréal - Baccalauréat en informatique, 2026\nCOMPÉTENCES\nJava, SQL' });
  assert.deepEqual(fr.entries.map(e => e.kind), ['experience', 'education']);
  assert.equal(fr.entries[0].dates, 'mai 2025 - août 2025');
});

test('bullet markers people use come off the bullet text', () => {
  for (const mark of ['-', '•', '1.', 'o', '>', '✓', '■', '►', '—', '*']) {
    const lib = buildLibrary(`Kim Park\nkim@example.com\nEXPERIENCE\nData Analyst, Telus, 2022 - 2025\n${mark} Built Tableau dashboards for 12 regional managers.\n${mark} Automated weekly SQL reports.\nEDUCATION\nSFU, BA Economics, 2021`);
    assert.deepEqual(lib.entries[0].bullets.map(b => b.text), ['Built Tableau dashboards for 12 regional managers.', 'Automated weekly SQL reports.'], mark);
  }
});

test('a heading that ended with its dates and a full stop loses both', () => {
  const lib = buildLibrary('Grace Lee\ngrace@example.com\nVOLUNTEER\nSt. John Ambulance first aid volunteer at community events, 2019 - 2023.\nEXPERIENCE\nDeveloper, Łódź Systems Sp. z o.o.\n- Built a Python service.');
  assert.equal(lib.entries[0].heading, 'St. John Ambulance first aid volunteer at community events');
  assert.equal(lib.entries[0].dates, '2019 - 2023');
  assert.equal(lib.entries[1].heading, 'Developer, Łódź Systems Sp. z o.o.'); // no dates: left as written
});
