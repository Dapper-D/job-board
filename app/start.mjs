#!/usr/bin/env node
// Starts the board server in the background if it isn't running, then opens it in your browser
// with a one-time launch code (the board then remembers this browser with a private session cookie).
import { loadConfig } from './lib/config.mjs';
import { background, openBrowser } from './lib/platform.mjs';

const cfg = loadConfig();
const port = Number(process.env.KIT_PORT || cfg.port || 4777);
const url = `http://127.0.0.1:${port}/`;
const up = () => fetch(url + 'api/version', { headers: { 'x-kit-token': loadConfig().token || '' }, signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false);
if (!(await up())) {
  background('server.mjs', [], 'server.log');
  for (let i = 0; i < 30 && !(await up()); i++) await new Promise(r => setTimeout(r, 500));
}
if (!(await up())) { console.log('The board did not start. See logs/server.log in the kit folder.'); process.exit(1); }
if (!process.argv.includes('--no-open')) {
  const r = await fetch(url + 'api/launch', { method: 'POST', headers: { 'x-kit-token': loadConfig().token, 'content-type': 'application/json' }, body: '{}' }).then(x => x.json()).catch(() => ({}));
  openBrowser(r.code ? url + '?launch=' + r.code : url);
}
console.log('Job board: ' + url);
