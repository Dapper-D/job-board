// PageUp careers sites on the vendor host (no key needed): https://careers.pageuppeople.com/<tenant>/<site>/<lang>/listing/
// <tenant> is a number, <site> is usually "cw", <lang> a locale ("en", "en-us", "zh-c"). Universities, banks, councils.
// The listing is a server-made HTML table. Columns differ per employer, so we only read the posting links
// (<a class="job-link" href="/<tenant>/<site>/<lang>/job/<id>/<slug>">). No column is a location or a posting date
// (a date column, where there is one, is the closing date), so jobs come back without them.
// Employers can also show the same site on their own domain; we don't claim those (a host name can't tell us it
// is PageUp, and some put a bot check in front). Use the careers.pageuppeople.com link instead.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { robotsAllows } from '../robots.mjs';
import { makeJob, htmlToText, decodeEntities } from '../job.mjs';

const HOST = 'careers.pageuppeople.com';
const ORIGIN = `https://${HOST}`;
const HOSTS = [HOST];
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
// <tenant>/<site>/<lang>: the start of every public page of one employer.
const TENANT_PATH = /^\/(\d+)\/([A-Za-z0-9_-]+)\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})?)(?:\/|$)/;

export const listingUrl = (t, page) => `${ORIGIN}/${t.tenant}/${t.site}/${t.lang}/listing/?page=${page}&page-items=${PAGE_SIZE}`;

// The steps below are small bounded scans, not one big regex, so a broken page (unclosed tags) can't make them slow.
function stripComments(s) {
  let out = '', pos = 0;
  for (;;) {
    const open = s.indexOf('<!--', pos);
    if (open === -1) return out + s.slice(pos);
    out += s.slice(pos, open);
    const close = s.indexOf('-->', open + 4);
    if (close === -1) return out; // an unclosed comment hides the rest
    pos = close + 3;
  }
}
// One attribute of an opening tag. The lookbehind stops "data-href" being read as "href".
const attr = (tag, name) => (tag.match(new RegExp(`(?<![\\w-])${name}=["']([^"'<>]*)["']`, 'i')) || [])[1] ?? null;
const hasClass = (tag, c) => (attr(tag, 'class') ?? '').split(/\s+/).includes(c);

// Read one listing page. Only the results table (<tbody id="search-results-content">) counts: the same page repeats
// postings in a hidden "recent jobs" block. ok: false means it isn't a listing at all ('no-table': a login, error or
// bot-check page) or the links could not be read ('no-jobs-parsed': the markup changed). An empty table is ok.
export function readListing(html, t) {
  const doc = typeof html === 'string' ? html : '';
  const open = doc.match(/<tbody\b[^<>]*(?<![\w-])id=["']search-results-content["'][^<>]*>/i);
  if (!open) return { ok: false, reason: 'no-table', linkCount: 0, hasMore: false, rows: [] };
  const start = open.index + open[0].length;
  const close = doc.slice(start).search(/<\/tbody\s*>/i);
  const end = close === -1 ? doc.length : start + close;
  const body = stripComments(doc.slice(start, end)); // some pages keep a commented-out copy of each row
  const rows = [];
  let linkCount = 0;
  const opens = [...body.matchAll(/<a\b[^<>]*>/gi)];
  const closes = [...body.matchAll(/<\/a\s*>/gi)].map(m => m.index);
  let next = 0;
  for (let i = 0; i < opens.length; i++) {
    const tag = opens[i];
    if (!hasClass(tag[0], 'job-link')) continue;
    linkCount++;
    const href = attr(tag[0], 'href');
    if (!href) continue;
    let u; try { u = new URL(decodeEntities(href), ORIGIN); } catch { continue; }
    if (u.origin !== ORIGIN) continue; // never a posting on another host
    const m = u.pathname.match(/^\/(\d+)\/([A-Za-z0-9_-]+)\/[^/]+\/job\/(\d+)(?:\/|$)/);
    if (!m || m[1] !== t.tenant || m[2] !== t.site) continue; // or another employer
    const textStart = tag.index + tag[0].length;
    while (next < closes.length && closes[next] < textStart) next++;
    const textEnd = closes[next];
    // A link that never closes would take the next row's title: its text must end before the next link opens.
    const nextOpen = opens[i + 1]?.index;
    if (textEnd === undefined || (nextOpen !== undefined && nextOpen < textEnd)) continue;
    const title = htmlToText(body.slice(textStart, textEnd)).replace(/\s+/g, ' ').trim();
    if (!title) continue;
    // The link is rebuilt from the id alone: the slug follows the title and changes when a posting is renamed.
    rows.push({ id: m[3], title, url: `${ORIGIN}/${t.tenant}/${t.site}/${t.lang}/job/${m[3]}` });
  }
  if (!rows.length && (linkCount > 0 || /\/job\/\d/.test(body))) return { ok: false, reason: 'no-jobs-parsed', linkCount, hasMore: false, rows: [] };
  // The "More Jobs" link sits after the table.
  const tail = doc.slice(end);
  const hasMore = tail.includes('more-link') && [...stripComments(tail).matchAll(/<a\b[^<>]*>/gi)].some(a => hasClass(a[0], 'more-link'));
  return { ok: true, linkCount, hasMore, rows };
}

const toJob = (r, t) => makeJob({ source: 'pageup', company: t.name || `PageUp ${t.tenant}`, nativeId: r.id, title: r.title, url: r.url });

export default {
  id: 'pageup',
  label: 'PageUp',
  hosts: HOSTS,
  // Any page under careers.pageuppeople.com/<tenant>/<site>/<lang>/ (the listing, or a posting link).
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== HOST) return null;
    const m = u.pathname.match(TENANT_PATH);
    return m ? { host: HOST, tenant: m[1], site: m[2], lang: m[3] } : null;
  },
  parse(html, t) {
    return readListing(html, t).rows.map(r => toJob(r, t)).filter(Boolean);
  },
  async fetchJobs(t) {
    const out = [], seen = new Set();
    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = listingUrl(t, p);
      if (!(await robotsAllows(url, HOSTS))) throw new Error(`${HOST} robots.txt does not allow reading this listing`);
      const r = await request(url, { allow: HOSTS, parse: 'text', accept: 'text/html', gapMs: 1000 });
      const page = readListing(r.text, t);
      if (!page.ok) {
        const why = page.reason === 'no-table' ? 'no job table (a login, error or bot-check page, or the employer moved its site)' : 'job links that could not be read (the page changed)';
        if (p === 1) throw new Error(`PageUp listing for tenant ${t.tenant} came back with ${why}`);
        break; // keep the pages already read
      }
      const fresh = page.rows.filter(r => !seen.has(r.id));
      fresh.forEach(r => seen.add(r.id));
      out.push(...fresh.map(r => toJob(r, t)).filter(Boolean));
      // Nothing new (past the end, or the same page again), or a short page with no "More" link: done.
      if (!fresh.length || (!page.hasMore && page.linkCount < PAGE_SIZE)) break;
    }
    return out;
  },
};
