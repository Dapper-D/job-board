#!/usr/bin/env node
// Sign in to your AI, or switch to a different one.
//   node login.mjs            sign in to the AI chosen in setup
//   node login.mjs claude     switch to Claude Code (installs it if needed) and sign in
import { loadConfig, saveConfig } from './lib/config.mjs';
import { PROVIDERS, login, status } from './lib/ai.mjs';
import { installProvider } from './lib/install.mjs';

const want = process.argv[2];
const cfg = loadConfig();
if (want) {
  if (!PROVIDERS[want]) { console.log('Use one of: ' + Object.keys(PROVIDERS).join(', ')); process.exit(1); }
  if (!installProvider(want)) process.exit(1);
  cfg.ai = { ...cfg.ai, provider: want, model: '' }; saveConfig(cfg);
}
const p = loadConfig().ai.provider;
let st = await status();
if (st.ready) { console.log(st.label + ' is signed in and ready.'); process.exit(0); }
console.log(PROVIDERS[p].loginHelp);
await login(p);
st = await status();
console.log(st.ready ? st.label + ' is ready.' : 'Still not signed in (' + st.why + '). Try again: node login.mjs');
process.exit(st.ready ? 0 : 1);
