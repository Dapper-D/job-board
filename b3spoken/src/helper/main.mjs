#!/usr/bin/env node
// B3spoken helper: start it, and the board opens in the browser at http://127.0.0.1:<port>/.
//   node src/helper/main.mjs [--port 4747] [--no-open] [--offline]
// On start it checks for a newer job pool (and verifies it), loads Job Bank for the last 3 days,
// and looks for ChatGPT (Codex) or Claude (Claude Code) on this computer.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { dataDir, ensureDir, readJson, writeJson } from './paths.mjs';
import { updatePool, loadPool } from './pool.mjs';
import { refreshJobBank, mergeJobs, PROVINCES } from './jobs.mjs';
import { detect, startInstall, installStatus, openSignIn, testAi } from './ai.mjs';
import { createServer } from './server.mjs';
import { extractText } from './resume/extract.mjs';
import { buildLibrary, checkAiLibrary, LIBRARY_PROMPT, parseAiJson } from './resume/library.mjs';
import { suggestRoles, checkTarget } from './roles.mjs';
import { cleanProfile, searchRoles } from './profile.mjs';
import { ask } from './ai.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { makeContext, scoreJob } from './tailor/match.mjs';
import { checkLink } from './paste.mjs';
import { buildPrep, PREP_PROMPT, cleanQuestions } from './tailor/prep.mjs';
import { cleanEntry, dueToday } from './tracker.mjs';
import { planResume, renderResume, coverLetter, renderCoverLetter, fileSafe, PICK_PROMPT } from './tailor/tailor.mjs';

const AI_CHOICES = ['auto', 'codex', 'claude', 'chrome', 'none'];
export const DEFAULT_SETTINGS = { keywords: [], province: '', remote: 'yes', ai: 'auto' };

export function cleanSettings(s = {}) {
  const keywords = (Array.isArray(s.keywords) ? s.keywords : []).map(k => String(k).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60)).filter(Boolean).slice(0, 10);
  return {
    keywords: [...new Set(keywords)],
    province: PROVINCES.includes(s.province) ? s.province : '',
    remote: ['yes', 'no', 'only'].includes(s.remote) ? s.remote : 'yes',
    ai: AI_CHOICES.includes(s.ai) ? s.ai : 'auto',
  };
}

export function createApp(dir, { offline = false, log = console.log, deps = {} } = {}) {
  ensureDir(dir);
  const settingsFile = join(dir, 'settings.json');
  let settings = cleanSettings({ ...DEFAULT_SETTINGS, ...readJson(settingsFile, {}) });
  let pool = null, jobBank = null, merged = [], byId = new Map(), ai = null;
  const state = { refreshing: false, lastRefresh: null, problems: [] };
  const pastedFile = join(dir, 'pasted.json');
  const remerge = () => { merged = mergeJobs([...(pool?.pool.jobs || []), ...readJson(pastedFile, [])], jobBank?.jobs); byId = new Map(merged.map(j => [j.id, j])); };

  async function refresh({ force = false } = {}) {
    if (state.refreshing) return { started: false, reason: 'already refreshing' };
    state.refreshing = true; state.problems = [];
    try {
      if (!offline) {
        try { await (deps.updatePool || updatePool)(dir, { log }); }
        catch (e) { state.problems.push(`Couldn't get today's job pool (${e.message}); showing the last good copy.`); }
      }
      pool = loadPool(dir);
      if (!pool) state.problems.push('No job pool on this computer yet. Check the internet connection and refresh.');
      if (!offline && !process.env.B3SPOKEN_SKIP_JOBBANK) {
        try { jobBank = await refreshJobBank(dir, settings, { force, log, fetchJobs: deps.jobBank }); }
        catch (e) { jobBank = readJson(join(dir, 'jobbank.json'), null); state.problems.push(`Couldn't reach Job Bank (${e.message}).`); }
      } else jobBank = readJson(join(dir, 'jobbank.json'), null);
      remerge();
      scoredJobs(); // score everything now, so the board opens fast
      ai = await (deps.detect || detect)();
      state.lastRefresh = new Date().toISOString();
    } finally { state.refreshing = false; }
    return { started: true };
  }

  const ob = onboarding(dir, { getSettings: () => settings, setSettings: s => { settings = cleanSettings(s); writeJson(settingsFile, settings); scored = null; }, ask: deps.ask || ask });
  // Scores for every job, worked out once and again whenever the jobs, resume or answers change.
  let scored = null, scoredKey = '';
  function scoredJobs() {
    const lib = ob.library(), prof = ob.profile();
    const key = `${merged.length}|${pool?.meta.sha256}|${JSON.stringify(prof)}|${lib?.entries?.length}|${lib?.source}`;
    if (scored && key === scoredKey) return scored;
    if (!lib?.entries || !prof.done) { scored = merged; scoredKey = key; return scored; }
    const ctx = makeContext(lib, existsSync(join(dir, 'resume.txt')) ? readFileSync(join(dir, 'resume.txt'), 'utf8') : '', prof, settings.keywords);
    scored = merged.map(j => ({ ...j, match: scoreJob(j, ctx) }));
    scoredKey = key;
    return scored;
  }

  // One job's tailored resume and cover letter, saved under documents/ on this computer.
  async function makeDocuments(id) {
    const job = byId.get(id); if (!job) throw err(404, 'no such job');
    const lib = ob.library(), prof = ob.profile();
    if (!lib?.entries) throw err(409, 'finish setup first: upload your resume');
    const match = scoredJobs().find(j => j.id === id)?.match || null;
    let order = [], picker = 'rules';
    if (['codex', 'claude'].includes(settings.ai)) {
      try {
        const known = new Set(lib.entries.flatMap(e => e.bullets.filter(b => !b.flagged).map(b => b.id)));
        order = (parseAiJson(await (deps.ask || ask)(settings.ai, PICK_PROMPT(job, lib))).order || []).filter(x => known.has(x));
        if (order.length) picker = settings.ai;
      } catch { order = []; }
    }
    const plan = planResume(lib, job, { order });
    const letter = coverLetter(plan, job, match, prof);
    const folder = join(dir, 'documents', fileSafe(`${job.company} - ${plan.headline}`) || fileSafe(id));
    mkdirSync(folder, { recursive: true });
    const base = `${fileSafe(plan.name) || 'Resume'}`;
    const files = { resume: `${base} - Resume - ${fileSafe(job.company)} - ${fileSafe(plan.headline)}.pdf`, letter: `${base} - Cover Letter - ${fileSafe(job.company)} - ${fileSafe(plan.headline)}.pdf` };
    writeFileSync(join(folder, files.resume), renderResume(plan));
    writeFileSync(join(folder, files.letter), renderCoverLetter(plan, letter));
    const made = { jobId: id, folder, files, picker, createdAt: new Date().toISOString(), match, letter: letter.paragraphs };
    const index = readJson(join(dir, 'documents', 'index.json'), {});
    index[id] = made; writeJson(join(dir, 'documents', 'index.json'), index);
    return made;
  }
  function documentFile(id, kind) {
    const made = readJson(join(dir, 'documents', 'index.json'), {})[id];
    if (!made || !made.files[kind]) throw err(404, 'make the documents first');
    return { name: made.files[kind], bytes: readFileSync(join(made.folder, made.files[kind])) };
  }

  // Tracker
  const trackerFile = join(dir, 'tracker.json');
  const tracker = () => readJson(trackerFile, {});
  function track(id, entry) {
    if (!byId.has(id) && !tracker()[id]) throw err(404, 'no such job');
    const all = tracker();
    const next = cleanEntry(entry, all[id]);
    if (!next.status && !next.notes && !next.followUp) delete all[id]; else all[id] = { ...next, title: byId.get(id)?.title || all[id]?.title, company: byId.get(id)?.company || all[id]?.company };
    writeJson(trackerFile, all);
    return all[id] || {};
  }
  // Paste a link
  async function paste(url) {
    const { job, how } = await (deps.checkLink || checkLink)(url, { jobs: merged });
    if (!byId.has(job.id)) {
      const list = readJson(pastedFile, []).filter(j => j.id !== job.id);
      list.unshift({ ...job, description: String(job.description || '').slice(0, 20000) });
      writeJson(pastedFile, list.slice(0, 200));
      remerge(); scored = null;
    }
    return { id: job.id, how, job: (scoredJobs().find(j => j.id === job.id)) || job };
  }

  // Interview prep: questions for this job, answered with the person's own resume lines. AI questions are kept.
  async function prep(id, { useAi = true } = {}) {
    const job = byId.get(id); if (!job) throw err(404, 'no such job');
    const lib = ob.library(); if (!lib?.entries) throw err(409, 'finish setup first: upload your resume');
    const cacheFile = join(dir, 'prep.json');
    const cache = readJson(cacheFile, {});
    let extra = cache[id]?.questions || [];
    if (!extra.length && useAi && ['codex', 'claude'].includes(settings.ai)) {
      try { extra = cleanQuestions(parseAiJson(await (deps.ask || ask)(settings.ai, PREP_PROMPT(job, lib)))); cache[id] = { questions: extra, at: new Date().toISOString() }; writeJson(cacheFile, cache); }
      catch { extra = []; }
    }
    return buildPrep(lib, job, scoredJobs().find(j => j.id === id)?.match || null, ob.profile(), { extraQuestions: extra });
  }

  return {
    refresh, makeDocuments, documentFile, paste, prep,
    // One-click AI setup
    aiInstall: provider => { if (!['codex', 'claude'].includes(provider)) throw err(400, 'unknown AI'); return (deps.startInstall || startInstall)(provider); },
    aiInstallStatus: () => installStatus(),
    aiSignIn: provider => { if (!['codex', 'claude'].includes(provider)) throw err(400, 'unknown AI'); try { return (deps.openSignIn || openSignIn)(provider); } catch (e) { throw err(409, e.message); } },
    aiTest: async provider => { if (!['codex', 'claude'].includes(provider)) throw err(400, 'unknown AI'); const r = await testAi(provider, deps.ask || ask); ai = await (deps.detect || detect)(); return r; },
    aiDetect: async () => (ai = await (deps.detect || detect)()),
    tracker, track, dueCount: () => Object.values(tracker()).filter(e => dueToday(e)).length,
    documentIndex: () => Object.fromEntries(Object.entries(readJson(join(dir, 'documents', 'index.json'), {})).map(([id, d]) => [id, d.files])),
    documents: id => readJson(join(dir, 'documents', 'index.json'), {})[id] || null,
    status: async () => ({
      version: '0.1.2', ...state, settings,
      pool: pool ? { count: pool.meta.count, generatedAt: pool.meta.generatedAt, sha256: pool.meta.sha256 } : null,
      jobBank: jobBank ? { count: jobBank.jobs.length, fetchedAt: new Date(jobBank.fetchedAt).toISOString() } : null,
      jobs: merged.length, ai,
    }),
    jobs: () => { const t = tracker(); return scoredJobs().map(j => (t[j.id] ? { ...j, track: t[j.id] } : j)); },
    ...ob,
    job: id => { const j = byId.get(id); return j ? { ...j, match: scoredJobs().find(x => x.id === id)?.match || null } : null; },
    settings: () => settings,
    saveSettings(s) { settings = cleanSettings(s); writeJson(settingsFile, settings); scored = null; return settings; },
  };
}

const err = (status, message) => Object.assign(new Error(message), { status });

// Resume upload, the resume library, role checks and the onboarding answers.
export function onboarding(dir, { getSettings, setSettings, ask }) {
  const resumeFile = join(dir, 'resume.txt'), libFile = join(dir, 'library.json'), profileFile = join(dir, 'profile.json');
  const resumeText = () => (existsSync(resumeFile) ? readFileSync(resumeFile, 'utf8') : '');
  return {
    uploadResume({ filename = '', dataBase64, text } = {}) {
      let got;
      try { got = text != null ? extractText(Buffer.from(String(text).slice(0, 200_000), 'utf8'), 'pasted.txt') : extractText(Buffer.from(String(dataBase64 || ''), 'base64'), String(filename)); }
      catch (e) { throw err(400, `Couldn't read that file: ${e.message}`); }
      if (!got.readable) throw err(422, 'Very little text came out of that file (it may be a scanned picture). Upload the Word version or paste the text instead.');
      writeFileSync(resumeFile, got.text, { mode: 0o600 });
      const lib = buildLibrary(got.text);
      lib.roles = suggestRoles(got.text);
      writeJson(libFile, lib);
      return lib;
    },
    async resumeWithAi(provider) {
      if (!['codex', 'claude'].includes(provider)) throw err(400, 'pick ChatGPT (Codex) or Claude (Claude Code)');
      const text = resumeText(); if (!text) throw err(409, 'upload a resume first');
      let ai;
      try { ai = parseAiJson(await ask(provider, LIBRARY_PROMPT(text))); }
      catch (e) { throw err(502, `The AI couldn't read the resume: ${e.message}`); }
      const lib = checkAiLibrary(ai, text, provider);
      const rules = buildLibrary(text); // contact lines and summary come from the resume itself
      lib.contact = { name: lib.contact.name || rules.contact.name, lines: rules.contact.lines };
      if (!lib.summary) lib.summary = rules.summary;
      const ruleRoles = suggestRoles(text);
      const aiRoles = (Array.isArray(ai.roles) ? ai.roles : []).slice(0, 8).map(r => ({ title: String(r?.title || '').slice(0, 80), reason: String(r?.reason || '').slice(0, 160), fromAi: true })).filter(r => r.title);
      lib.roles = [...aiRoles, ...ruleRoles.filter(r => !aiRoles.some(a => a.title.toLowerCase() === r.title.toLowerCase()))].slice(0, 10);
      if (!lib.entries.length) throw err(502, 'The AI returned an empty resume; the rule-based version is kept.');
      writeJson(libFile, lib);
      return lib;
    },
    library: () => readJson(libFile, null),
    // The person checks a flagged line: confirm it, or change the words themselves.
    updateBullet(id, { text, flagged } = {}) {
      const lib = readJson(libFile, null); if (!lib) throw err(409, 'upload a resume first');
      const b = lib.entries.flatMap(e => e.bullets).find(x => x.id === id); if (!b) throw err(404, 'no such line');
      if (text != null) b.text = String(text).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 400);
      if (flagged === false) { b.flagged = false; b.checkedByYou = true; }
      if (flagged === true) b.flagged = true;
      writeJson(libFile, lib);
      return b;
    },
    checkRole: target => checkTarget(resumeText(), String(target || '').slice(0, 80)),
    profile: () => cleanProfile(readJson(profileFile, {})),
    saveProfile(p) {
      const prof = cleanProfile(p);
      writeJson(profileFile, prof);
      if (prof.done) setSettings({ ...getSettings(), keywords: searchRoles(prof), province: prof.province, remote: prof.remote });
      return prof;
    },
  };
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {}
}

// Starts the helper. If one is already running on this computer, just opens the board again.
export async function start(argv = process.argv.slice(2)) {
  const flag = n => argv.includes(n);
  const portArg = Number(argv[argv.indexOf('--port') + 1]) || 4747;
  const dir = ensureDir(dataDir());
  const running = readJson(join(dir, 'helper.json'), null);
  if (running?.port && !flag('--new')) {
    try {
      const r = await fetch(`http://127.0.0.1:${running.port}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok && (await r.json()).app === 'b3spoken') {
        const url = `http://127.0.0.1:${running.port}/`;
        console.log(`B3spoken is already running at ${url}`);
        if (!flag('--no-open')) openBrowser(url);
        return null;
      }
    } catch {}
  }
  const app = createApp(dir, { offline: flag('--offline') });
  const srv = createServer(app);
  const port = await srv.listen(portArg);
  writeJson(join(dir, 'helper.json'), { port, pid: process.pid, startedAt: new Date().toISOString() });
  const url = `http://127.0.0.1:${port}/`;
  console.log(`B3spoken is running at ${url}\nYour files are in ${dir}\nKeep this window open while you use B3spoken. Close it (or press Ctrl+C) to stop.`);
  if (!flag('--no-open')) openBrowser(url);
  app.refresh().catch(e => console.error('refresh failed:', e.message));
  process.on('SIGINT', () => srv.close().then(() => process.exit(0)));
  return srv;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) start().catch(e => { console.error(`B3spoken couldn't start: ${e.message}`); process.exitCode = 1; });
