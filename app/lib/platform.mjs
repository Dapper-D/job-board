// Everything that differs between Windows, Mac and Linux: running npm/git, the daily schedule, the shortcut, opening a browser.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, chmodSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { APP, LOGS } from './paths.mjs';

export const OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
export const isWin = OS === 'windows';
const TASK = 'Job Hunt Kit - daily refresh';
const LABEL = 'com.jobhuntkit.refresh';
const CRON_TAG = '# job-hunt-kit daily refresh';

// Run a command and show its output. npm/npx/git are .cmd files on Windows, so they need a shell there.
export function sh(cmd, args, { cwd, quiet = false } = {}) {
  const q = a => (/[\s"&|<>^]/.test(a) ? '"' + String(a).replace(/"/g, '""') + '"' : a);
  const r = isWin
    ? spawnSync([cmd, ...args.map(q)].join(' '), { cwd, stdio: quiet ? 'pipe' : 'inherit', shell: true, encoding: 'utf8' })
    : spawnSync(cmd, args, { cwd, stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
  return { ok: r.status === 0, status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
export const has = cmd => sh(isWin ? 'where' : 'which', [cmd], { quiet: true }).ok;

const ps = script => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true });
const psq = s => "'" + String(s).replace(/'/g, "''") + "'";

// Daily refresh at "HH:MM" local time. It runs node directly with full paths, so it doesn't depend on PATH.
export function schedule(time) {
  const [h, m] = String(time || '07:10').split(':').map(n => parseInt(n, 10) || 0);
  const node = process.execPath, script = join(APP, 'run-refresh.mjs');
  if (isWin) {
    // Through a hidden PowerShell window, so a console doesn't sit open on screen while the refresh runs.
    const inner = `& '${node.replace(/'/g, "''")}' '${script.replace(/'/g, "''")}'`;
    const r = ps(`$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${psq('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "' + inner + '"')} -WorkingDirectory ${psq(APP)}
$t = New-ScheduledTaskTrigger -Daily -At ${psq(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'))}
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -Hidden
Register-ScheduledTask -TaskName ${psq(TASK)} -Action $a -Trigger $t -Settings $s -Description 'Scans for jobs, verifies and scores them, makes tailored resumes, updates the local job board.' -Force | Out-Null`);
    return { ok: r.status === 0, how: 'Windows Task Scheduler ("' + TASK + '"). Runs while you are signed in; if the PC was off or asleep, it runs when it wakes.', err: r.stderr };
  }
  if (OS === 'mac') {
    const dir = join(homedir(), 'Library', 'LaunchAgents'); mkdirSync(dir, { recursive: true });
    const plist = join(dir, LABEL + '.plist');
    const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${x(node)}</string><string>${x(script)}</string></array>
  <key>WorkingDirectory</key><string>${x(APP)}</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>
  <key>StandardErrorPath</key><string>${x(join(LOGS, 'refresh-errors.log'))}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${x([join(node, '..'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':'))}</string></dict>
</dict></plist>
`);
    const uid = process.getuid();
    spawnSync('launchctl', ['bootout', `gui/${uid}`, plist], { stdio: 'ignore' });
    const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plist], { encoding: 'utf8' });
    return { ok: r.status === 0, how: 'macOS launchd (' + plist + '). If the Mac was asleep at that time, it runs when it wakes.', err: r.stderr };
  }
  const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  const keep = (cur.status === 0 ? cur.stdout : '').split('\n').filter(l => l.trim() && !l.includes(CRON_TAG));
  const pathDirs = [join(node, '..'), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
  keep.push(`${m} ${h} * * * cd "${APP}" && PATH="${pathDirs}" "${node}" "${script}" >/dev/null 2>>"${join(LOGS, 'refresh-errors.log')}" ${CRON_TAG}`);
  const r = spawnSync('crontab', ['-'], { input: keep.join('\n') + '\n', encoding: 'utf8' });
  if (r.error) return { ok: false, err: 'crontab is not installed (install the "cron" package)' };
  return { ok: r.status === 0, how: 'cron (crontab -l shows it). The computer has to be on at that time.', err: r.stderr };
}

export function unschedule() {
  if (isWin) return ps(`Unregister-ScheduledTask -TaskName ${psq(TASK)} -Confirm:$false -ErrorAction SilentlyContinue`).status === 0;
  if (OS === 'mac') {
    const plist = join(homedir(), 'Library', 'LaunchAgents', LABEL + '.plist');
    spawnSync('launchctl', ['bootout', `gui/${process.getuid()}`, plist], { stdio: 'ignore' });
    if (existsSync(plist)) unlinkSync(plist);
    return true;
  }
  const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  if (cur.status !== 0) return true;
  const keep = cur.stdout.split('\n').filter(l => l.trim() && !l.includes(CRON_TAG));
  return spawnSync('crontab', ['-'], { input: keep.join('\n') + (keep.length ? '\n' : ''), encoding: 'utf8' }).status === 0;
}

// Last scheduled run, for the health check.
export function scheduleStatus() {
  if (isWin) {
    const r = ps(`$i = Get-ScheduledTaskInfo -TaskName ${psq(TASK)} -ErrorAction SilentlyContinue; if ($i) { "$($i.LastRunTime)|$($i.LastTaskResult)|$($i.NextRunTime)" }`);
    const [last, result, next] = (r.stdout || '').trim().split('|');
    return r.stdout.trim() ? { exists: true, last, result, next } : { exists: false };
  }
  if (OS === 'mac') return { exists: existsSync(join(homedir(), 'Library', 'LaunchAgents', LABEL + '.plist')) };
  const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  return { exists: cur.status === 0 && cur.stdout.includes(CRON_TAG) };
}

const SHORTCUTS = {
  windows: () => join(homedir(), 'Desktop', 'Job Board.lnk'),
  mac: () => join(homedir(), 'Desktop', 'Job Board.command'),
  linux: () => join(homedir(), '.local', 'share', 'applications', 'job-hunt-kit.desktop'),
};
export function shortcut() {
  const node = process.execPath, start = join(APP, 'start.mjs');
  const f = SHORTCUTS[OS]();
  if (isWin) {
    // Desktop may be redirected (OneDrive), so ask Windows where it is.
    const r = ps(`$d = [Environment]::GetFolderPath('Desktop'); $l = Join-Path $d 'Job Board.lnk'; $s = (New-Object -ComObject WScript.Shell).CreateShortcut($l)
$s.TargetPath = ${psq(node)}; $s.Arguments = ${psq('"' + start + '"')}; $s.WorkingDirectory = ${psq(APP)}; $s.WindowStyle = 7; $s.IconLocation = 'shell32.dll,13'; $s.Save(); $l`);
    return { ok: r.status === 0, file: (r.stdout || '').trim() || f };
  }
  mkdirSync(join(f, '..'), { recursive: true });
  if (OS === 'mac') {
    writeFileSync(f, `#!/bin/bash\ncd "${APP}" && "${node}" start.mjs\n`);
    chmodSync(f, 0o755);
    return { ok: true, file: f };
  }
  writeFileSync(f, `[Desktop Entry]\nType=Application\nName=Job Board\nComment=Open your local job board\nExec="${node}" "${start}"\nPath=${APP}\nTerminal=false\nCategories=Office;\n`);
  chmodSync(f, 0o755);
  const desk = join(homedir(), 'Desktop');
  if (existsSync(desk)) { const d = join(desk, 'Job Board.desktop'); writeFileSync(d, readFileSync(f)); chmodSync(d, 0o755); }
  return { ok: true, file: f };
}
export function removeShortcut() {
  if (isWin) { ps(`Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Job Board.lnk') -ErrorAction SilentlyContinue`); return; }
  for (const f of [SHORTCUTS[OS](), join(homedir(), 'Desktop', 'Job Board.desktop')]) if (existsSync(f)) unlinkSync(f);
}

export function openBrowser(url) {
  const [cmd, args] = isWin ? ['cmd', ['/c', 'start', '""', url]] : OS === 'mac' ? ['open', [url]] : ['xdg-open', [url]];
  try { const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }); c.on('error', () => console.log('Open this in your browser: ' + url)); c.unref(); return true; } catch { return false; }
}

// Start a node script in the background, detached from this window.
export function background(script, args = [], logName) {
  mkdirSync(LOGS, { recursive: true });
  const out = logName ? openSync(join(LOGS, logName), 'a') : 'ignore';
  const c = spawn(process.execPath, [join(APP, script), ...args], { cwd: APP, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  c.unref();
  return c.pid;
}
