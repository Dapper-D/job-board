// Job Bank (Government of Canada) public search feed, Atom XML, no key needed.
// Runs on each person's own computer (runsOn: 'helper'), with their own search keywords:
// Job Bank refuses connections from cloud servers such as GitHub's, and we don't disguise the scanner to get around that.
// Results come newest first; we stop at the first page whose postings are all older than maxAgeDays (default 3),
// so a daily run is usually one or two pages per keyword.
// robots.txt asks for 5 seconds between requests, so we wait 5 s before every request.
// A search returns 100 postings per page; a short page means the end.
import { request } from '../http.mjs';
import { makeJob, decodeEntities, htmlToText } from '../job.mjs';

const HOSTS = ['www.jobbank.gc.ca'];
const FEED = 'https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed';
const PAGE = 100;

const cdata = s => String(s ?? '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')); return m ? cdata(m[1]) : ''; };
const field = (html, label) => { const m = html.match(new RegExp(`<strong>\\s*${label}\\s*:?\\s*</strong>\\s*:?\\s*([\\s\\S]*?)\\s*(?:<br\\s*/?>|$)`, 'i')); return m ? htmlToText(m[1]) : ''; };
const altLink = block => {
  const links = block.match(/<link\b[^>]*>/gi) || [];
  const attrs = l => Object.fromEntries([...l.matchAll(/\s([a-z]+)\s*=\s*"([^"]*)"/gi)].map(m => [m[1].toLowerCase(), m[2]]));
  const all = links.map(attrs);
  return decodeEntities((all.find(a => (a.rel || 'alternate') === 'alternate') || all[0] || {}).href || '');
};

export default {
  id: 'jobbank',
  label: 'Job Bank (Canada)',
  runsOn: 'helper',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const m = u.hostname === 'www.jobbank.gc.ca' && u.pathname.match(/\/jobposting\/(\d+)/);
    return m ? { posting: m[1] } : null;
  },
  parse(xml) {
    const entries = String(xml ?? '').match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) || [];
    return entries.map(e => {
      const url = altLink(e);
      if (!/^https:\/\/www\.jobbank\.gc\.ca\//.test(url)) return null;
      const summary = decodeEntities(tag(e, 'summary'));
      const id = (url.match(/jobposting\/(\d+)/) || [])[1];
      return makeJob({
        source: 'jobbank', company: field(summary, 'Employer'), nativeId: id,
        title: htmlToText(decodeEntities(tag(e, 'title'))), url,
        location: field(summary, 'Location').replace(/\s*\(([A-Z]{2})\)\s*$/, ', $1').replace(/,? *$/, '') || 'Canada',
        postedAt: tag(e, 'updated'),
        salary: field(summary, 'Salary'),
      });
    }).filter(Boolean).map(j => ({ ...j, canada: true }));
  },
  // target: { keywords: ['software developer', ...] or [''] for everything, maxPages, maxAgeDays }
  async fetchJobs(target, { now = Date.now() } = {}) {
    const keywords = target.keywords?.length ? target.keywords : [''];
    const maxPages = Math.min(target.maxPages || 5, 200);
    const cutoff = now - (target.maxAgeDays ?? 3) * 864e5;
    const seen = new Map();
    for (const kw of keywords) {
      for (let p = 1; p <= maxPages; p++) {
        const qs = new URLSearchParams({ searchstring: kw, locationstring: '', sort: 'D', page: String(p) });
        const r = await request(`${FEED}?${qs}`, { allow: HOSTS, parse: 'text', gapMs: 5000, accept: 'application/atom+xml, application/xml' });
        const got = this.parse(r.text);
        for (const j of got) seen.set(j.url, j);
        const allOld = got.length && got.every(j => j.postedAt && Date.parse(j.postedAt) < cutoff);
        if (got.length < PAGE || allOld) break;
      }
    }
    // Keep only postings inside the window (undated ones are kept and checked later).
    return [...seen.values()].filter(j => !j.postedAt || Date.parse(j.postedAt) >= cutoff);
  },
};
