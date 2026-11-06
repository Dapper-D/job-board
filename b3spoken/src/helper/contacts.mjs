// Recruiter contacts for one job, and a draft email the person can send themselves.
// Where emails come from (nothing else):
//   1. The posting itself, when it publishes an email.
//   2. The employer's own website: a few public pages (home, careers, contact, about) on the employer's domain,
//      only where its robots.txt allows, keeping only addresses on that same domain.
//   3. Hunter.io, only if the person adds their own Hunter API key (their account, their quota).
// Never: LinkedIn or other social sites, guessing addresses, or checking addresses against mail servers.
// Nothing is ever sent. The person copies the draft or opens it in their own email app.
import { request } from '../scan/http.mjs';
import { robotsAllows } from '../scan/robots.mjs';
import { companyKey } from '../scan/job.mjs';
import { readAsset } from './assets.mjs';

const ATS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|workable\.com|bamboohr\.com|breezy\.hr|pinpointhq\.com|teamtailor\.com|oraclecloud\.com|eightfold\.ai|icims\.com|successfactors\.(com|eu)|sapsf\.(com|eu)|taleo\.net|jobvite\.com|rippling\.com|rippling-ats\.com|jobbank\.gc\.ca|himalayas\.app|remotive\.com|remoteok\.com|jobicy\.com|amazon\.jobs|google\.com|apple\.com)$/i;
const ROLE = /^(careers?|jobs?|recruit(ing|ment|er)?s?|talent(acquisition)?|hiring|hr|people|humanresources|join(us)?|work(withus)?|apply|emplois?|carrieres?)$/i;
const HIRING = /career|recruit|talent|hiring|\bhr\b|^hr|people|jobs?\b|^jobs|emploi|carriere|humanresources|staffing/i;
const JUNK = /^(no-?reply|donotreply|privacy|abuse|postmaster|webmaster|security|support|sales|press|media|info|hello|contact|accessibility|legal|billing|marketing|investors?)$/i;

export function emailsIn(text) {
  const out = new Set();
  // Pages often embed JSON with \u003e-style escapes right before an address; turn those back into characters first.
  const clean = String(text || '').replace(/\\?u00([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  for (const m of clean.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g)) {
    const e = m[0].replace(/\.$/, '').toLowerCase();
    if (/\.(png|jpe?g|gif|svg|webp)$/.test(e) || /@(example|sentry|wixpress|domain)\./.test(e)) continue;
    out.add(e);
  }
  return [...out];
}

const baseDomain = host => { const p = String(host).toLowerCase().replace(/^www\./, '').split('.'); return p.slice(/^(co|com|gc|gov|org|ac)$/.test(p.at(-2)) ? -3 : -2).join('.'); };

let seeds = null;
// The employer's own domain: from our employer list, or from a posting link on the employer's own site.
export function employerDomain(job) {
  if (!seeds) { try { seeds = JSON.parse(readAsset('catalog/seeds.json', 'utf8')).seeds || []; } catch { seeds = []; } }
  const key = companyKey(job.company);
  const s = seeds.find(x => companyKey(x.name) === key);
  if (s?.domain) return s.domain.toLowerCase();
  for (const u of [job.employerUrl, job.applyUrl, job.url]) {
    try { const h = new URL(u).hostname; if (!ATS.test(h)) return baseDomain(h); } catch {}
  }
  return null;
}

function rank(c) { // role inboxes first, then named people, then anything else on the domain
  const local = c.email.split('@')[0].replace(/[._-]/g, '');
  return (ROLE.test(local) ? 30 : 0) + (c.name ? 10 : 0) + (c.source === 'the job posting' ? 20 : 0) + (c.confidence || 0) / 10;
}

export async function findContacts(job, { hunterKey = '', get = request, robots = robotsAllows, log = () => {} } = {}) {
  const found = new Map();
  const add = c => { const k = c.email.toLowerCase(); if (!found.has(k) && !JUNK.test(k.split('@')[0])) found.set(k, c); };
  for (const e of emailsIn(job.description)) add({ email: e, source: 'the job posting' });
  const domain = employerDomain(job);
  if (domain) {
    const allow = [domain, `www.${domain}`, `careers.${domain}`, `jobs.${domain}`];
    for (const path of ['/', '/careers', '/contact', '/contact-us', '/about']) {
      const url = `https://www.${domain}${path}`;
      try {
        if (!(await robots(url, allow))) continue;
        const r = await get(url, { allow, parse: 'text', accept: 'text/html', retries: 0, gapMs: 1000, timeoutMs: 15_000 });
        // From the website, only hiring inboxes (careers@, recruiting@, talent@, hr@…), not sales or support addresses.
        for (const e of emailsIn(r.text)) if ((e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`)) && HIRING.test(e.split('@')[0])) add({ email: e, source: `${domain}${path === '/' ? '' : path}` });
      } catch (e) { log(`contacts: ${url} ${e.message}`); }
    }
    if (hunterKey) {
      try {
        const r = await get(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${encodeURIComponent(hunterKey)}`, { allow: ['api.hunter.io'], parse: 'json', retries: 0, gapMs: 0 });
        for (const h of r.json?.data?.emails || []) {
          if (!h.value) continue;
          const name = [h.first_name, h.last_name].filter(Boolean).join(' ');
          const hr = /recruit|talent|human|people|hr|hiring/i.test(`${h.position || ''} ${h.department || ''}`);
          if (h.type === 'personal' ? !hr : !HIRING.test(h.value.split('@')[0])) continue; // only people who hire, and hiring inboxes
          add({ email: h.value.toLowerCase(), name, position: h.position || '', confidence: h.confidence || 0, source: 'Hunter.io' });
        }
      } catch (e) { log(`contacts: Hunter.io ${e.message}`); }
    }
  }
  return { domain, contacts: [...found.values()].sort((a, b) => rank(b) - rank(a)).slice(0, 8) };
}

// A short, honest email built from the person's own resume lines. They review and send it themselves.
export function draftEmail({ name = '', contact = [] }, job, plan, contact0) {
  const first = contact0?.name ? contact0.name.split(' ')[0] : '';
  const best = [...(plan?.experience || []), ...(plan?.projects || [])].map(e => e.bullets[0]?.text).filter(Boolean).slice(0, 2);
  const lower = s => s.replace(/^([A-Z])(?=[a-z])/, c => c.toLowerCase()).replace(/\.$/, '');
  const lines = [
    `Hi ${first || 'there'},`,
    '',
    `I've applied for the ${plan?.headline || job.title} role at ${job.company} and wanted to introduce myself.`,
    best.length ? `Recently I ${best.map(lower).join(', and ')}.` : '',
    'I’d be glad to talk about how I could help the team. My resume is attached.',
    '',
    'Thank you,',
    name,
    ...contact.slice(0, 1),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  return { subject: `${plan?.headline || job.title} application: ${name}`.trim(), body: lines.join('\n') };
}
