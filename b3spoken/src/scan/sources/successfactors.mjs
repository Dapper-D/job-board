// SAP SuccessFactors career sites (Recruiting Marketing / Career Site Builder) on the employer's careers host.
//   Older sites: GET <base>/tile-search-results/?startrow=N  (an HTML list of job tiles)
//   Newer sites: POST <base>/services/recruiting/v1/jobs  {"keywords":"","locale":"en_US","pageNumber":N,...}
// We try the older list first and use the newer search when it comes back empty.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob, decodeEntities } from '../job.mjs';

const MAX_TILE_PAGES = 60, MAX_CSB_PAGES = 100;
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
    const city = clean((block.match(/-section-(?:city|location)-value">([\s\S]*?)<\/div>/) || [])[1] || '');
    out.push({ id: t[1], title, url: new URL(decodeEntities(url), base).href, location: city });
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
    const allow = [t.host];
    const make = (j, extra = {}) => makeJob({ source: 'successfactors', company: t.name || t.host, nativeId: j.id, title: j.title, url: j.url, location: j.location, ...extra });
    const out = [];
    for (let p = 0, row = 0; p < MAX_TILE_PAGES; p++) {
      const r = await request(`${base}/tile-search-results/?startrow=${row}`, { allow, parse: 'text', accept: 'text/html', gapMs: 500 });
      const tiles = parseTiles(r.text, base);
      if (!tiles.length) break;
      out.push(...tiles.map(j => make(j)).filter(Boolean));
      row += tiles.length;
    }
    if (out.length) return out;
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
        const r = await request(`${base}/services/recruiting/v1/jobs`, { allow, parse: 'json', method: 'POST', gapMs: 300, json: { keywords: '', locale, location: '', pageNumber: p, sortBy: 'date' } });
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
    return out;
  },
};
