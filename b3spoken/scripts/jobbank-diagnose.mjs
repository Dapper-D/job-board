// Finds out WHY Job Bank fails on this computer, by asking it the same honest question a few slightly different ways.
// Nothing here pretends to be a web browser. 5 seconds between requests, as Job Bank's robots.txt asks.
//   node b3spoken/scripts/jobbank-diagnose.mjs
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const URL_ = 'https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed?searchstring=software+developer&locationstring=&sort=D&page=1';
const BOT = 'B3spokenBot/0.1 (+https://github.com/Dapper-D/job-board)';
const APP = 'B3spoken/0.1 (+https://github.com/Dapper-D/job-board)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function get({ ua, family = 0, lang = false, classic = false }) {
  return new Promise(resolve => {
    const headers = { 'user-agent': ua, accept: 'application/atom+xml, application/xml' };
    if (lang) headers['accept-language'] = 'en-CA,en;q=0.9';
    const req = https.get(URL_, { headers, family, timeout: 30000, ...(classic ? { ecdhCurve: 'X25519:prime256v1:secp384r1' } : {}) }, res => {
      let n = 0; res.on('data', c => { n += c.length; }); res.on('end', () => resolve(`HTTP ${res.statusCode}, ${n} bytes`));
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', e => resolve(`FAILED ${e.code || ''} ${e.message}`));
  });
}

const tests = [
  ['1. The way B3spoken asks now', { ua: BOT }],
  ['2. Same, but over IPv4 only', { ua: BOT, family: 4 }],
  ['3. Same, but named "B3spoken" without the word "Bot"', { ua: APP }],
  ['4. Same as 3, plus a language header', { ua: APP, lang: true }],
  ['6. The way B3spoken asks now, with a smaller first TLS message (no post-quantum key share)', { ua: BOT, classic: true }],
];
console.log('Asking Job Bank a few ways (about 30 seconds)...\n');
for (const [name, opt] of tests) { console.log(`${name}: ${await get(opt)}`); await sleep(5000); }
if (process.platform === 'win32') {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -UserAgent '${BOT}' '${URL_}'; "HTTP $($r.StatusCode), $($r.RawContentLength) bytes" } catch { "FAILED $($_.Exception.Message)" }`], { encoding: 'utf8' }).trim();
    console.log(`5. Windows' own web client (same name as 1): ${out}`);
  } catch (e) { console.log(`5. Windows' own web client: couldn't run (${e.message})`); }
}
console.log('\nCopy everything above and send it back. "HTTP 200" means that way works.');
