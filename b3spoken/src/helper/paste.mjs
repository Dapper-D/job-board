// "Paste a link": checks a job link against the employer's own hiring system before it is added.
// 1. Already in the person's list? Use that.
// 2. A link to a hiring system we read (Greenhouse, Lever, Ashby, Workday, …, or an employer in our catalog)?
//    Fetch that employer's live job list and find the posting in it. Found = verified and still open.
// 3. Anything else (LinkedIn, Indeed, Glassdoor, a recruiter's page) is not fetched: the person is asked for
//    the employer's own link instead.
// Postings older than 72 hours are refused, like the old kit did, so applications go to fresh postings.
import { readFileSync, existsSync } from 'node:fs';
import { readAsset } from './assets.mjs';
import { SOURCES, detect } from '../scan/sources/index.mjs';
import { urlKey } from '../scan/job.mjs';

const BLOCKED = /(^|\.)(linkedin\.com|indeed\.(com|ca)|glassdoor\.(com|ca)|ziprecruiter\.com|monster\.(com|ca)|simplyhired\.(com|ca)|talent\.com|jooble\.org)$/i;
const MAX_AGE_MS = 72 * 3600e3;

let catalog = null;
function catalogFor(host, file) {
  if (!catalog || file) {
    let text = null;
    try { text = file ? (existsSync(file) ? readFileSync(file, 'utf8') : null) : readAsset('catalog/employers.json', 'utf8'); } catch {}
    const list = text ? JSON.parse(text).employers || [] : [];
    if (file) return list.find(e => e.target?.host && String(e.target.host).toLowerCase() === host);
    catalog = list;
  }
  return catalog.find(e => e.target?.host && String(e.target.host).toLowerCase() === host);
}

const err = (status, message) => Object.assign(new Error(message), { status });

export async function checkLink(raw, { jobs = [], catalogFile, now = Date.now(), sources = SOURCES } = {}) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw err(400, 'That isn’t a web link.'); }
  if (u.protocol !== 'https:') throw err(400, 'Only https links can be checked.');
  if (BLOCKED.test(u.hostname)) throw err(422, `B3spoken doesn’t read ${u.hostname.replace(/^www\./, '')}. Open the job on the employer’s own careers site and paste that link instead.`);
  const key = urlKey(u.href);
  const known = jobs.find(j => urlKey(j.url) === key || urlKey(j.applyUrl) === key || (j.employerUrl && urlKey(j.employerUrl) === key));
  if (known) return { job: known, how: 'already in your list' };
  const hit = detect(u.href);
  let source = hit?.source, target = hit?.target, name;
  if (!hit || source === 'jobbank') {
    const e = catalogFor(u.hostname.toLowerCase(), catalogFile);
    if (!e) throw err(422, 'B3spoken can’t check this site yet. Paste the link from the employer’s own hiring page (for example a Greenhouse, Lever, Workday or company careers link).');
    ({ source, target, name } = e);
  }
  const src = sources[source];
  const list = await src.fetchJobs({ name, ...target });
  const idInUrl = (u.pathname.match(/\d{4,}/g) || []);
  const job = list.find(j => urlKey(j.url) === key || urlKey(j.applyUrl) === key)
    || list.find(j => idInUrl.some(id => String(j.url).includes(id)));
  if (!job) throw err(404, 'That posting isn’t on the employer’s live job list, so it may be closed or the link may be wrong.');
  const posted = Date.parse(job.postedAt);
  if (Number.isFinite(posted) && now - posted > MAX_AGE_MS) throw err(422, `That posting is from ${new Date(posted).toDateString()}, more than 72 hours ago. B3spoken only tailors for fresh postings.`);
  return { job: { ...job, pasted: true, employerVerified: true }, how: `found on ${src.label || source}` };
}
