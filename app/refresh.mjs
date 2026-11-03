#!/usr/bin/env node
// Daily refresh. Run by Task Scheduler, or by "Refresh now" on the board.
//   1. career-ops scan (free, no AI)            -> new links in career-ops/data/pipeline.md
//   2. your queue + new scan links               -> open each posting, AI scores it, verified jobs go on the board
//   3. re-check jobs already on the board        -> closed ones are marked or retired
//   4. tailored resume + cover letter for Apply/Stretch jobs (AI picks your real resume lines; PDFs go to documents/)
//   5. up to 3 research requests (web search)
// Flags: --no-scan  --log <file>  --max <n>
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { CAREER_OPS, DATA, KIT, LIB_FILE } from './lib/paths.mjs';
import { loadConfig } from './lib/config.mjs';
import * as store from './lib/store.mjs';
import { fetchPosting, ruleSignals, classifyHost, normUrl } from './lib/fetchjob.mjs';
import { evaluatePosting, research, tailorFor } from './lib/evaluate.mjs';
import { makeDocs } from './lib/docs.mjs';

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const val = n => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
const logFile = val('--log');
const log = (...a) => { const line = new Date().toISOString().slice(11, 19) + ' ' + a.join(' '); console.log(line); if (logFile) { mkdirSync(dirname(logFile), { recursive: true }); appendFileSync(logFile, line + '\n'); } };
const today = () => new Date().toLocaleDateString('en-CA');
const SENT = new Set(['Applied', 'Viewed', 'Interview', 'Offer']);

const LOCK = join(DATA, 'refresh.lock');
function lock() {
  mkdirSync(DATA, { recursive: true });
  if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs < 3 * 3600e3) { log('Another refresh is running. Exiting.'); process.exit(0); }
  writeFileSync(LOCK, String(process.pid));
}
const unlock = () => { try { unlinkSync(LOCK); } catch {} };

const slug = (co, ti, url) => (String(co) + '-' + String(ti)).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)
  + '-' + createHash('sha1').update(normUrl(url)).digest('hex').slice(0, 6);
const keyCT = (co, ti) => (String(co) + '|' + String(ti)).toLowerCase().replace(/[^a-z0-9|]/g, '');

function runScan() {
  if (!existsSync(join(CAREER_OPS, 'scan.mjs'))) { log('career-ops not found, skipping scan.'); return 'not installed'; }
  log('career-ops scan...');
  const r = spawnSync(process.execPath, ['scan.mjs', '--quiet'], { cwd: CAREER_OPS, encoding: 'utf8', timeout: 45 * 60e3, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (logFile) appendFileSync(logFile, (r.stdout || '').slice(-4000) + (r.stderr || '').slice(-2000) + '\n');
  const portals = existsSync(join(CAREER_OPS, 'portals.yml')) ? readFileSync(join(CAREER_OPS, 'portals.yml'), 'utf8') : '';
  if (/^dayforce_boards:\s*$/m.test(portals)) spawnSync(process.execPath, ['scan-dayforce.mjs'], { cwd: CAREER_OPS, timeout: 20 * 60e3, windowsHide: true });
  return r.status === 0 ? 'ok' : 'exit ' + r.status;
}

function pipelineItems() {
  const f = join(CAREER_OPS, 'data', 'pipeline.md');
  if (!existsSync(f)) return [];
  const out = [];
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^- \[ \] (https?:\/\/\S+)(.*)$/); if (!m) continue;
    const parts = m[2].split('|').map(s => s.trim()).filter(Boolean).filter(p => !/^(posted|note):/i.test(p));
    out.push({ url: m[1], company: parts[0] || '', title: parts[1] || '', location: parts[2] || '' });
  }
  return out;
}

async function main() {
  lock();
  const cfg = loadConfig();
  const t0 = Date.now();
  const L = { searched: 0, candidates: 0, added: 0, closed: 0, queue: 0, requests: 0, tailored: 0, documents: 0, dropped: {} };
  const lib = store.readJson(LIB_FILE, null);
  const libTime = existsSync(LIB_FILE) ? statSync(LIB_FILE).mtimeMs : 0;
  let aiDown = false;
  const texts = {}; // posting text from this run, for tailoring
  const drop = r => { L.dropped[r] = (L.dropped[r] || 0) + 1; };
  const sources = { searched: [], unreachable: [] };
  const meta = store.getMeta();
  meta.removed = meta.removed || [];
  const jobs = store.getJobs();
  const stories = store.getStories();
  const tracker = store.getUser('tracker') || {};
  const seen = store.readJson(join(DATA, 'seen.json'), {});
  const byUrl = new Map(), byCT = new Map();
  for (const [id, j] of Object.entries(jobs)) { [j.applyUrl, j.verifiedUrl].filter(Boolean).forEach(u => byUrl.set(normUrl(u), id)); byCT.set(keyCT(j.company, j.title), id); }
  const skipCT = new Set(Object.entries(tracker).filter(([, s]) => s === 'Rejected' || s === 'Not interested').map(([id]) => jobs[id] && keyCT(jobs[id].company, jobs[id].title)).filter(Boolean));
  const blocked = Object.values((store.getUser('prefs') || {}).blocked || {}).filter(Boolean).map(n => String(n).toLowerCase().replace(/[^a-z0-9]/g, ''));
  const isBlocked = co => blocked.includes(String(co).toLowerCase().replace(/[^a-z0-9]/g, ''));
  const save = () => store.putJobs(jobs);

  // 1. scan
  if (!flag('--no-scan')) { const s = runScan(); (s === 'ok' ? sources.searched : sources.unreachable).push('career-ops scan' + (s === 'ok' ? '' : ' (' + s + ')')); }

  // 2. candidates
  const queue = store.getUser('queue') || {};
  const qItems = Object.entries(queue).filter(([, v]) => v && typeof v === 'object' && v.state === 'pending')
    .sort((a, b) => String(a[1].added || '').localeCompare(String(b[1].added || ''))).slice(0, cfg.ai.maxQueuePerRun);
  const maxScan = Number(val('--max')) || cfg.ai.maxEvalPerRun;
  const pItems = pipelineItems().filter(p => !seen[normUrl(p.url)] && !byUrl.has(normUrl(p.url))).slice(0, maxScan);
  const cands = [...qItems.map(([k, v]) => ({ url: v.url, note: v.note, qkey: k, source: 'your queue' })), ...pItems.map(p => ({ ...p, source: 'career-ops scan' }))];
  L.candidates = cands.length;
  log(`${qItems.length} queued links, ${pItems.length} new scan links to check.`);
  const qPatch = {};
  const qDone = (c, patch) => { if (c.qkey) { qPatch[c.qkey] = { ...queue[c.qkey], ...patch, checked: today() }; L.queue++; } else seen[normUrl(c.url)] = { at: today(), result: patch.result || patch.state }; };

  for (const c of cands) {
    const dupId = byUrl.get(normUrl(c.url));
    if (dupId) { qDone(c, { state: 'added', jobId: dupId, result: 'Already on your board' }); continue; }
    if (!c.qkey && c.company && c.title && (byCT.has(keyCT(c.company, c.title)) || skipCT.has(keyCT(c.company, c.title)))) { qDone(c, { state: 'skipped', result: 'duplicate' }); drop('duplicate'); continue; }
    if (!c.qkey && isBlocked(c.company)) { qDone(c, { state: 'skipped', result: 'hidden company' }); drop('hidden company'); continue; }
    log('Checking', c.url);
    const p = await fetchPosting(c.url);
    if (!p.ok) { qDone(c, { state: 'failed', result: 'Couldn’t open it: ' + p.reason }); drop('could not open'); continue; }
    if (p.closed) { qDone(c, { state: 'skipped', result: 'Closed: ' + p.closedReason }); drop('closed'); continue; }
    if (p.thin) { qDone(c, { state: 'failed', result: 'The page had no readable job text (it may need a browser). Try the employer’s own posting link.' }); drop('no readable text'); continue; }
    p.title = p.title || c.title; p.company = p.company || c.company; p.location = p.location || c.location;
    let ev;
    try { ev = await evaluatePosting(cfg, p, { url: p.finalUrl, source: c.source, stories }); }
    catch (e) {
      log('AI error:', e.code || '', e.message);
      if (e.code === 'not_logged_in' || e.code === 'rate_limited' || e.code === 'not_installed') { sources.unreachable.push('AI (' + e.message + ')'); aiDown = true; break; }
      qDone(c, { state: 'failed', result: 'The AI couldn’t score it. It will be retried next time.' }); if (!c.qkey) delete seen[normUrl(c.url)]; continue;
    }
    if (!ev.isJobPosting) { qDone(c, { state: 'skipped', result: 'Not a single job posting' }); drop('not a posting'); continue; }
    const fromQueue = !!c.qkey;
    if (!ev.eligible && !fromQueue) { qDone(c, { state: 'skipped', result: ev.ineligibleReason }); drop(ev.region === 'Ineligible' ? 'location or eligibility' : 'ineligible'); continue; }
    if (cfg.floor && ev.salaryMaxAnnual > 0 && ev.salaryMaxAnnual < cfg.floor && !fromQueue) { qDone(c, { state: 'skipped', result: 'Below pay floor' }); drop('below pay floor'); continue; }
    const signals = [...ruleSignals(p, p.finalUrl), ...(ev.legit.signals || [])];
    const suspicious = ev.legit.tier === 'Suspicious' || signals.filter(s => s.w === 'Concerning').length >= 3;
    if (suspicious && !fromQueue) { qDone(c, { state: 'skipped', result: 'Looked suspicious' }); drop('suspicious'); continue; }
    if (isBlocked(ev.company) && !fromQueue) { qDone(c, { state: 'skipped', result: 'hidden company' }); drop('hidden company'); continue; }
    const ct = keyCT(ev.company, ev.title);
    if (byCT.has(ct)) { qDone(c, { state: 'added', jobId: byCT.get(ct), result: 'Already on your board' }); continue; }
    if (skipCT.has(ct) && !fromQueue) { qDone(c, { state: 'skipped', result: 'You marked this one Rejected or Not interested' }); continue; }
    const host = classifyHost(p.finalUrl, ev.company);
    const verify = host === 'ats' || host === 'employer' ? 'employer' : 'listing';
    const overall = Math.max(0, Math.min(10, Math.round(ev.overall - (verify === 'listing' ? 1 : 0))));
    const rec = overall >= 6 ? ev.rec : overall >= 4 ? (ev.rec === 'Skip' ? 'Skip' : 'Stretch') : 'Skip';
    // Skip calls (missing too many must-haves) never go on the board; the queue entry says why.
    if (rec === 'Skip') { qDone(c, { state: 'skipped', result: 'Poor fit: ' + (ev.verdict || ev.why || 'missing too many requirements').replace(/^Skip\.\s*/, '') }); drop('poor fit (Skip)'); continue; }
    const id = slug(ev.company, ev.title, p.finalUrl);
    const seenSig = new Set();
    jobs[id] = {
      company: ev.company, title: ev.title, location: ev.location || p.location, mode: ev.mode, region: ev.eligible ? ev.region : 'Ineligible',
      salary: ev.salary || p.salary || 'Salary not posted', salaryMax: Math.round(ev.salaryMaxAnnual || 0), posted: ev.posted || p.posted || '',
      ...(ev.closes || p.closes ? { closes: ev.closes || p.closes } : {}),
      firstSeen: today(), checked: today(), verify, verifiedUrl: p.finalUrl, applyUrl: p.finalUrl, sourceName: c.source,
      tracks: ev.tracks, tech: Math.round(ev.tech), overall, rec, why: ev.why, verdict: ev.verdict, req: ev.req, keywords: ev.keywords,
      blockers: ev.blockers, projects: ev.projects,
      legit: { tier: suspicious ? 'Suspicious' : ev.legit.tier, signals: signals.filter(s => !seenSig.has(s.s) && seenSig.add(s.s)).slice(0, 10), notes: ev.legit.notes,
        ...(ev.aiTrap && ev.aiTrap.found ? { trap: ev.aiTrap.instruction || (p.hidden || [])[0] || 'Instructions aimed at AI tools', trapPhrases: (ev.aiTrap.phrases || []).map(x => String(x).toLowerCase()).slice(0, 10) } : {}) },
      ...(ev.noAIPolicy ? { tailor: { noAI: true, at: today() } } : {}),
      risks: ev.risks, answers: rec === 'Skip' ? [] : ev.answers, stories: ev.stories.filter(s => stories[s.id]), active: true,
    };
    texts[id] = p.text;
    byUrl.set(normUrl(p.finalUrl), id); byUrl.set(normUrl(c.url), id); byCT.set(ct, id);
    L.added++; save();
    qDone(c, { state: 'added', jobId: id, result: `Added: ${rec}, overall ${overall}/10` });
    log('Added', ev.company, '-', ev.title, rec, overall);
  }
  if (Object.keys(qPatch).length) store.putUser('queue', store.merge(store.getUser('queue') || {}, qPatch));
  store.writeJsonAtomic(join(DATA, 'seen.json'), seen);

  // 3. re-check
  log('Re-checking jobs on the board...');
  for (const [id, j] of Object.entries(jobs)) {
    if (j.active === false || j.closed || j.checked === today()) continue;
    const st = tracker[id] || 'Not started';
    const close = reason => {
      if (SENT.has(st)) { j.closed = true; j.closedReason = reason; j.closedOn = today(); }
      else { j.active = false; meta.removed.unshift(`${j.company} - ${j.title} (${reason}, ${today()})`); }
      L.closed++;
    };
    const p = await fetchPosting(j.verifiedUrl || j.applyUrl);
    if (p.ok && p.closed) close(p.closedReason || 'closed');
    else if (p.ok) j.checked = today();
    else {
      const age = Math.round((Date.now() - new Date((j.firstSeen || j.checked) + 'T12:00:00').getTime()) / 86400000);
      if (age > 45) close("couldn't confirm it's still open after 45 days");
    }
  }
  meta.removed = meta.removed.slice(0, 30);
  save();

  // 4. tailored resume + cover letter
  if (lib) {
    const want = Object.entries(jobs).filter(([id, j]) => j.active !== false && !j.closed && (j.rec === 'Apply' || j.rec === 'Stretch') && !(tracker[id] && ['Applied', 'Viewed', 'Interview', 'Offer', 'Rejected', 'Not interested'].includes(tracker[id])));
    let budget = cfg.ai.maxTailorPerRun;
    for (const [id, j] of want) {
      if (aiDown) break;
      // Tailor once per job; again only if the resume library was rebuilt since (its line ids may have changed).
      if ((j.tailor && (j.tailor.noAI || j.tailor.libAt === libTime || !j.tailor.libAt)) || budget <= 0) continue;
      budget--;
      let text = texts[id];
      if (!text) { const p = await fetchPosting(j.verifiedUrl || j.applyUrl); if (!p.ok || p.closed) continue; text = p.text; }
      try { j.tailor = { ...(await tailorFor(cfg, lib, j, text)), at: today(), libAt: libTime }; L.tailored++; save(); log('Tailored', j.company, '-', j.title); }
      catch (e) { log('Tailoring error:', e.message); if (['not_logged_in', 'rate_limited', 'not_installed'].includes(e.code)) aiDown = true; }
    }
    // PDFs: made for every tailored open job, and remade when the resume library changes. No AI used.
    for (const [id, j] of want) {
      if (!j.tailor || j.tailor.noAI) continue;
      if (j.docs && j.docs.made && new Date(j.docs.made).getTime() > libTime && j.docs.tailorAt === j.tailor.at) continue;
      try {
        const r = await makeDocs(lib, j);
        if (r.skipped) { j.docs = { skipped: r.skipped, made: new Date().toISOString(), tailorAt: j.tailor.at }; continue; }
        j.docs = { resume: relative(KIT, r.resume), cover: r.cover ? relative(KIT, r.cover) : '', made: new Date().toISOString(), tailorAt: j.tailor.at, pages: r.pages };
        L.documents++;
      } catch (e) { log('PDF error for', j.company, '-', e.message); }
    }
    save();
  } else log('No resume library yet (data/resume-lib.json), so no tailored resumes. Run "node onboard.mjs" in the app folder.');

  // 5. research requests
  const requests = store.getUser('requests') || {};
  const pend = Object.entries(requests).filter(([, r]) => r && r.state === 'pending').sort((a, b) => String(a[1].requested || '').localeCompare(String(b[1].requested || ''))).slice(0, 3);
  const rPatch = {};
  for (const [jobId, r] of pend) {
    const j = jobs[jobId];
    if (!j) { rPatch[jobId] = { state: 'failed', result: 'The job is gone' }; continue; }
    try {
      for (const kind of r.kinds || []) {
        if (kind === 'company') j.research = { ...(await research(cfg, j, 'company')), at: today() };
        if (kind === 'contacts') j.outreach = { ...(await research(cfg, j, 'contacts')), at: today() };
      }
      rPatch[jobId] = { state: 'done', done: today() }; L.requests++; save();
    } catch (e) { log('Research error:', e.message); if (['not_logged_in', 'rate_limited', 'not_installed'].includes(e.code)) break; rPatch[jobId] = { state: 'failed', result: 'Research failed: ' + e.message.slice(0, 120) }; }
  }
  if (Object.keys(rPatch).length) store.putUser('requests', store.merge(store.getUser('requests') || {}, rPatch));

  try { const u = await (await import('./lib/update.mjs')).check(); if (u.available) log('Update available: version ' + u.latest + ' (you have ' + u.current + '). Click Update on the board.'); } catch {}
  meta.lastRun = today();
  meta.sources = sources;
  meta.log = L;
  store.putMeta(meta);
  log(`Done in ${Math.round((Date.now() - t0) / 1000)}s: ${L.added} added, ${L.closed} closed, ${L.queue} queue links, ${L.tailored} tailored, ${L.documents} PDFs made, ${L.requests} research.`);
}

main().catch(e => { log('Refresh failed:', e.stack || e.message); process.exitCode = 1; }).finally(unlock);
