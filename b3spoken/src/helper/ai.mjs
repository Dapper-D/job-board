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
  for (const dir of String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : delimiter)) {
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
