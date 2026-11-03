// One function for every AI call: ask(prompt, {schema, search}).
// Providers (chosen in setup, stored in config.json -> ai.provider):
//   codex   - OpenAI Codex CLI, signed in with ChatGPT (uses the ChatGPT plan's Codex allowance)
//   claude  - Claude Code CLI, signed in with a Claude plan (Pro/Max)
//   gemini  - Gemini CLI, signed in with a Google account (free tier available)
//   mock    - canned answers, for tests only
// The CLIs are installed into the kit's own tools/ folder by setup (no admin rights needed);
// a copy already on PATH is used as a fallback. All of them share the sign-in stored in your home folder.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { loadConfig } from './config.mjs';
import { KIT } from './paths.mjs';

export class AiError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }
const isWin = process.platform === 'win32';
const TOOLS = join(KIT, 'tools', 'node_modules');

export const PROVIDERS = {
  codex: { label: 'Codex (ChatGPT sign-in)', pkg: '@openai/codex', bin: 'codex', entry: ['@openai', 'codex', 'bin', 'codex.js'], node: true,
    login: ['login'], loginHelp: 'A browser window opens: sign in with your ChatGPT account.', plan: 'ChatGPT Plus/Pro' },
  claude: { label: 'Claude Code (Claude sign-in)', pkg: '@anthropic-ai/claude-code', bin: 'claude', entry: ['@anthropic-ai', 'claude-code', 'bin', 'claude.exe'], node: false,
    login: ['auth', 'login'], loginHelp: 'A browser window opens: sign in with your Claude account (Pro or Max).', plan: 'Claude Pro/Max' },
  gemini: { label: 'Gemini CLI (Google sign-in)', pkg: '@google/gemini-cli', bin: 'gemini', entry: ['@google', 'gemini-cli', 'bundle', 'gemini.js'], node: true,
    login: [], loginHelp: 'Gemini opens in this window. Choose "Sign in with Google", finish in the browser, then type /quit and press Enter.', plan: 'a Google account' },
};

// How to start a provider's CLI without going through a shell (shell quoting breaks on Windows paths with spaces).
export function cliCommand(provider, args) {
  const p = PROVIDERS[provider];
  const env = process.env[provider.toUpperCase() + '_BIN'];
  if (env) return { cmd: env, args, shell: false };
  const local = join(TOOLS, ...p.entry);
  if (existsSync(local)) return p.node ? { cmd: process.execPath, args: [local, ...args], shell: false } : { cmd: local, args, shell: false };
  if (isWin) return { cmd: p.bin + '.cmd', args: args.map(a => a === '' ? '""' : /[\s"&|<>^]/.test(a) ? '"' + a.replace(/"/g, '""') + '"' : a), shell: true };
  return { cmd: p.bin, args, shell: false };
}

function run(provider, args, { input, cwd, timeoutSec, env }) {
  return new Promise((resolve, reject) => {
    const c = cliCommand(provider, args);
    let child;
    try { child = spawn(c.cmd, c.args, { cwd, shell: c.shell, windowsHide: true, env: { ...process.env, ...(env || {}) } }); }
    catch { return reject(new AiError('not_installed', PROVIDERS[provider].label + ' is not installed. Run setup again.')); }
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); }, (timeoutSec || 240) * 1000);
    child.stdout.on('data', d => { out += d; if (out.length > 4e6) out = out.slice(-4e6); });
    child.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    child.on('error', e => { clearTimeout(timer); reject(new AiError(e.code === 'ENOENT' ? 'not_installed' : 'ai_failed', e.code === 'ENOENT' ? PROVIDERS[provider].label + ' is not installed. Run setup again.' : e.message)); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

function classify(provider, text) {
  const name = PROVIDERS[provider].label;
  if (/not logged in|log ?in|sign ?in|unauthori[sz]ed|401|auth(entication)? (failed|required)|credentials/i.test(text)) return new AiError('not_logged_in', name + ' is not signed in. Run setup again, or see the README for the sign-in command.');
  if (/usage limit|rate.?limit|429|quota|resource.?exhausted|too many requests/i.test(text)) return new AiError('rate_limited', 'You have hit your ' + name + ' usage limit for now. Try again later.');
  return null;
}

// Find the first complete JSON object in a model answer (code fences and chatter around it are ignored).
export function extractJson(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  for (let i = s.indexOf('{'); i !== -1; i = s.indexOf('{', i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { try { return JSON.parse(s.slice(i, j + 1)); } catch { break; } }
    }
  }
  throw new AiError('bad_json', 'The AI answer was not valid JSON.');
}
// Checks required keys (recursively) so a half-answer is retried instead of breaking the board.
export function fitsSchema(v, schema) {
  if (!schema) return true;
  if (schema.type === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    return (schema.required || []).every(k => k in v && fitsSchema(v[k], (schema.properties || {})[k]));
  }
  if (schema.type === 'array') return Array.isArray(v) && v.every(x => fitsSchema(x, schema.items));
  if (schema.type === 'string') return typeof v === 'string' && (!schema.enum || schema.enum.includes(v));
  if (schema.type === 'number') return typeof v === 'number' && isFinite(v);
  if (schema.type === 'boolean') return typeof v === 'boolean';
  return true;
}
const schemaNote = schema => '\n\nReturn ONLY one JSON object, no other text, matching this JSON Schema exactly (every listed key present):\n' + JSON.stringify(schema);

async function runCodex(prompt, { schema, search, timeoutSec, model }) {
  const dir = mkdtempSync(join(tmpdir(), 'jhk-'));
  try {
    const out = join(dir, 'last.txt');
    const args = [];
    if (search) args.push('--search');
    args.push('exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '--color', 'never', '-C', dir, '-o', out);
    if (model) args.push('-m', model);
    if (schema) { const sf = join(dir, 'schema.json'); writeFileSync(sf, JSON.stringify(schema)); args.push('--output-schema', sf); }
    args.push('-'); // prompt on stdin
    const r = await run('codex', args, { input: prompt, cwd: dir, timeoutSec });
    const text = existsSync(out) ? readFileSync(out, 'utf8').trim() : '';
    if (text) return text;
    throw classify('codex', r.err) || new AiError('ai_failed', 'Codex finished without an answer (exit ' + r.code + '). ' + r.err.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function runClaude(prompt, { schema, search, timeoutSec, model }) {
  const dir = mkdtempSync(join(tmpdir(), 'jhk-'));
  try {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--permission-mode', 'dontAsk'];
    if (search) args.push('--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch'); else args.push('--tools', '');
    if (schema) args.push('--json-schema', JSON.stringify(schema));
    if (model) args.push('--model', model);
    const r = await run('claude', args, { input: prompt, cwd: dir, timeoutSec });
    let j = null; try { j = JSON.parse(r.out); } catch {}
    if (j && !j.is_error) {
      if (schema && j.structured_output) return JSON.stringify(j.structured_output);
      if (typeof j.result === 'string' && j.result.trim()) return j.result.trim();
    }
    const msg = (j && (j.result || j.subtype)) || r.err || r.out;
    throw classify('claude', String(msg)) || new AiError('ai_failed', 'Claude Code finished without an answer (exit ' + r.code + '). ' + String(msg).slice(-300));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function runGemini(prompt, { schema, timeoutSec, model }) {
  const dir = mkdtempSync(join(tmpdir(), 'jhk-'));
  try {
    // plan = read-only approval mode: it can search the web and read pages, never edit files or run commands.
    const args = ['-p', 'Follow the instructions above.', '-o', 'json', '--approval-mode', 'plan', '--skip-trust'];
    if (model) args.push('-m', model);
    const r = await run('gemini', args, { input: prompt + (schema ? schemaNote(schema) : ''), cwd: dir, timeoutSec });
    let j = null; try { j = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch {}
    const text = j && typeof j.response === 'string' ? j.response.trim() : '';
    if (text) return text;
    const msg = (j && j.error && (j.error.message || JSON.stringify(j.error))) || r.err || r.out;
    throw classify('gemini', String(msg)) || new AiError('ai_failed', 'Gemini finished without an answer (exit ' + r.code + '). ' + String(msg).slice(-300));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

let mockHandler = null;
export function setMock(fn) { mockHandler = fn; }
export const providerOf = cfg => process.env.KIT_AI_PROVIDER || (cfg || loadConfig()).ai.provider;

export async function ask(prompt, opts = {}) {
  const cfg = loadConfig();
  const provider = providerOf(cfg);
  const o = { ...opts, timeoutSec: opts.timeoutSec || cfg.ai.timeoutSec, model: cfg.ai.model };
  const once = async extra => {
    const p = prompt + (extra || '');
    if (provider === 'mock') { if (!mockHandler) mockHandler = (await import('../tests/mock-ai.mjs')).default; return mockHandler(p, o); }
    if (provider === 'claude') return runClaude(p, o);
    if (provider === 'gemini') return runGemini(p, o);
    if (provider === 'codex') return runCodex(p, o);
    throw new AiError('not_installed', 'Unknown AI provider "' + provider + '" in config.json. Use codex, claude or gemini.');
  };
  const text = await once();
  if (!opts.schema) return text;
  try { const v = extractJson(text); if (fitsSchema(v, opts.schema)) return v; } catch {}
  // One retry: some CLIs occasionally drop a field or wrap the JSON in prose.
  const v = extractJson(await once('\n\nYour previous answer was not valid JSON for the schema. Answer again with ONLY the JSON object, every required key present.' + (provider === 'codex' || provider === 'claude' ? '' : schemaNote(opts.schema))));
  if (!fitsSchema(v, opts.schema)) throw new AiError('bad_json', 'The AI answer was missing fields.');
  return v;
}

export async function status() {
  const cfg = loadConfig();
  const provider = providerOf(cfg);
  const P = PROVIDERS[provider];
  if (provider === 'mock') return { provider, label: 'test mode', ready: true };
  if (!P) return { provider, ready: false, why: 'unknown AI provider in config.json' };
  const base = { provider, label: P.label };
  if (provider === 'gemini') {
    const g = join(homedir(), '.gemini');
    const ready = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || existsSync(join(g, 'oauth_creds.json')) || existsSync(join(g, 'google_accounts.json')));
    const installed = existsSync(join(TOOLS, ...P.entry)) || (await run('gemini', ['--version'], { timeoutSec: 30 }).then(r => r.code === 0, () => false));
    return { ...base, ready: ready && installed, why: !installed ? 'Gemini CLI not installed' : ready ? '' : 'Gemini not signed in' };
  }
  const args = provider === 'claude' ? ['auth', 'status', '--json'] : ['login', 'status'];
  try {
    const r = await run(provider, args, { timeoutSec: 30 });
    const all = r.out + r.err;
    let ready = r.code === 0;
    if (provider === 'claude') { try { ready = !!JSON.parse(r.out).loggedIn; } catch { ready = false; } }
    else ready = ready && !/not logged in/i.test(all);
    return { ...base, ready, why: ready ? '' : P.label + ' not signed in' };
  } catch (e) { return { ...base, ready: false, why: e.code === 'not_installed' ? P.label + ' not installed' : e.message }; }
}

// Interactive sign-in (used by setup and by "node login.mjs").
export function login(provider) {
  return new Promise(resolve => {
    const P = PROVIDERS[provider];
    const c = cliCommand(provider, P.login);
    const child = spawn(c.cmd, c.args, { stdio: 'inherit', shell: c.shell });
    child.on('close', code => resolve(code));
    child.on('error', () => resolve(1));
  });
}
