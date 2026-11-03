import { safeFetch } from './safefetch.mjs';
// Fetch a job posting page and pull out what we can without AI.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Applicant tracking systems. A posting hosted on one of these is the employer's own posting.
export const ATS_HOSTS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com', 'myworkdaysite.com', 'workday.com', 'smartrecruiters.com',
  'workable.com', 'icims.com', 'jobvite.com', 'bamboohr.com', 'breezy.hr', 'recruitee.com', 'teamtailor.com', 'applytojob.com',
  'taleo.net', 'oraclecloud.com', 'successfactors.com', 'successfactors.eu', 'jobs2web.com', 'dayforcehcm.com', 'ultipro.com', 'ultipro.ca',
  'adp.com', 'eightfold.ai', 'phenompeople.com', 'rippling.com', 'pinpointhq.com', 'dover.com', 'gem.com', 'jazzhr.com', 'paylocity.com',
  'personio.de', 'personio.com', 'comeet.com', 'avature.net', 'csod.com', 'amazon.jobs', 'jibeapply.com', 'hrsmart.com', 'peopleadmin.com', 'njoyn.com',
];
// Aggregators and boards: fine for finding jobs, not proof the job is real.
export const BOARD_HOSTS = ['linkedin.com', 'indeed.com', 'indeed.ca', 'glassdoor.com', 'glassdoor.ca', 'ziprecruiter.com', 'talent.com', 'monster.com',
  'monster.ca', 'simplyhired.com', 'simplyhired.ca', 'workopolis.com', 'eluta.ca', 'jobbank.gc.ca', 'builtin.com', 'builtinvancouver.org', 'builtinlondon.uk',
  'careerbeacon.com', 'wellfound.com', 'remotive.com', 'himalayas.app', 'remoteok.com', 'weworkremotely.com', 'workingnomads.com', 'jobicy.com',
  'themuse.com', 'getro.com', 'dice.com', 'welcometothejungle.com', 'ycombinator.com', 'workatastartup.com', 'news.ycombinator.com'];
const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'forms.gle', 'shorturl.at', 'rb.gy', 'cutt.ly', 'is.gd'];

export const hostOf = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const onHost = (h, list) => list.some(d => h === d || h.endsWith('.' + d));
export const normUrl = u => String(u || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');

export function classifyHost(url, company) {
  const h = hostOf(url);
  if (!h) return 'invalid';
  if (onHost(h, SHORTENERS)) return 'shortener';
  if (onHost(h, ATS_HOSTS)) return 'ats';
  if (onHost(h, BOARD_HOSTS)) return 'board';
  const slug = String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (slug.length >= 3 && h.replace(/[^a-z0-9]/g, '').includes(slug.slice(0, Math.min(slug.length, 10)))) return 'employer';
  return 'unknown';
}

const CLOSED = [
  /no longer (accepting|available|open)/i, /position (has been )?(filled|closed)/i, /job (is )?(no longer|not) (available|found)/i,
  /this (job|posting|position|requisition) (has )?(expired|closed|been removed)/i, /applications? (are|is) (now )?closed/i,
  /the page you are looking for (doesn.t|does not) exist/i, /we couldn.t find (that|this) job/i, /job not found/i,
];

function decode(s) {
  return String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
export function htmlToText(html) {
  return decode(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '\n- ').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

// Text a person can't see but an AI reading the page would (hidden styles, zero-size or white text),
// kept only when it looks aimed at AI tools. Employers use this to catch AI-written applications.
const HIDDEN_STYLE = /(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px|pt|em|rem)?\s*(?:;|"|')|opacity\s*:\s*0(?:\.0+)?\s*(?:;|"|')|color\s*:\s*(?:#fff(?:fff)?|white|rgba?\(\s*255\s*,\s*255\s*,\s*255)|height\s*:\s*0|width\s*:\s*0|left\s*:\s*-\d{3,}px)/i;
const AI_AIMED = /\b(ai|a\.i\.|chatgpt|gpt|llm|language model|claude|gemini|copilot|assistant|bot)\b|ignore (all |any )?(previous|prior|above)|include the (word|phrase)|mention (the word|that you)|use the (word|phrase)|if you are (reading|an?)/i;
export function hiddenText(html) {
  const out = [];
  const src = String(html || '').slice(0, 3_000_000), lower = src.toLowerCase();
  const re = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let m, n = 0;
  while ((m = re.exec(src)) && n++ < 50000) {
    const attrs = m[2];
    const style = (attrs.match(/style\s*=\s*("[^"]*"|'[^']*')/i) || [])[1] || '';
    const hiddenAttr = /\shidden(\s|=|$)|aria-hidden\s*=\s*["']true/i.test(attrs);
    if (!(HIDDEN_STYLE.test(style + ';') || hiddenAttr || /class\s*=\s*["'][^"']*\b(sr-only|visually-hidden|hidden)\b/i.test(attrs))) continue;
    const end = lower.indexOf('</' + m[1].toLowerCase(), re.lastIndex);
    if (end < 0) continue;
    const t = htmlToText(src.slice(re.lastIndex, Math.min(end, re.lastIndex + 20000))).replace(/\s+/g, ' ').trim();
    if (t.length >= 8 && t.length <= 1500 && AI_AIMED.test(t) && !out.includes(t)) out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

function findJobPosting(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const walk = x => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk);
        const t = x['@type']; if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) out.push(x); if (x['@graph']) walk(x['@graph']); };
      walk(JSON.parse(m[1].trim()));
    } catch {}
  }
  return out[0] || null;
}

function ldLocation(jp) {
  const locs = [].concat(jp.jobLocation || []).map(l => { const a = (l && l.address) || {}; return [a.addressLocality, a.addressRegion, a.addressCountry && (a.addressCountry.name || a.addressCountry)].filter(Boolean).join(', '); }).filter(Boolean);
  const remote = /telecommute/i.test(String(jp.jobLocationType || ''));
  return (remote ? 'Remote' + (locs.length ? ' / ' : '') : '') + locs.join(' | ');
}
function ldSalary(jp) {
  const b = jp.baseSalary; if (!b) return '';
  const v = b.value || {}; const cur = b.currency || v.currency || '';
  const unit = (v.unitText || '').toLowerCase();
  const lo = v.minValue ?? v.value, hi = v.maxValue;
  if (lo == null && hi == null) return '';
  return [cur, lo, hi != null && hi !== lo ? '-' + hi : '', unit ? '/' + unit : ''].join(' ').replace(/\s+/g, ' ').trim();
}

export async function fetchPosting(url, { timeoutMs = 20000 } = {}) {
  let u; try { u = new URL(url); } catch { return { ok: false, reason: 'not a valid link' }; }
  if (u.protocol !== 'https:' && !(process.env.KIT_ALLOW_HTTP === '1' && u.hostname === '127.0.0.1')) return { ok: false, reason: 'not an https link' };
  let r, html = '';
  try {
    r = await safeFetch(u.href, { timeoutMs, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'en-CA,en;q=0.9' } });
    html = r.body;
  } catch (e) { return { ok: false, reason: 'could not open the page (' + (e.name === 'AbortError' ? 'timed out' : e.message) + ')' }; }
  const finalUrl = r.url || u.href;
  if (r.status === 404 || r.status === 410) return { ok: true, closed: true, closedReason: 'page removed (' + r.status + ')', finalUrl, status: r.status };
  if (r.status >= 400) return { ok: false, reason: 'site returned ' + r.status + (r.status === 403 ? ' (blocks automated checks)' : ''), finalUrl, status: r.status };
  const jp = findJobPosting(html);
  const text = htmlToText(html);
  const titleTag = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  const ogTitle = decode((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1] || '');
  const closedHit = CLOSED.find(re => re.test(text.slice(0, 20000)));
  let expired = false;
  if (jp && jp.validThrough) { const d = new Date(jp.validThrough); if (!isNaN(d) && d.getTime() < Date.now() - 86400000) expired = true; }
  const thin = text.length < 400 && !jp;
  return {
    ok: true, finalUrl, status: r.status, thin,
    closed: !!closedHit || expired, closedReason: closedHit ? 'page says it is closed' : expired ? 'past its closing date' : '',
    title: (jp && jp.title) || ogTitle || titleTag,
    company: (jp && jp.hiringOrganization && (jp.hiringOrganization.name || jp.hiringOrganization)) || '',
    companyUrl: (jp && jp.hiringOrganization && (jp.hiringOrganization.sameAs || jp.hiringOrganization.url)) || '',
    location: jp ? ldLocation(jp) : '',
    salary: jp ? ldSalary(jp) : '',
    posted: jp && jp.datePosted ? String(jp.datePosted).slice(0, 10) : '',
    closes: jp && jp.validThrough ? String(jp.validThrough).slice(0, 10) : '',
    employmentType: jp ? [].concat(jp.employmentType || []).join(', ') : '',
    text: (jp && jp.description ? htmlToText(jp.description) + '\n\n' : '') + text,
    hidden: hiddenText(html).concat(jp && jp.description ? hiddenText(decode(jp.description)) : []).slice(0, 5),
  };
}

// Scam and ghost-job signals we can spot without AI. Observations, not accusations.
export function ruleSignals(p, url) {
  const t = (p.text || '').slice(0, 40000);
  const sig = [];
  const add = (s, w) => sig.push({ s, w });
  if (/whatsapp|telegram|signal app|text (me|us) at/i.test(t)) add('Asks to move the conversation to WhatsApp, Telegram or text', 'Concerning');
  if (/(gift ?cards?|bitcoin|crypto(currency)? payment|western union|wire (the )?funds)/i.test(t)) add('Mentions gift cards, crypto or wiring money', 'Concerning');
  if (/(pay|fee).{0,40}(training|equipment|starter kit|background check)/i.test(t)) add('Mentions paying for training, equipment or checks', 'Concerning');
  if (/@(gmail|yahoo|hotmail|outlook)\.com/i.test(t)) add('Recruiter contact on a personal email domain', 'Concerning');
  // Text aimed at AI tools is usually an employer's trap for AI-written applications, not a scam sign.
  if ((p.hidden || []).length || /(ignore (all|any|previous) instructions|if you are an ai|you are an ai|as an ai model)/i.test(t)) add('Posting contains text aimed at AI tools', 'Neutral');
  if (/independent contractor|1099|t4a|self-employed|invoice for services/i.test(t)) add('Contractor wording, check it is real employment', 'Neutral');
  if (/talent (pool|pipeline|community)|evergreen|future opportunities/i.test(t)) add('Talent-pipeline or evergreen posting', 'Neutral');
  if (p.salary) add('Pay range is posted', 'Positive');
  if (p.posted) { const d = Math.round((Date.now() - new Date(p.posted).getTime()) / 86400000); if (d > 90) add('Posted more than 3 months ago', 'Concerning'); else if (d <= 14) add('Posted in the last 2 weeks', 'Positive'); }
  const kind = classifyHost(p.finalUrl || url, p.company);
  if (kind === 'ats' || kind === 'employer') add("Hosted on the employer's own careers system", 'Positive');
  if (kind === 'shortener') add('Link goes through a URL shortener', 'Concerning');
  return sig;
}
