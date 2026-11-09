// Avature career sites (no key needed), on <tenant>.avature.net or the employer's own host (jobs.ea.com, ...):
//   GET https://<host><path>?jobOffset=N   (path is usually /careers/SearchJobs; a page of 6 server-rendered results)
// The employer's own site, so robots.txt is checked before every page.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { robotsAllows } from '../robots.mjs';
import { makeJob, decodeEntities } from '../job.mjs';

const HOST = /^[a-z0-9][a-z0-9-]*\.avature\.net$/i;
const PAGE_SIZE = 6; // Avature shows 6 results a page and ignores requests for more
const MAX_PAGES = 50; // about 300 jobs
const DEFAULT_PATH = '/careers/SearchJobs';
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const clean = s => decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
// Some tenants mark result cards "article--result", others "article--result 1" or "article--jobs".
const ARTICLE = /<article class="article article--(?:result|jobs)\b[^"]*"[\s\S]*?<\/article>/g;

// The search path that goes with a careers link: /en_US/careers/JobDetail/... -> /en_US/careers/SearchJobs.
function searchPath(pathname) {
  const p = String(pathname || '');
  const m = p.match(/^((?:\/[A-Za-z0-9_-]+){0,3})\/(?:SearchJobs|JobDetail)\b/i);
  if (m) return `${m[1]}/SearchJobs`;
  return DEFAULT_PATH;
}

// "Posted 02-May-2026" -> ms (UTC midnight), or null.
function posted(block) {
  const m = block.match(/Posted\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  const mon = m && MONTHS[m[2].toLowerCase()];
  return m && mon !== undefined ? Date.UTC(Number(m[3]), mon, Number(m[1])) : null;
}

// Not every tenant shows a location in the list; read it when one of the usual markers is there.
function location(block) {
  const m = block.match(/list-item-location[^>]*>([\s\S]*?)<\/span>/i) ||
    block.match(/class="[^"]*\blocation\b[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|li)>/i) ||
    block.match(/glyphicon-map-marker[\s\S]{0,80}?>([^<]{2,60})</i) ||
    block.match(/icon-address[^>]*><\/span>([^<]{2,80})</i);
  return m ? clean(m[1]) : '';
}

// Result cards on one page: { id, title, url, location, postedAt }.
export function parseArticles(html, origin) {
  const out = [];
  for (const a of String(html ?? '').matchAll(ARTICLE)) {
    const block = a[0];
    // The h3 title link first ("article--jobs" cards also have a "View more" link with class="link"), then class="link", then any JobDetail link.
    const m = block.match(/article__header__text__title[^>]*>\s*<a[^>]*href="([^"]*\/JobDetail\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/) ||
      block.match(/<a[^>]*class="link"[^>]*href="([^"]*\/JobDetail\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/) ||
      block.match(/<a[^>]*href="([^"]*\/JobDetail\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    const title = clean(m[2]);
    let url;
    try { url = new URL(decodeEntities(m[1]), origin); } catch { continue; }
    if (!title || url.origin !== origin) continue; // a result never links to another host
    out.push({ id: (url.pathname.match(/\/JobDetail\/[^/]*\/(\d+)/) || [])[1] || url.pathname, title, url: url.href, location: location(block), postedAt: posted(block) });
  }
  return out;
}

const countArticles = html => (String(html ?? '').match(ARTICLE) || []).length;

// Recognise an Avature site on the employer's own host from its page (Avature's markup and asset names).
export function avatureFromPage(html, pageUrl) {
  const s = String(html ?? '');
  if (!/avature/i.test(s) && !/<article class="article article--(?:result|jobs)\b/.test(s)) return null;
  if (!/\/(?:SearchJobs|JobDetail)\/?\b/.test(s)) return null;
  let u; try { u = new URL(pageUrl); } catch { return null; }
  // The search page may be on another host of the same employer (www.ea.com -> jobs.ea.com).
  const m = s.match(/["'](?:https:\/\/([a-z0-9.-]+))?((?:\/[A-Za-z0-9_-]+){0,3}\/SearchJobs)\b/i);
  const host = (m && m[1] ? m[1] : u.hostname).toLowerCase();
  const base = u.hostname.toLowerCase().split('.').slice(-2).join('.');
  if (host !== base && !host.endsWith('.' + base) && !HOST.test(host)) return null; // only the employer's own domain, or Avature's
  return { host, path: m ? m[2] : searchPath(u.pathname) };
}

const company = t => t.name || (HOST.test(t.host) ? t.host.split('.')[0] : t.host.split('.').slice(-2)[0]);

export default {
  id: 'avature',
  label: 'Avature',
  hosts: ['*.avature.net'],
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || !HOST.test(h) || h.startsWith('www.')) return null; // www.avature.net is the vendor's own website
    return { host: h, path: searchPath(u.pathname) };
  },
  parse(html, t) {
    const origin = `https://${t.host}`;
    return parseArticles(html, origin).map(a => makeJob({
      source: 'avature', company: company(t), nativeId: a.id, title: a.title, url: a.url,
      location: a.location, postedAt: a.postedAt, // the list has no description; it is on each job's own page
    })).filter(Boolean);
  },
  async fetchJobs(t) {
    const allow = [t.host];
    const path = t.path || DEFAULT_PATH;
    const out = [], seen = new Set();
    // Most sites page with jobOffset; some (jobs.siemens.com) ignore it and use offset. Switch once if page 2 adds nothing.
    let key = 'jobOffset', canSwitch = true;
    const page = async (k, p) => {
      const url = `https://${t.host}${path}?${k}=${p * PAGE_SIZE}`;
      if (!(await robotsAllows(url, allow))) throw new Error(`${t.host} robots.txt does not allow reading its job list`);
      const r = await request(url, { allow, parse: 'text', accept: 'text/html', gapMs: 1000 });
      return { html: r.text, jobs: this.parse(r.text, t) };
    };
    // Adds the jobs not seen before; returns how many.
    const take = jobs => { const fresh = jobs.filter(j => !seen.has(j.id)); fresh.forEach(j => { seen.add(j.id); out.push(j); }); return fresh.length; };
    for (let p = 0; p < MAX_PAGES; p++) {
      let r = await page(key, p);
      let fresh = take(r.jobs);
      if (!fresh && canSwitch && p === 1) {
        canSwitch = false;
        const alt = await page('offset', p);
        const altFresh = take(alt.jobs);
        if (altFresh) { key = 'offset'; r = alt; fresh = altFresh; }
      }
      if (p === 0 && !r.jobs.length && /\/JobDetail\/[^"'\s]+/i.test(r.html)) throw new Error('Avature changed its job list page (job links found but no results could be read)');
      if (!fresh || countArticles(r.html) < PAGE_SIZE) break;
    }
    return out;
  },
};
