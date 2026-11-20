import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { newMatches, popupText } from '../src/helper/newjobs.mjs';
import { noticePs1, showNotice } from '../src/helper/desktop.mjs';
import { createApp, cleanSettings } from '../src/helper/main.mjs';
import { makeJob } from '../src/scan/job.mjs';

test('new matches: the first check only remembers, later checks report jobs not seen before', () => {
  const a = { id: 'a', title: 'Dev', company: 'A' }, b = { id: 'b', title: 'QA', company: 'B' };
  const first = newMatches([a], null, { now: Date.parse('2026-11-20T10:00:00Z') });
  assert.deepEqual(first.fresh, []);
  assert.equal(first.state.primed, true);
  const second = newMatches([a, b], first.state, { now: Date.parse('2026-11-20T22:00:00Z') });
  assert.deepEqual(second.fresh.map(j => j.id), ['b']);
  assert.deepEqual(newMatches([a, b], second.state).fresh, []);
  // Remembered for 30 days, then forgotten (so the file doesn't grow forever).
  const later = newMatches([], second.state, { now: Date.parse('2027-01-05T00:00:00Z') });
  assert.deepEqual(later.state.ids, {});
});

test('new matches: the pop-up names up to three jobs and fits Windows limits', () => {
  const jobs = Array.from({ length: 5 }, (_, i) => ({ id: String(i), title: `Software Developer ${i} ${'x'.repeat(120)}`, company: 'Acme' }));
  const one = popupText(jobs.slice(0, 1));
  assert.equal(one.title, '1 new job match on B3spoken');
  const five = popupText(jobs);
  assert.equal(five.title, '5 new job matches on B3spoken');
  assert.match(five.text, /and 2 more/);
  assert.ok(five.title.length <= 63 && five.text.length <= 255);
});

test('Windows pop-up: words go in a JSON file, never on the command line; other systems do nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b3-notice-'));
  try {
    assert.equal(showNotice(dir, { title: 't' }, { platform: 'linux' }), null);
    let call;
    const run = (exe, args) => { call = { exe, args }; return { on() {}, unref() {} }; };
    const evil = 'Dev" & calc & "';
    showNotice(dir, { title: '1 new job match on B3spoken', text: evil, url: 'http://127.0.0.1:4321/' }, { platform: 'win32', cmd: ['C:\\B3spoken.exe'], run, env: { SystemRoot: 'C:\\Windows' } });
    assert.match(call.exe, /wscript\.exe$/);
    const vbs = readFileSync(join(dir, 'notice.vbs'), 'utf8');
    assert.ok(!vbs.includes('calc'));
    assert.match(vbs, /notice\.ps1/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'notice.json'), 'utf8')).text, evil);
    const ps = noticePs1();
    for (const s of ['NotifyIcon', 'ShowBalloonTip', 'BalloonTipClicked', 'ConvertFrom-Json', "^http://127\\.0\\.0\\.1:\\d+/$"]) assert.ok(ps.includes(s), s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('settings: new-match pop-ups are on unless turned off', () => {
  assert.equal(cleanSettings({}).notifyNew, true);
  assert.equal(cleanSettings({ notifyNew: false }).notifyNew, false);
});

test('a refresh that brings new matches shows one pop-up; the first refresh and repeats show none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'b3-new-'));
  try {
    const fresh = new Date(Date.now() - 864e5).toISOString();
    const desc = 'Python, Flask, REST APIs, pytest, Docker, PostgreSQL and GitHub Actions.';
    const job = (n, title) => makeJob({ source: 'greenhouse', company: 'Acme', nativeId: n, title, url: `https://boards.greenhouse.io/acme/jobs/${n}`, location: 'Vancouver, BC', postedAt: fresh, description: desc });
    const putPool = jobs => {
      const gz = gzipSync(JSON.stringify({ version: 1, jobs }));
      writeFileSync(join(dir, 'pool.json.gz'), gz);
      writeFileSync(join(dir, 'pool-meta.json'), JSON.stringify({ version: 1, count: jobs.length, generatedAt: new Date().toISOString(), bytes: gz.length, sha256: createHash('sha256').update(gz).digest('hex') }));
    };
    const shown = [];
    putPool([job(1, 'Software Developer')]);
    const app = createApp(dir, { offline: true, log: () => {}, deps: { detect: async () => ({}), notify: (_d, n) => shown.push(n) } });
    app.uploadResume({ filename: 'r.docx', dataBase64: readFileSync(new URL('./fixtures/resume/sample-resume.docx', import.meta.url)).toString('base64') });
    app.saveProfile({ targetRoles: ['Software Developer'], province: 'BC', done: true });
    await app.refresh();
    assert.equal(shown.length, 0); // first check: remembers what's there
    putPool([job(1, 'Software Developer'), job(2, 'Junior Python Developer'), job(3, 'Store Associate')]);
    await app.refresh();
    assert.equal(shown.length, 1);
    assert.equal(shown[0].title, '1 new job match on B3spoken'); // the store job isn't a match
    assert.match(shown[0].text, /Junior Python Developer at Acme/);
    await app.refresh();
    assert.equal(shown.length, 1); // nothing new: no pop-up
    app.saveSettings({ notifyNew: false });
    putPool([job(1, 'Software Developer'), job(2, 'Junior Python Developer'), job(4, 'Python Developer')]);
    await app.refresh();
    assert.equal(shown.length, 1); // turned off
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
