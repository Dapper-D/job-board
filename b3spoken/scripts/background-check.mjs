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
const ps = cmd => execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();

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
ok(`tray icon process running (pid ${tray})`);

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
