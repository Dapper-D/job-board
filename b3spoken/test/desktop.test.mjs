import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launcherVbs, trayPs1, launchAgentPlist, autostartDesktop, startupPath, setAutostart, relaunchHidden, startTray, selfCommand } from '../src/helper/desktop.mjs';

test('background: the hidden launcher runs B3spoken with no window and passes its arguments on', () => {
  const vbs = launcherVbs(['C:\\Program Files\\nodejs\\node.exe', 'C:\\B3\\b3spoken\\src\\helper\\main.mjs']);
  assert.match(vbs, /CreateObject\("WScript\.Shell"\)\.Run """C:\\Program Files\\nodejs\\node\.exe"" ""C:\\B3\\b3spoken\\src\\helper\\main\.mjs""" & args, 0, False/);
  assert.match(vbs, /For Each a In WScript\.Arguments/);
  const cmd = selfCommand({ exe: 'node', packaged: false });
  assert.equal(cmd.length, 2); assert.match(cmd[1], /main\.mjs$/);
  assert.deepEqual(selfCommand({ exe: 'C:\\B3spoken.exe', packaged: true }), ['C:\\B3spoken.exe']);
});

test('background: the tray icon opens the board, quits B3spoken, and closes itself when B3spoken stops', () => {
  const ps = trayPs1();
  for (const s of ['NotifyIcon', "'Open B3spoken'", "'Quit B3spoken'", 'Stop-Process -Id $HelperPid', 'Get-Process -Id $HelperPid', 'http://127.0.0.1:$Port/']) assert.ok(ps.includes(s), s);
});

test('start when I sign in: Windows Startup shortcut, Mac LaunchAgent, Linux autostart; off removes it', () => {
  const home = mkdtempSync(join(tmpdir(), 'b3-home-')), dir = mkdtempSync(join(tmpdir(), 'b3-data-'));
  try {
    assert.match(startupPath({ platform: 'win32', env: { APPDATA: 'C:\\Users\\o\\AppData\\Roaming' }, home }), /Startup[\\/]B3spoken\.lnk$/);
    const mac = setAutostart(dir, true, { platform: 'darwin', home, cmd: ['/Apps/B3spoken'] });
    assert.match(readFileSync(mac.path, 'utf8'), /<string>\/Apps\/B3spoken<\/string><string>--hidden<\/string><string>--no-open<\/string>/);
    setAutostart(dir, false, { platform: 'darwin', home }); assert.equal(existsSync(mac.path), false);
    const lin = setAutostart(dir, true, { platform: 'linux', env: {}, home, cmd: ['/usr/bin/node', '/opt/b3 x/main.mjs'] });
    assert.match(readFileSync(lin.path, 'utf8'), /^Exec="\/usr\/bin\/node" "\/opt\/b3 x\/main\.mjs" "--hidden" "--no-open"$/m);
    // Windows: the shortcut is made through PowerShell and points at wscript with the hidden launcher.
    let script = '';
    const lnk = startupPath({ platform: 'win32', env: { APPDATA: home }, home });
    const run = (_exe, args) => { script = args.at(-1); writeFileSync(lnk, 'x'); return { status: 0 }; };
    setAutostart(dir, true, { platform: 'win32', env: { APPDATA: home, SystemRoot: 'C:\\Windows' }, home, cmd: ['C:\\B3spoken.exe'], run });
    assert.match(script, /wscript\.exe/); assert.match(script, /start-b3spoken\.vbs" --hidden --no-open/);
    assert.match(readFileSync(join(dir, 'start-b3spoken.vbs'), 'utf8'), /Run """C:\\B3spoken\.exe""" & args, 0, False/);
    assert.throws(() => setAutostart(dir, true, { platform: 'win32', env: { APPDATA: join(home, 'none') }, home, cmd: ['x'], run: () => ({ status: 1, stderr: 'denied' }) }), /startup apps \(denied\)/);
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
});

test('background: relaunching hidden and starting the tray use wscript and a hidden PowerShell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b3-bg-'));
  try {
    const calls = [];
    const run = (exe, args, opts) => { calls.push({ exe, args, opts }); return { on() {}, unref() {} }; };
    relaunchHidden(dir, { cmd: ['C:\\B3spoken.exe'], env: { SystemRoot: 'C:\\Windows' }, run });
    assert.match(calls[0].exe, /wscript\.exe$/); assert.deepEqual(calls[0].args.slice(1), ['--hidden']); assert.equal(calls[0].opts.detached, true);
    startTray(dir, { port: 4747, pid: 123, cmd: ['C:\\B3spoken.exe'], run });
    assert.equal(calls[1].exe, 'powershell.exe');
    assert.deepEqual(calls[1].args.slice(-6), ['-Port', '4747', '-HelperPid', '123', '-IconFrom', 'C:\\B3spoken.exe']);
    assert.ok(calls[1].args.includes('-STA') && calls[1].args.includes('Hidden'));
    assert.ok(existsSync(join(dir, 'tray.ps1')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
