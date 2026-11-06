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
import { detect } from './ai.mjs';
import { createServer } from './server.mjs';
import { extractText } from './resume/extract.mjs';
import { buildLibrary, checkAiLibrary, LIBRARY_PROMPT, parseAiJson } from './resume/library.mjs';
import { suggestRoles, checkTarget } from './roles.mjs';
import { cleanProfile, searchRoles } from './profile.mjs';
import { ask } from './ai.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

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
  const remerge = () => { merged = mergeJobs(pool?.pool.jobs, jobBank?.jobs); byId = new Map(merged.map(j => [j.id, j])); };

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
      ai = await (deps.detect || detect)();
      state.lastRefresh = new Date().toISOString();
    } finally { state.refreshing = false; }
    return { started: true };
  }

  return {
    refresh,
    status: async () => ({
      version: '0.1.0', ...state, settings,
      pool: pool ? { count: pool.meta.count, generatedAt: pool.meta.generatedAt, sha256: pool.meta.sha256 } : null,
      jobBank: jobBank ? { count: jobBank.jobs.length, fetchedAt: new Date(jobBank.fetchedAt).toISOString() } : null,
      jobs: merged.length, ai,
    }),
    jobs: () => merged,
    ...onboarding(dir, { getSettings: () => settings, setSettings: s => { settings = cleanSettings(s); writeJson(settingsFile, settings); }, ask: deps.ask || ask }),
    job: id => byId.get(id) || null,
    settings: () => settings,
    saveSettings(s) { settings = cleanSettings(s); writeJson(settingsFile, settings); return settings; },
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const flag = n => args.includes(n);
  const portArg = Number(args[args.indexOf('--port') + 1]) || 4747;
  const dir = dataDir();
  const app = createApp(dir, { offline: flag('--offline') });
  const srv = createServer(app);
  const port = await srv.listen(portArg);
  const url = `http://127.0.0.1:${port}/`;
  console.log(`B3spoken is running at ${url}\nYour files are in ${dir}\nPress Ctrl+C to stop.`);
  if (!flag('--no-open')) openBrowser(url);
  app.refresh().catch(e => console.error('refresh failed:', e.message));
  process.on('SIGINT', () => srv.close().then(() => process.exit(0)));
}
