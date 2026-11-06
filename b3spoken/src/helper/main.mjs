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
    job: id => byId.get(id) || null,
    settings: () => settings,
    saveSettings(s) { settings = cleanSettings(s); writeJson(settingsFile, settings); return settings; },
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
