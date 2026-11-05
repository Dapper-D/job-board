// Second discovery pass for employers whose careers pages are blank until a browser runs their scripts.
// Opens each careers page in a headless browser (robots.txt checked first, our own honest user agent),
// lets it load, then looks at the finished page, its frames, and the addresses the page itself called
// for links to a hiring system. Pages that show a bot check are left alone: we don't try to get past them.
//   node src/scan/discover-render.mjs --in catalog/seeds.json --skip catalog/employers.json
import { readFileSync } from 'node:fs';
import { robotsAllows } from './robots.mjs';
import { USER_AGENT } from './http.mjs';
import { findBoardLinks } from './discover.mjs';
import { detect, SOURCES } from './sources/index.mjs';
import { phenomFromPage } from './sources/phenom.mjs';
import { eightfoldFromPage } from './sources/eightfold.mjs';
import { jibeFromPage } from './sources/jibe.mjs';
import { sfFromPage } from './sources/successfactors.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const have = arg('--skip') ? new Set(JSON.parse(readFileSync(arg('--skip'), 'utf8')).employers.map(e => e.name)) : new Set();
const seeds = JSON.parse(readFileSync(arg('--in', 'catalog/seeds.json'), 'utf8')).seeds.filter(s => !have.has(s.name));
const BOT_CHECK = /cf-chl|challenge-platform|captcha|are you a robot|verify you are human|access denied/i;

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const context = await browser.newContext({ userAgent: USER_AGENT });
const found = [];
for (const s of seeds) {
  const domain = s.domain.replace(/^www\./, '');
  let hit = null, note = '';
  for (const url of [`https://www.${domain}/careers`, `https://careers.${domain}/`, `https://jobs.${domain}/`, `https://www.${domain}/en/careers`]) {
    if (!(await robotsAllows(url, [domain, `*.${domain}`]).catch(() => false))) { note = 'robots.txt says no'; continue; }
    const page = await context.newPage();
    const called = [];
    page.on('request', r => { if (/^https:/.test(r.url())) called.push(r.url()); });
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
      if (!resp || resp.status() >= 400) { note = `HTTP ${resp && resp.status()}`; continue; }
      const html = await page.content();
      if (BOT_CHECK.test(html) && html.length < 20000) { note = 'bot check shown; left alone'; continue; }
      const finalUrl = page.url();
      const frames = page.frames().map(f => f.url()).filter(u => /^https:/.test(u));
      const direct = [finalUrl, ...frames, ...called].map(u => detect(u)).find(h => h && !SOURCES[h.source].feed && h.source !== 'jobbank');
      const links = findBoardLinks(html, finalUrl);
      const pageHit = phenomFromPage(html, finalUrl) && { source: 'phenom', target: phenomFromPage(html, finalUrl) }
        || eightfoldFromPage(html, finalUrl) && { source: 'eightfold', target: eightfoldFromPage(html, finalUrl) }
        || jibeFromPage(html, finalUrl) && { source: 'jibe', target: jibeFromPage(html, finalUrl) }
        || sfFromPage(html, finalUrl) && { source: 'successfactors', target: sfFromPage(html, finalUrl) };
      hit = direct || links[0] || pageHit;
      if (hit) { hit.how = `rendered ${url}`; break; }
      note = 'no hiring-system link after rendering';
    } catch (e) { note = String(e.message).split('\n')[0].slice(0, 80); }
    finally { await page.close(); }
  }
  if (hit) { found.push({ name: s.name, source: hit.source, target: hit.target, how: hit.how, sector: s.sector }); console.log(`found ${s.name}: ${hit.source} ${JSON.stringify(hit.target)} (${hit.how})`); }
  else console.log(`none  ${s.name}: ${note}`);
}
await browser.close();
console.log(`\nRendered pass found ${found.length} of ${seeds.length}.`);
