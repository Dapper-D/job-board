// SAP SuccessFactors career sites (Recruiting Marketing / Career Site Builder) on the employer's careers host.
//   Older sites: GET <base>/tile-search-results/?startrow=N  (an HTML list of job tiles)
//   Newer sites: POST <base>/services/recruiting/v1/jobs  {"keywords":"","locale":"en_US","pageNumber":N,...}
// We try the older list first and use the newer search when it comes back empty.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob, decodeEntities } from '../job.mjs';

const MAX_TILE_PAGES = 60, MAX_SEARCH_PAGES = 100, MAX_CSB_PAGES = 100;
const clean = s => decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// Recognise a SuccessFactors career site from its page.
export function sfFromPage(html, pageUrl) {
  if (!/jobs2web|rmkcdn|tile-search-results|searchResultsUnify|successfactors|sapsf\.com\/career/i.test(html)) return null;
  const u = new URL(pageUrl);
  if (/sapsf\.(com|eu)$/i.test(u.hostname)) return null; // the hosted classic site is a different product
  return { host: u.hostname.toLowerCase(), path: '' };
}

export function parseTiles(html, base) {
  const out = [];
  for (const t of String(html).matchAll(/<li class="job-tile job-id-(\d+)\b[\s\S]*?<\/li>/g)) {
    const block = t[0];
    const url = (block.match(/data-url="([^"]+)"/) || [])[1];
    const title = clean((block.match(/class="jobTitle-link[^"]*"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '');
    if (!url || !title) continue;
    // Tiles show location in one or more fields (city, state, country, location), each with extra attributes.
    const parts = [];
    for (const f of block.matchAll(/-section-(city|state|country|location|multilocation)-value"[^>]*>([\s\S]*?)<\/(?:div|span)>/g)) {
      const v = clean(f[2]); if (v && !parts.includes(v)) parts.push(v);
    }
    out.push({ id: t[1], title, url: new URL(decodeEntities(url), base).href, location: parts.join(', ') });
  }
  return out;
}

// The /search/ results table: one <tr class="data-row"> per job, with the location in its own column.
export function parseSearchRows(html, base) {
  const out = [];
  for (const m of String(html).matchAll(/<tr class="data-row[\s\S]*?<\/tr>/g)) {
    const row = m[0];
    const a = row.match(/<a [^>]*href="([^"]+)"[^>]*class="jobTitle-link"[^>]*>([\s\S]*?)<\/a>|<a [^>]*class="jobTitle-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const href = decodeEntities(a[1] || a[3]); const title = clean(a[2] || a[4]);
    const id = (href.match(/\/(\d+)\/?(?:[?#].*)?$/) || [])[1];
    if (!id || !title) continue;
    const locCell = (row.match(/class="colLocation[^"]*"[^>]*>([\s\S]*?)<\/td>/) || row.match(/<span class="jobLocation[^"]*">([\s\S]*?)<\/span>/) || [])[1] || '';
    const location = clean(locCell.replace(/<small[\s\S]*?<\/small>/g, ''));
    const date = Date.parse(clean((row.match(/<span class="jobDate[^"]*">([\s\S]*?)<\/span>/) || [])[1] || ''));
    out.push({ id, title, url: new URL(href, base).href, location, postedAt: Number.isFinite(date) ? new Date(date).toISOString() : null });
  }
  return out;
}

const csbDate = (raw, locale) => {
  const m = String(raw || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, a, b, y] = m.map(Number);
  if (y < 100) y += 2000;
  const [mo, d] = locale === 'en_US' ? [a, b] : [b, a];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? new Date(Date.UTC(y, mo - 1, d)).toISOString() : null;
};

export default {
  id: 'successfactors',
  label: 'SAP SuccessFactors',
  hosts: [],
  fromUrl() { return null; }, // branded hosts: found from page contents in discovery
  async fetchJobs(t) {
    const base = `https://${t.host}${t.path || ''}`;
    // The site may redirect to another host of the same employer (jobs.alberta.ca -> www.alberta.ca).
    const labels = t.host.split('.');
    const site = labels.slice(/^(gc|co|com|gov)$/.test(labels.at(-2)) ? -3 : -2).join('.');
    const allow = [t.host, site, `*.${site}`];
    const make = (j, extra = {}) => makeJob({ source: 'successfactors', company: t.name || t.host, nativeId: j.id, title: j.title, url: j.url, location: j.location, ...extra });
    let out = [];
    const tileIds = new Set();
    for (let p = 0, row = 0; p < MAX_TILE_PAGES; p++) {
      const r = await request(`${base}/tile-search-results/?q=&sortColumn=referencedate&sortDirection=desc&startrow=${row}`, { allow, parse: 'text', accept: 'text/html', gapMs: 500 });
      // Some sites ignore startrow and send the same page again: stop as soon as a page adds nothing new.
      const fresh = parseTiles(r.text, base).filter(j => !tileIds.has(j.id));
      if (!fresh.length) break;
      fresh.forEach(j => tileIds.add(j.id));
      out.push(...fresh.map(j => make(j)).filter(Boolean));
      row += fresh.length;
    }
    if (out.length && out.some(j => j.location)) return out;
    // Tiles without any location can't be placed. The site's search table shows the location in its own column.
    const rows = [], rowIds = new Set();
    for (let p = 0; p < MAX_SEARCH_PAGES; p++) {
      let r;
      try { r = await request(`${base}/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=${rows.length}`, { allow, parse: 'text', accept: 'text/html', gapMs: 500 }); }
      catch (e) { if (p === 0) break; throw e; }
      const fresh = parseSearchRows(r.text, base).filter(j => !rowIds.has(j.id));
      if (!fresh.length) break;
      fresh.forEach(j => { rowIds.add(j.id); rows.push(j); });
    }
    if (rows.length) return rows.map(j => make(j, { postedAt: j.postedAt })).filter(Boolean);
    const tilesOnly = out; out = [];
    // Newer sites: one search per locale the site offers (Canadian sites usually en_US/en_GB and fr_CA).
    let locales = ['en_US', 'en_GB', 'fr_CA'];
    try {
      const page = await request(`${base}/search/`, { allow, parse: 'text', accept: 'text/html' });
      const found = [...new Set([...page.text.matchAll(/locale=([a-z]{2}_[A-Z]{2})\b/g)].map(m => m[1]))];
      if (found.length) locales = found.sort((a, b) => (/^en/.test(b) ? 1 : 0) - (/^en/.test(a) ? 1 : 0)).slice(0, 4);
    } catch {}
    const seen = new Set();
    for (const locale of locales) {
      for (let p = 0; p < MAX_CSB_PAGES; p++) {
        let r;
        try { r = await request(`${base}/services/recruiting/v1/jobs`, { allow, parse: 'json', method: 'POST', gapMs: 300, json: { keywords: '', locale, location: '', pageNumber: p, sortBy: 'date' } }); }
        catch (e) { if (tilesOnly.length) return tilesOnly; throw e; }
        const list = r.json?.jobSearchResult || [];
        for (const item of list) {
          const x = item?.response; if (!x || x.id == null || seen.has(String(x.id))) continue;
          seen.add(String(x.id));
          const slug = decodeEntities(String(x.unifiedUrlTitle || x.urlTitle || 'job')).replace(/[?#&]+/g, '-');
          const j = make({ id: x.id, title: clean(x.unifiedStandardTitle || x.jobTitle || ''), url: `${base}/job/${slug}/${x.id}-${locale}`,
            location: [...new Set([].concat(x.jobLocationShort || []).map(clean).filter(Boolean))].join(' / ') }, { postedAt: csbDate(x.unifiedStandardStart, locale) });
          if (j) out.push(j);
        }
        if (list.length < 10 || out.length >= (r.json?.totalJobs ?? 0)) break;
      }
    }
    return out.length ? out : tilesOnly;
  },
};
