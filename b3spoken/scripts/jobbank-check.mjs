// Checks Job Bank from this computer, the same way B3spoken does, and says what happened in plain words.
//   node b3spoken/scripts/jobbank-check.mjs            (from the job-board folder)
// It makes two requests (robots.txt and one search), 5 seconds apart, as Job Bank's robots.txt asks.
import { request, USER_AGENT, sleep } from '../src/scan/http.mjs';
import SOURCE from '../src/scan/sources/jobbank.mjs';

const HOSTS = ['www.jobbank.gc.ca'];
const say = (ok, text) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`);
console.log(`Checking Job Bank as "${USER_AGENT}"\n`);
let failed = false;
try {
  const r = await request('https://www.jobbank.gc.ca/robots.txt', { allow: HOSTS, parse: 'text', retries: 0, accept: 'text/plain' });
  say(true, `robots.txt answered (HTTP ${r.status}, ${r.text.length} bytes)`);
} catch (e) { failed = true; say(false, `robots.txt: ${e.code || ''} ${e.message}`); }
await sleep(5000);
try {
  const qs = new URLSearchParams({ searchstring: process.argv[2] || 'software developer', locationstring: '', sort: 'D', page: '1' });
  const r = await request(`https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed?${qs}`, { allow: HOSTS, parse: 'text', retries: 0, accept: 'application/atom+xml, application/xml' });
  const jobs = SOURCE.parse(r.text);
  say(jobs.length > 0, `job search feed answered (HTTP ${r.status}): ${jobs.length} postings${jobs[0] ? `, newest "${jobs[0].title}" posted ${jobs[0].postedAt}` : ''}`);
  if (!jobs.length) { failed = true; console.log('      The feed answered but had no postings: its format may have changed.'); }
} catch (e) { failed = true; say(false, `job search feed: ${e.code || ''} ${e.message}`); }
console.log(failed
  ? '\nSomething failed. "ECONNRESET" means Job Bank cut the connection: common on VPNs, work or school networks and cloud servers. Try again on your home connection with any VPN off, and send the lines above to the maintainer.'
  : '\nJob Bank works from this computer.');
process.exitCode = failed ? 1 : 0;
