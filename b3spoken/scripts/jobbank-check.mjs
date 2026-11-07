// Checks Job Bank from this computer and prints PASS or FAIL with the reason (the board's "Check Job Bank now" does the same).
//   node b3spoken/scripts/jobbank-check.mjs ["search words"]
import { checkJobBank } from '../src/helper/jobbankcheck.mjs';
import { USER_AGENT } from '../src/scan/http.mjs';

console.log(`Checking Job Bank as "${USER_AGENT}"\n`);
const r = await checkJobBank({ keyword: process.argv[2] || 'software developer' });
for (const l of r.lines) console.log(`${l.ok ? 'PASS' : 'FAIL'}  ${l.text}`);
console.log(`\n${r.advice}`);
process.exitCode = r.ok ? 0 : 1;
