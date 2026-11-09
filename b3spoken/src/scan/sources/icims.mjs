// Classic hosted iCIMS job portals (no key needed): https://careers-<tenant>.icims.com/jobs/search?ss=1
//   GET https://<host>/jobs/search?ss=1&pr=N&in_iframe=1   (server-rendered pages of about 20 job cards; pr counts from 0)
// iCIMS sites built on Jibe are a different system: see jibe.mjs.
// robots.txt is checked before every page. The list has no posting dates (they are only on each job's own page).
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { robotsAllows } from '../robots.mjs';
import { makeJob, decodeEntities, htmlToText } from '../job.mjs';

const HOST = /^[a-z0-9][a-z0-9-]*\.icims\.com$/i;
// iCIMS's own company website, product and help hosts are not job portals; careers.icims.com is iCIMS's own (Jibe) careers site.
const NOT_PORTAL = /^(www|icims|careers|jobs|community|developer|developers|help|support|care|login|api|cdn|static|marketplace|go|info|blog|investors|status)\./i;
const MAX_PAGES = 30;
const COUNTRY = { US: 'United States', CA: 'Canada' };
const clean = s => decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// iCIMS writes places as Country-Region-City ("CA-ON-Toronto"); turn that into "Toronto, ON, Canada".
export function icimsPlace(raw) {
  const s = clean(raw);
  const m = s.match(/^([A-Z]{2})-([A-Z0-9]{1,3})-(.+)$/);
  return m ? `${m[3]}, ${m[2]}, ${COUNTRY[m[1]] || m[1]}` : s;
}

// Job cards on one search page: { id, title, url, location, description }.
export function parseCards(html, origin) {
  const out = [];
  for (const card of String(html ?? '').split('iCIMS_JobCardItem').slice(1)) {
    const href = card.match(/href="([^"]*\/jobs\/(\d+)\/[^"/]+\/job[^"]*)"/);
    if (!href) continue;
    let u;
    try { u = new URL(decodeEntities(href[1]), origin); } catch { continue; }
    if (u.origin !== origin) continue; // a portal never links a job on another host
    const title = clean((card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
    if (!title) continue;
    // The location is the span after a "Location" label ("Location", "Location : Country", ...).
    const loc = card.match(/<span\b[^>]*class=["'][^"']*(?<![\w-])field-label(?![\w-])[^"']*["'][^>]*>\s*Location\b[^<]*<\/span>\s*<span\b[^>]*>([\s\S]*?)<\/span>/);
    const desc = card.match(/class=["'][^"']*\bdescription\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/);
    out.push({ id: href[2], title, url: `${u.origin}${u.pathname}`, location: loc ? icimsPlace(loc[1]) : '', description: desc ? htmlToText(desc[1]) : '' });
  }
  return out;
}

const company = t => t.name || t.host.replace(/\.icims\.com$/i, '').replace(/^(?:(?:us|ca|global|external)?careers|jobs|external)-/i, '');

export default {
  id: 'icims',
  label: 'iCIMS',
  hosts: ['*.icims.com'],
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || !HOST.test(h) || NOT_PORTAL.test(h)) return null;
    // A portal link is the portal root or something under /jobs.
    return u.pathname === '/' || /^\/jobs(?:\/|$)/i.test(u.pathname) ? { host: h } : null;
  },
  parse(html, t) {
    return parseCards(html, `https://${t.host}`).map(c => makeJob({
      source: 'icims', company: company(t), nativeId: c.id, title: c.title, url: c.url, location: c.location, description: c.description,
    })).filter(Boolean);
  },
  async fetchJobs(t) {
    const allow = [t.host];
    const out = [];
    let firstUrl = null;
    for (let p = 0; p < MAX_PAGES; p++) {
      const url = `https://${t.host}/jobs/search?ss=1&pr=${p}&in_iframe=1`;
      if (!(await robotsAllows(url, allow))) throw new Error(`${t.host} robots.txt does not allow reading its job list`);
      const r = await request(url, { allow, parse: 'text', accept: 'text/html', gapMs: 1000 });
      const got = this.parse(r.text, t);
      if (p === 0 && !got.length && /\/jobs\/\d+\/[^"'/\s]+\/job/.test(r.text)) throw new Error('iCIMS changed its job list page (job links found but no cards could be read)');
      // Past the last page some portals send the last page again instead of an empty one.
      if (!got.length || got[0].url === firstUrl) break;
      firstUrl = got[0].url;
      out.push(...got);
    }
    return out;
  },
};
