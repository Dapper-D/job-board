// Finds the AI tools the person already has, and asks them one question at a time.
//   ChatGPT: the Codex CLI (`codex`), signed in with their ChatGPT plan.
//   Claude:  Claude Code (`claude`), signed in with their Claude plan.
//   Chrome built-in AI runs inside the board page itself, and "no AI" uses rule-based tailoring,
//   so neither needs anything here.
// Safety: the prompt goes in on stdin, never on the command line; the command and its flags are fixed;
// each run happens in an empty folder with file-changing and web tools turned off.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

export const PROVIDERS = {
  codex: {
    label: 'ChatGPT (Codex)', bin: 'codex', versionArgs: ['--version'],
    // Read-only sandbox, none of the user's own config or rules, nothing saved, answer written to a file.
    askArgs: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--color', 'never', '-o', '{OUT}', '-'],
    install: 'npm install -g @openai/codex, then run `codex` once and sign in with ChatGPT',
  },
  claude: {
    label: 'Claude (Claude Code)', bin: 'claude', versionArgs: ['--version'],
    // No tools at all, no MCP servers, no skills or slash commands, no settings from the user, nothing saved.
    askArgs: ['-p', '--output-format', 'text', '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', 'project', '--no-session-persistence'],
    install: 'npm install -g @anthropic-ai/claude-code, then run `claude` once and sign in with Claude',
  },
};

// Looks for an executable on PATH without running a shell.
export function findOnPath(bin, env = process.env, platform = process.platform) {
  const exts = platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  // PATH first, then the folders the official installers use (PATH can be stale for apps started from a
  // shortcut or an installer, e.g. right after installing Claude Code, until the person signs out and back in).
  const home = env.USERPROFILE || env.HOME || '';
  const known = platform === 'win32'
    ? [join(home, '.local', 'bin'), env.APPDATA && join(env.APPDATA, 'npm'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'claude-code'), join(home, '.claude', 'local'), env.ProgramFiles && join(env.ProgramFiles, 'nodejs')]
    : [join(home, '.local', 'bin'), join(home, '.claude', 'local'), join(home, '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const dirs = [...String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : delimiter), ...known.filter(Boolean)];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) { const p = join(dir, bin + ext.toLowerCase()); if (existsSync(p)) return p; const q = join(dir, bin + ext); if (existsSync(q)) return q; }
  }
  return null;
}

function run(file, args, { input = '', cwd, timeoutMs = 120_000 } = {}) {
  return new Promise(resolve => {
    // Windows .cmd shims can only start through the shell; the arguments are our fixed list, never user text.
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
    // Through the shell every argument is quoted (they are fixed strings without quotes, so this is safe; it keeps '' as an empty argument).
    const child = spawn(shell ? `"${file}"` : file, shell ? args.map(a => `"${a}"`) : args, { cwd, shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', d => { out += d; if (out.length > 2e6) child.kill(); });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(input);
  });
}

export async function detect({ env = process.env } = {}) {
  const found = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const path = findOnPath(p.bin, env);
    let version = null;
    if (path) { const r = await run(path, p.versionArgs, { timeoutMs: 15_000 }); if (r.code === 0) version = r.out.trim().split('\n')[0]; }
    found[id] = { label: p.label, installed: !!path, working: !!version, version, install: p.install };
  }
  return found;
}

export async function ask(provider, prompt, { timeoutMs = 180_000 } = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`unknown AI: ${provider}`);
  const path = findOnPath(p.bin);
  if (!path) throw new Error(`${p.label} isn't installed: ${p.install}`);
  const dir = mkdtempSync(join(tmpdir(), 'b3spoken-ai-'));
  try {
    const outFile = join(dir, 'answer.txt');
    const r = await run(path, p.askArgs.map(a => (a === '{OUT}' ? outFile : a)), { input: prompt, cwd: dir, timeoutMs });
    if (r.code !== 0) throw new Error(`${p.label} stopped with an error: ${(r.err || r.out).trim().slice(0, 300)}`);
    return (existsSync(outFile) ? readFileSync(outFile, 'utf8') : r.out).trim();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- One-click install and first sign-in (for people who've never used a terminal) ----
// Installs with each company's own official installer, the same command their docs give:
//   Claude Code: https://claude.ai/install.ps1 (Windows) or https://claude.ai/install.sh (Mac, Linux)
//   Codex:       https://chatgpt.com/codex/install.ps1 (Windows) or https://chatgpt.com/codex/install.sh (Mac, Linux)
// Both install for the current user only (no admin rights). Sign-in opens a terminal window running the tool's
// own sign-in, which opens the browser; B3spoken never sees the password or the sign-in token.
export const INSTALLERS = {
  claude: { win: 'https://claude.ai/install.ps1', unix: 'https://claude.ai/install.sh', unixShell: 'bash' },
  codex: { win: 'https://chatgpt.com/codex/install.ps1', unix: 'https://chatgpt.com/codex/install.sh', unixShell: 'sh' },
};
const SIGN_IN_ARGS = { claude: [], codex: ['login'] };

export function installCommand(provider, platform = process.platform) {
  const i = INSTALLERS[provider]; if (!i) throw new Error(`unknown AI: ${provider}`);
  return platform === 'win32'
    ? { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${i.win} | iex`] }
    : { file: '/bin/sh', args: ['-c', `curl -fsSL ${i.unix} | ${i.unixShell}`] };
}

const installs = {}; // provider -> { state: 'running' | 'done' | 'failed', log, startedAt }
export function installStatus() { return installs; }

export function startInstall(provider, { spawnFn = spawn, platform = process.platform } = {}) {
  if (installs[provider]?.state === 'running') return installs[provider];
  const { file, args } = installCommand(provider, platform);
  const job = installs[provider] = { state: 'running', log: '', startedAt: new Date().toISOString() };
  const child = spawnFn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const add = d => { job.log = (job.log + d).slice(-4000); };
  child.stdout?.on('data', add); child.stderr?.on('data', add);
  const timer = setTimeout(() => child.kill(), 10 * 60_000);
  child.on('error', e => { clearTimeout(timer); job.state = 'failed'; add(`\n${e.message}`); });
  child.on('close', code => { clearTimeout(timer); job.state = code === 0 && findOnPath(PROVIDERS[provider].bin) ? 'done' : 'failed'; });
  return job;
}

// Opens a visible terminal window running the tool's own sign-in.
export function signInCommand(provider, path, platform = process.platform) {
  const args = SIGN_IN_ARGS[provider]; if (!args) throw new Error(`unknown AI: ${provider}`);
  const q = s => `"${String(s).replace(/"/g, '')}"`;
  if (platform === 'win32') return { file: 'cmd.exe', args: ['/c', 'start', '"B3spoken sign-in"', 'cmd', '/k', [q(path), ...args].join(' ')], shell: false, verbatim: true };
  const line = [`'${String(path).replace(/'/g, '')}'`, ...args].join(' ');
  if (platform === 'darwin') return { file: 'osascript', args: ['-e', `tell application "Terminal" to do script "${line.replace(/"/g, '\\"')}"`, '-e', 'tell application "Terminal" to activate'] };
  return { file: 'x-terminal-emulator', args: ['-e', line] };
}

export function openSignIn(provider, { spawnFn = spawn, platform = process.platform } = {}) {
  const p = PROVIDERS[provider]; if (!p) throw new Error(`unknown AI: ${provider}`);
  const path = findOnPath(p.bin); if (!path) throw new Error(`${p.label} isn't installed yet`);
  const c = signInCommand(provider, path, platform);
  const child = spawnFn(c.file, c.args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: !!c.verbatim });
  child.on?.('error', () => {}); child.unref?.();
  return { opened: true };
}

// A tiny real request, to check the tool is installed and signed in.
export async function testAi(provider, askFn = ask) {
  try { const a = await askFn(provider, 'Reply with exactly the word OK and nothing else.', { timeoutMs: 90_000 }); return { ok: /\bok\b/i.test(a), answer: a.slice(0, 200) }; }
  catch (e) { return { ok: false, error: /log ?in|sign ?in|auth|credential|401|unauthor/i.test(e.message) ? 'Not signed in yet. Click Sign in, finish in the browser, then try again.' : e.message.slice(0, 300) }; }
}
