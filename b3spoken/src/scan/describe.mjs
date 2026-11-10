// Job descriptions the job lists leave out. Workday, SuccessFactors, Avature and a few other hiring systems list
// only titles and places; the posting itself is on each job's own page. The daily scan reads those pages for
// jobs that could reach someone's board (seen in the last 14 days), a few thousand a day, and remembers what it
// read, so a job's page is read once, not every day:
//   - a description read on an earlier day comes forward from the last published pool;
//   - a page that gave nothing is tried again after MISS_RETRY_DAYS.
// Without a description, a job can only be matched on its title, and nobody can check it for hidden instructions
// to AI or a "don't use AI" rule before documents are made.
import { request } from './http.mjs';
import { robotsAllows } from './robots.mjs';
import { htmlToText, decodeEntities, salaryFromText } from './job.mjs';

export const DESCRIBE_PER_DAY = 3000, DESCRIBE_WINDOW_DAYS = 14, MISS_RETRY_DAYS = 7, DESCRIBE_MINUTES = 35;
const DESCRIPTION_MAX = 8000;
const clip = s => (s.length > DESCRIPTION_MAX ? s.slice(0, DESCRIPTION_MAX) + '…' : s);
const MIN_CHARS = 80; // less than this is a label or a cookie notice, not a job posting

// ---- Reading a description out of a job's web page ----

// The element that starts at `start` (an opening tag), up to its matching closing tag.
function element(html, start) {
  const open = html.slice(start).match(/^<([a-z][a-z0-9]*)\b/i);
  if (!open) return '';
  const tag = open[1].toLowerCase(), re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html));) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return html.slice(start, start + 60000);
}

// The longest string under a "description"-like key anywhere in a JSON value (Next.js page data and the like).
function longestDescription(v, depth = 0) {
  let best = '';
  if (!v || typeof v !== 'object' || depth > 12) return best;
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'string' && /^(description|descriptionHtml|jobDescription|job_description|descriptionPlain|content)$/i.test(k) && x.length > best.length) best = x;
    else if (x && typeof x === 'object') { const y = longestDescription(x, depth + 1); if (y.length > best.length) best = y; }
  }
  return best;
}

/** The job posting's text from its web page, or '' when the page has none we can find. */
export function descriptionFromHtml(html) {
  const s = String(html || '');
  // 1. Structured data many hiring systems add for search engines: a JobPosting with its description.
  for (const m of s.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      for (const d of [].concat(data, data?.['@graph'] || [])) {
        if (d && /JobPosting/i.test([].concat(d['@type'] || '').join(' ')) && d.description) {
          const t = htmlToText(decodeEntities(String(d.description)));
          if (t.length >= MIN_CHARS) return t;
        }
      }
    } catch {}
  }
  // 2. Page data of single-page sites (Next.js and similar).
  for (const m of s.matchAll(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const t = htmlToText(longestDescription(JSON.parse(m[1]))); if (t.length >= MIN_CHARS) return t; } catch {}
  }
  // 3. Marked-up page parts: schema.org microdata, then the class names the common hiring systems use.
  const marks = [/<[a-z][a-z0-9]*\b[^>]*\bitemprop=["']description["'][^>]*>/i,
    /<[a-z][a-z0-9]*\b[^>]*\bclass=["'][^"']*\b(?:jobdescription|job-description|jobDescription|job_description|jobDescriptionText|description__text|job-details__description|article__content)\b[^"']*["'][^>]*>/i,
    /<[a-z][a-z0-9]*\b[^>]*\bid=["'](?:jobdescription|job-description|jobDescription|job_description|content)["'][^>]*>/i];
  for (const re of marks) {
    const m = s.match(re);
    if (m) { const t = htmlToText(element(s, m.index)); if (t.length >= MIN_CHARS) return t; }
  }
  return '';
}

// ---- One job, by hiring system ----

const siteOf = host => { const l = host.split('.'); return l.slice(/^(gc|co|com|gov|org|on|bc|qc|ab)$/.test(l.at(-2)) ? -3 : -2).join('.'); };
const allowFor = host => [host, siteOf(host), `*.${siteOf(host)}`];

/** The JSON address of a Workday job, from its page address: https://<tenant>.wdN.myworkdayjobs.com/<site>/job/… */
export function workdayDetailUrl(url) {
  const u = new URL(url);
  const [site, ...rest] = u.pathname.split('/').filter(Boolean);
  if (!site || rest[0] !== 'job') return null;
  return `https://${u.hostname}/wday/cxs/${u.hostname.split('.')[0]}/${site}/${rest.join('/')}`;
}
/** Oracle Recruiting Cloud: …/CandidateExperience/<lang>/sites/<site>/job/<id> */
export function oracleDetailUrl(url) {
  const u = new URL(url);
  const m = u.pathname.match(/\/sites\/([^/]+)\/job\/([^/?#]+)/);
  return m ? `https://${u.hostname}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${encodeURIComponent(m[2])}%22,siteNumber=${encodeURIComponent(m[1])}` : null;
}

const iso = v => { const t = Date.parse(v || ''); return Number.isFinite(t) && t <= Date.now() + 2 * 864e5 ? new Date(t).toISOString() : null; };

const READERS = {
  async workday(j) {
    const api = workdayDetailUrl(j.url); if (!api) return null;
    const i = (await request(api, { allow: ['*.myworkdayjobs.com'], parse: 'json', gapMs: 400, retries: 1 })).json?.jobPostingInfo || {};
    return { description: htmlToText(i.jobDescription || ''), postedAt: iso(i.startDate) };
  },
  async oraclecloud(j) {
    const api = oracleDetailUrl(j.url); if (!api) return null;
    const r = (await request(api, { allow: ['*.oraclecloud.com'], parse: 'json', gapMs: 300, retries: 1 })).json?.items?.[0] || {};
    return { description: htmlToText([r.ExternalDescriptionStr, r.ExternalResponsibilitiesStr, r.ExternalQualificationsStr].filter(Boolean).join('\n')), postedAt: iso(r.ExternalPostedStartDate) };
  },
  async bamboohr(j) {
    const u = new URL(j.url);
    const o = (await request(`${u.origin}${u.pathname.replace(/\/$/, '')}/detail`, { allow: ['*.bamboohr.com'], parse: 'json', gapMs: 400, retries: 1 })).json?.result?.jobOpening || {};
    return { description: htmlToText(o.description || ''), postedAt: iso(o.datePosted) };
  },
  // Everything else: the job's own web page, where robots.txt allows reading it.
  async page(j) {
    const u = new URL(j.url), allow = allowFor(u.hostname);
    if (!(await robotsAllows(u.href, allow))) return { description: '', robots: true };
    return { description: descriptionFromHtml((await request(u.href, { allow, parse: 'text', accept: 'text/html', gapMs: 600, retries: 1 })).text) };
  },
};
// Hiring systems whose lists come without descriptions. Feeds and APIs that include them aren't read again.
export const DESCRIBE_SOURCES = { workday: 'workday', oraclecloud: 'oraclecloud', bamboohr: 'bamboohr', successfactors: 'page', avature: 'page', eightfold: 'page', rippling: 'page', google: 'page', apple: 'page', taleo: 'page', lever: 'page' };

export async function describeJob(j) {
  const how = DESCRIBE_SOURCES[j.source];
  return how ? READERS[how](j) : null;
}

// ---- The daily pass ----

/**
 * describeMissing(pool, previous, misses, opts) fills in pool jobs' empty descriptions, in place.
 *   previous: Map of job id -> description from the last published pool (read on an earlier day)
 *   misses:   { jobId: 'YYYY-MM-DD' } pages that gave nothing, tried again after MISS_RETRY_DAYS
 * Returns { carried, read, missed, skipped, left, misses } (misses is kept for tomorrow, only for open jobs).
 */
export async function describeMissing(pool, previous = new Map(), misses = {}, { today = new Date().toISOString().slice(0, 10), perDay = DESCRIBE_PER_DAY, minutes = DESCRIBE_MINUTES, concurrency = 8, read = describeJob, log = () => {}, now = Date.now() } = {}) {
  const out = { carried: 0, read: 0, missed: 0, skipped: 0, left: 0, misses: {} };
  const open = new Set(pool.map(j => j.id));
  for (const [id, d] of Object.entries(misses)) if (open.has(id) && (Date.parse(today) - Date.parse(d)) / 864e5 < MISS_RETRY_DAYS) out.misses[id] = d;
  const fill = (j, got) => {
    j.description = clip(got.description);
    if (!j.postedAt && got.postedAt) j.postedAt = got.postedAt;
    if (!j.salary) { const pay = salaryFromText(j.description); if (pay) j.salary = pay; }
  };
  const todo = [];
  for (const j of pool) {
    if (j.description || !DESCRIBE_SOURCES[j.source]) continue;
    const before = previous.get(j.id);
    if (before) { fill(j, { description: before }); out.carried++; continue; }
    const seen = Date.parse(j.postedAt || j.firstSeen || today);
    if (seen < now - DESCRIBE_WINDOW_DAYS * 864e5) { out.skipped++; continue; } // too old to reach a board
    if (out.misses[j.id]) { out.skipped++; continue; }
    todo.push(j);
  }
  // Newest first, so the jobs people see first get their descriptions first.
  todo.sort((a, b) => String(b.postedAt || b.firstSeen || '').localeCompare(String(a.postedAt || a.firstSeen || '')));
  const queue = todo.slice(0, perDay);
  out.left = todo.length - queue.length;
  const stopAt = Date.now() + minutes * 60e3;
  // Different hosts in parallel; one host's pages one at a time (the http client also spaces requests per host).
  const byHost = new Map();
  for (const j of queue) { const h = new URL(j.url).hostname; if (!byHost.has(h)) byHost.set(h, []); byHost.get(h).push(j); }
  const hosts = [...byHost.values()];
  async function worker() {
    for (let list; (list = hosts.shift());) {
      let fails = 0;
      for (const j of list) {
        if (Date.now() > stopAt || fails >= 15) { out.left++; continue; } // out of time, or this host refuses us today
        try {
          const got = await read(j);
          if (got?.description && got.description.length >= MIN_CHARS) { fill(j, got); out.read++; fails = 0; }
          else { out.misses[j.id] = today; out.missed++; fails++; }
        } catch { out.misses[j.id] = today; out.missed++; fails++; }
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  log(`Descriptions: ${out.read} read from job pages, ${out.carried} kept from earlier days, ${out.missed} pages gave none, ${out.left} left for tomorrow`);
  return out;
}

// Descriptions from the last published pool (job-pool release), by job id. A local file can be given instead.
export async function previousDescriptions(file, repo = process.env.GITHUB_REPOSITORY || 'Dapper-D/job-board') {
  const { gunzipSync } = await import('node:zlib');
  try {
    let gz;
    if (file) gz = (await import('node:fs')).readFileSync(file);
    else {
      const r = await fetch(`https://github.com/${repo}/releases/download/job-pool/pool.json.gz`, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) return new Map();
      gz = Buffer.from(await r.arrayBuffer());
    }
    const jobs = JSON.parse(gunzipSync(gz)).jobs || [];
    return new Map(jobs.filter(j => j.description && DESCRIBE_SOURCES[j.source]).map(j => [j.id, j.description]));
  } catch { return new Map(); }
}
