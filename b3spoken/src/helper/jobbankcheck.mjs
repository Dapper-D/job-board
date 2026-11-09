// Checks Job Bank from this computer, the same way B3spoken fetches it, and explains the result in plain words.
// Used by the board's "Check Job Bank now" button and by scripts/jobbank-check.mjs.
// Two requests (robots.txt and one search), 5 seconds apart, as Job Bank's robots.txt asks.
import { request as defaultRequest, sleep } from '../scan/http.mjs';
import SOURCE from '../scan/sources/jobbank.mjs';

const HOSTS = ['www.jobbank.gc.ca'];

export async function checkJobBank({ keyword = 'software developer', request = defaultRequest, wait = sleep } = {}) {
  const lines = [];
  const fail = (what, e) => lines.push({ ok: false, text: `${what}: ${e.code ? `${e.code} ` : ''}${e.message}` });
  try {
    const r = await request('https://www.jobbank.gc.ca/robots.txt', { allow: HOSTS, parse: 'text', retries: 0, accept: 'text/plain' });
    lines.push({ ok: true, text: `Job Bank's website answered (HTTP ${r.status}).` });
  } catch (e) { fail('Job Bank\'s website', e); }
  await wait(5000);
  try {
    const qs = new URLSearchParams({ searchstring: keyword, locationstring: '', sort: 'D', page: '1' });
    const r = await request(`https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed?${qs}`, { allow: HOSTS, parse: 'text', retries: 0, accept: 'application/atom+xml, application/xml' });
    const jobs = SOURCE.parse(r.text);
    if (jobs.length) lines.push({ ok: true, text: `The job search answered with ${jobs.length} postings for "${keyword}"${jobs[0].postedAt ? `, newest from ${jobs[0].postedAt.slice(0, 10)}` : ''}.` });
    else lines.push({ ok: false, text: 'The job search answered but had no postings: its format may have changed. Tell the maintainer.' });
  } catch (e) { fail('Job Bank\'s job search', e); }
  const ok = lines.every(l => l.ok);
  const reset = lines.some(l => /ECONNRESET|socket hang up/i.test(l.text));
  const advice = ok ? 'Job Bank works from this computer.'
    : reset ? 'Job Bank cut the connection. This is common on VPNs, work or school networks. Turn off any VPN and try again on your home connection. B3spoken never disguises itself to get around this.'
    : 'Job Bank didn\'t work from this computer. Check the internet connection and try again later.';
  return { ok, lines, advice, at: new Date().toISOString() };
}
