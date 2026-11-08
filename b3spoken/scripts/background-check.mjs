// Windows check (GitHub Actions): opening B3spoken normally starts it again with no window, shows the icon by the
// clock, adds the "start when I sign in" shortcut, and Quit (stopping B3spoken) also closes the icon.
//   node scripts/background-check.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startupPath, setAutostart } from '../src/helper/desktop.mjs';

const fail = m => { console.error(`FAIL  ${m}`); process.exit(1); };
const ok = m => console.log(`PASS  ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const home = mkdtempSync(join(tmpdir(), 'b3-bg-'));
const env = { ...process.env, B3SPOKEN_HOME: home, B3SPOKEN_SKIP_JOBBANK: '1' };
// PowerShell exits with 1 when a lookup finds nothing (e.g. the process is already gone): that's an empty answer here.
const ps = cmd => { try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim(); } catch (e) { return String(e.stdout || '').trim(); } };

// 1. A plain start (like the Start menu shortcut) hands over to a hidden copy and exits.
const first = spawn(process.execPath, ['src/helper/main.mjs'], { env, stdio: 'ignore' });
const code = await new Promise(r => first.on('exit', r));
if (code !== 0) fail(`the first start exited with ${code}`);
let helper = null;
for (let i = 0; i < 60 && !helper; i++) { await sleep(1000); try { helper = JSON.parse(readFileSync(join(home, 'helper.json'), 'utf8')); } catch {} }
if (!helper) fail('the hidden copy never started');
const h = await (await fetch(`http://127.0.0.1:${helper.port}/health`)).json();
if (h.app !== 'b3spoken') fail('the hidden copy is not answering');
ok(`hidden copy running (pid ${helper.pid}, port ${helper.port}), first window closed`);

// 2. The icon by the clock: a hidden PowerShell running tray.ps1 for this B3spoken.
let tray = '';
for (let i = 0; i < 20 && !tray; i++) { await sleep(1000); tray = ps(`(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*tray.ps1*' -and $_.CommandLine -like '*-HelperPid ${helper.pid}*' } | Select-Object -First 1).ProcessId`); }
if (!tray) fail('no tray icon process');
let trayLog = '';
for (let i = 0; i < 15 && !/icon shown/.test(trayLog); i++) { await sleep(1000); try { trayLog = readFileSync(join(home, 'tray.log'), 'utf8'); } catch {} }
if (!/icon shown/.test(trayLog)) {
  // Explain: show the tray process's command line, then run the same script in the foreground (it stops by itself
  // within a few seconds because the B3spoken it watches doesn't exist) and print everything it says.
  console.log('tray command line:', ps(`(Get-CimInstance Win32_Process -Filter "ProcessId=${tray}").CommandLine`) || '(process gone)');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(home, 'tray.ps1'), '-Port', '1', '-HelperPid', '999999', '-IconFrom', process.execPath, '-Log', join(home, 'tray-debug.log')], { encoding: 'utf8', timeout: 30000 });
    console.log('foreground run output:', out.trim() || '(none)');
  } catch (e) { console.log('foreground run failed:', e.status, String(e.stdout || '').trim(), String(e.stderr || '').trim().slice(0, 1500)); }
  try { console.log('tray-debug.log:', readFileSync(join(home, 'tray-debug.log'), 'utf8')); } catch { console.log('tray-debug.log: (none)'); }
  try { console.log('tray-start.log:', readFileSync(join(home, 'tray-start.log'), 'utf8')); } catch { console.log('tray-start.log: (none)'); }
  fail(`the icon script didn't show the icon; tray.log: ${trayLog.trim().slice(0, 300) || '(empty)'}`);
}
ok(`tray icon shown (pid ${tray})`);

// 3. Start when I sign in: the Startup shortcut points at wscript and the hidden launcher.
const lnk = startupPath();
if (!existsSync(lnk)) fail(`no startup shortcut at ${lnk}`);
const target = ps(`$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}'); "$($s.TargetPath) $($s.Arguments)"`);
if (!/wscript\.exe .*start-b3spoken\.vbs" --hidden --no-open/i.test(target)) fail(`startup shortcut points at: ${target}`);
ok('startup shortcut added');

// 4. Quit: stopping B3spoken closes the icon too.
process.kill(helper.pid);
let gone = false;
for (let i = 0; i < 20 && !gone; i++) { await sleep(1000); gone = !ps(`Get-Process -Id ${tray} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`); }
if (!gone) fail('the tray icon stayed after B3spoken stopped');
ok('tray icon closed after B3spoken stopped');

setAutostart(home, false);
if (existsSync(lnk)) fail('turning startup off left the shortcut');
ok('startup shortcut removed when turned off');
