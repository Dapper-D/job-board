// Checks the one-click installers really install Claude Code and Codex on this machine (Windows CI),
// and that B3spoken then finds them without a new PATH (no sign-in here; that needs a person).
import { startInstall, installStatus, findOnPath, PROVIDERS } from '../src/helper/ai.mjs';
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
for (const p of ['claude', 'codex']) {
  startInstall(p);
  while (installStatus()[p].state === 'running') await wait(2000);
  const st = installStatus()[p];
  console.log(`${p}: ${st.state} -> ${findOnPath(PROVIDERS[p].bin) || 'not found'}`);
  if (st.state !== 'done') { console.log(st.log); failed = true; }
}
process.exit(failed ? 1 : 0);
