// Running in the background like a normal desktop app:
// - Windows: no console window (B3spoken restarts itself hidden through a tiny .vbs launcher), an icon by the clock
//   with "Open B3spoken" and "Quit B3spoken", and a Startup-folder shortcut so it starts when you sign in.
// - Mac: a LaunchAgent so it starts when you sign in. Linux: an autostart entry.
// Everything uses what the system already has (Windows Script Host, PowerShell, launchd, XDG autostart): nothing to install.
// The launcher and tray files live in B3spoken's own data folder; turning "start when I sign in" off removes the startup entry.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { insideExe } from './assets.mjs';

// How to start this same B3spoken again: the .exe itself, or node with main.mjs.
export function selfCommand({ exe = process.execPath, packaged = insideExe } = {}) {
  return packaged ? [exe] : [exe, fileURLToPath(new URL('./main.mjs', import.meta.url))];
}

const vbsQuote = s => `"${String(s).replace(/"/g, '""')}"`;
// A Windows Script Host launcher that runs B3spoken with no window (window style 0), passing on its own arguments.
export function launcherVbs(cmd) {
  const line = cmd.map(c => `""${String(c).replace(/"/g, '')}""`).join(' ');
  return [
    "' Starts B3spoken without a window. Made by B3spoken; it's safe to delete (B3spoken makes it again).",
    'Dim args, a',
    'args = ""',
    'For Each a In WScript.Arguments',
    '  args = args & " " & a',
    'Next',
    `CreateObject("WScript.Shell").Run "${line}" & args, 0, False`,
    '',
  ].join('\r\n');
}

// The icon by the clock (PowerShell with Windows Forms, both built into Windows). It closes itself when B3spoken stops.
export function trayPs1() {
  return `# The B3spoken icon by the clock. Made by B3spoken; it's safe to delete (B3spoken makes it again).
param([int]$Port, [int]$HelperPid, [string]$IconFrom, [string]$Log, [switch]$Announce)
$ErrorActionPreference = 'Stop'
function Note($m) { if ($Log) { try { Add-Content -LiteralPath $Log -Value "$(Get-Date -Format s) $m" } catch {} } }
Note "starting (PowerShell $($PSVersionTable.PSVersion), pid $PID)"
try {
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Note 'Windows Forms loaded'
$url = "http://127.0.0.1:$Port/"
$icon = New-Object System.Windows.Forms.NotifyIcon
try { $icon.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($IconFrom) } catch { $icon.Icon = [System.Drawing.SystemIcons]::Application }
$icon.Text = 'B3spoken'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Open B3spoken')
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Start-Process $url })
[void]$menu.Items.Add('-')
$quit = $menu.Items.Add('Quit B3spoken')
$quit.add_Click({
  Stop-Process -Id $HelperPid -ErrorAction SilentlyContinue
  $icon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$icon.ContextMenuStrip = $menu
$icon.add_MouseClick({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Start-Process $url } })
$icon.Visible = $true
# Windows 11 tucks new icons under the ^ arrow, so say once where to find it.
if ($Announce) { $icon.ShowBalloonTip(8000, 'B3spoken is running', 'Find B3spoken here by the clock (it may be under the ^ arrow). Click it to open your job board.', [System.Windows.Forms.ToolTipIcon]::Info) }
Note "icon shown for B3spoken (pid $HelperPid)"
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({ if (-not (Get-Process -Id $HelperPid -ErrorAction SilentlyContinue)) { $icon.Visible = $false; [System.Windows.Forms.Application]::Exit() } })
$timer.Start()
[System.Windows.Forms.Application]::Run()
Note 'closing'
} catch { Note "tray error: $($_.Exception.Message)"; exit 1 }
`;
}

export function launchAgentPlist(cmd) {
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.b3spoken.helper</string>
  <key>ProgramArguments</key>
  <array>${[...cmd, '--hidden', '--no-open'].map(a => `<string>${x(a)}</string>`).join('')}</array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
`;
}

export function autostartDesktop(cmd) {
  const q = s => `"${String(s).replace(/(["\\`$])/g, '\\$1')}"`;
  return `[Desktop Entry]
Type=Application
Name=B3spoken
Comment=Gets new jobs and documents ready in the background
Exec=${[...cmd, '--hidden', '--no-open'].map(q).join(' ')}
X-GNOME-Autostart-enabled=true
NoDisplay=true
`;
}

// Where the "start when I sign in" entry lives on each system.
export function startupPath({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'B3spoken.lnk');
  if (platform === 'darwin') return join(home, 'Library', 'LaunchAgents', 'com.b3spoken.helper.plist');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'autostart', 'b3spoken.desktop');
}

const ps = (script, run = spawnSync) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
const psq = s => `'${String(s).replace(/'/g, "''")}'`;

// Writes the hidden launcher (Windows) and returns its path.
export function writeLauncher(dir, { cmd = selfCommand() } = {}) {
  const file = join(dir, 'start-b3spoken.vbs');
  writeFileSync(file, launcherVbs(cmd));
  return file;
}

// Turns "start when I sign in" on or off. Returns { on, path }.
export function setAutostart(dir, on, { platform = process.platform, env = process.env, home = homedir(), cmd = selfCommand(), run = spawnSync } = {}) {
  const path = startupPath({ platform, env, home });
  if (!on) { rmSync(path, { force: true }); return { on: false, path }; }
  mkdirSync(dirname(path), { recursive: true });
  if (platform === 'win32') {
    const vbs = writeLauncher(dir, { cmd });
    const wscript = join(env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
    const r = ps(`$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psq(path)}); $s.TargetPath = ${psq(wscript)}; $s.Arguments = ${psq(`${vbsQuote(vbs)} --hidden --no-open`)}; $s.Description = 'Start B3spoken in the background'; $s.IconLocation = ${psq(`${cmd[0]},0`)}; $s.Save()`, run);
    if (r.status !== 0 || !existsSync(path)) throw new Error(`couldn't add B3spoken to your startup apps${r.stderr ? ` (${String(r.stderr).trim().slice(0, 200)})` : ''}`);
  } else writeFileSync(path, platform === 'darwin' ? launchAgentPlist(cmd) : autostartDesktop(cmd));
  return { on: true, path };
}
export const autostartOn = opts => existsSync(startupPath(opts));

// Windows: when opened from a shortcut with a console window, start again hidden and let this window close.
// Returns true when the hidden copy was started (the caller then exits).
export function relaunchHidden(dir, { argv = [], cmd = selfCommand(), env = process.env, run = spawn } = {}) {
  const vbs = writeLauncher(dir, { cmd });
  const wscript = join(env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
  const child = run(wscript, [vbs, '--hidden', ...argv], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on?.('error', () => {}); child.unref?.();
  return true;
}

// Windows: show the icon by the clock for this running B3spoken.
// Returns the tray process (its 'exit' event tells B3spoken if the icon went away).
export function startTray(dir, { port, pid = process.pid, cmd = selfCommand(), run = spawn, announce = false, fresh = true } = {}) {
  const file = join(dir, 'tray.ps1');
  writeFileSync(file, trayPs1());
  // The icon script writes what it does (and any error) to tray.log, so a missing icon can be explained.
  const log = join(dir, 'tray.log');
  if (fresh) try { writeFileSync(log, ''); } catch {} // a restart adds to the log instead of wiping the reason
  const args = ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', file, '-Port', String(port), '-HelperPid', String(pid), '-IconFrom', cmd[0], '-Log', log, ...(announce ? ['-Announce'] : [])];
  // PowerShell's own startup errors (before the script runs) go to tray-start.log.
  let err = 'ignore';
  try { err = openSync(join(dir, 'tray-start.log'), fresh ? 'w' : 'a'); writeSync(err, `${new Date().toISOString()} powershell.exe ${args.join(' ')}\n`); } catch {}
  const child = run('powershell.exe', args, { detached: true, stdio: ['ignore', err, err], windowsHide: true });
  if (typeof err === 'number') try { closeSync(err); } catch {}
  child.on?.('error', () => {}); child.unref?.();
  return child;
}
