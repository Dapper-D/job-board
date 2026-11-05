// Cross-checks jobs from job sites (Remotive, Remote OK, Jobicy, Himalayas) against the employer's own hiring system.
// A job-site job is kept only when the same title is found on the employer's own board; it then carries
// employerUrl (the employer's own posting) and employerVerified: true. Anything we can't confirm is dropped.
// Lookups use the same public board APIs as the scan; at most maxLookups companies a day.
import { request } from './http.mjs';
import { SOURCES } from './sources/index.mjs';
import { sameCompany, slugGuesses } from './discover.mjs';
import { titleKey, companyKey } from './job.mjs';
export { titleKey, companyKey };

export function sameTitle(a, b) {
  const x = titleKey(a), y = titleKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 12 && l.includes(s); // "Senior Backend Engineer" inside "Senior Backend Engineer, Payments"
}

// Find a company's own board by name: Greenhouse and Workable confirm the company name; for Ashby and Lever
// the board name must equal the company name, and the title match below confirms it.
export async function findBoardJobs(company) {
  const slugs = slugGuesses(company);
  for (const slug of slugs) {
    try {
      const r = await request(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`, { allow: SOURCES.greenhouse.hosts, parse: 'json', retries: 0 });
      const meta = await request(`https://boards-api.greenhouse.io/v1/boards/${slug}`, { allow: SOURCES.greenhouse.hosts, parse: 'json', retries: 0 });
      if (sameCompany(meta.json?.name, company)) return { source: 'greenhouse', target: { board: slug }, jobs: SOURCES.greenhouse.parse(r.json, { board: slug, name: company }) };
    } catch {}
  }
  for (const [source, key] of [['ashby', 'board'], ['lever', 'site']]) {
    try {
      const target = { [key]: slugs[0], name: company };
      const jobs = await SOURCES[source].fetchJobs(target);
      if (jobs.length) return { source, target: { [key]: slugs[0] }, jobs };
    } catch {}
  }
  for (const slug of slugs) {
    try {
      const r = await request(`https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`, { allow: SOURCES.workable.hosts, parse: 'json', retries: 0 });
      if (sameCompany(r.json?.name, company)) return { source: 'workable', target: { account: slug }, jobs: SOURCES.workable.parse(r.json, { account: slug }) };
    } catch {}
  }
  return null;
}

/** verifyFeedJobs(feedJobs, employerJobs) -> { verified, dropped, newBoards } */
export async function verifyFeedJobs(feedJobs, employerJobs, { maxLookups = 250, log = () => {} } = {}) {
  const byCompany = new Map();
  for (const j of employerJobs) {
    const k = companyKey(j.company);
    if (!byCompany.has(k)) byCompany.set(k, []);
    byCompany.get(k).push(j);
  }
  const verified = [], dropped = [], newBoards = [];
  const looked = new Map();
  let lookups = 0;
  for (const j of feedJobs) {
    const k = companyKey(j.company);
    let pool = byCompany.get(k);
    if (!pool && !looked.has(k) && lookups < maxLookups) {
      lookups++;
      const found = await findBoardJobs(j.company);
      looked.set(k, found);
      if (found) { pool = found.jobs; byCompany.set(k, pool); newBoards.push({ name: j.company, source: found.source, target: found.target }); log(`board for ${j.company}: ${found.source}`); }
    }
    const match = (pool || []).find(e => sameTitle(e.title, j.title));
    // The Apply link stays the job site's own (Himalayas requires its applicationLink for every Apply; the others ask
    // for a link back). The employer's own posting is kept beside it as employerUrl.
    if (match) verified.push({ ...j, employerVerified: true, employerUrl: match.url, description: j.description || match.description });
    else dropped.push({ source: j.source, company: j.company, title: j.title, why: pool ? 'title not on the employer\'s board' : 'employer board not found' });
  }
  return { verified, dropped, newBoards };
}
