// Phenom career sites (the "CareerConnect" sites many large employers run on their own careers domain).
// The search page reads a public JSON endpoint on the same host: POST https://<careers host>/widgets
// Target: { host: 'jobs.example.com', prefix: 'ca/en' } (the path before /job/ in posting links).
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob, decodeEntities } from '../job.mjs';

const PAGE = 100, MAX_PAGES = 30;
const slug = t => String(t).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'job';

// Recognise a Phenom site from its page: Phenom's script host plus posting links like /ca/en/job/12345/...
export function phenomFromPage(html, pageUrl) {
  if (!/phenompeople|phenom\.com\/|"phApp"|phApp\./i.test(html)) return null;
  const u = new URL(pageUrl);
  const m = String(html).match(/["'](?:https?:\/\/[^"'/]+)?\/([a-z]{2,6}\/[a-z]{2}(?:[-_][a-z]{2})?)\/(?:job|search-results)\b/i);
  return { host: u.hostname.toLowerCase(), prefix: m ? m[1] : 'global/en' };
}

export default {
  id: 'phenom',
  label: 'Phenom',
  hosts: [],
  fromUrl() { return null; }, // branded hosts: found from page contents in discovery, not from the URL
  parse(data, t) {
    const rows = data?.refineSearch?.data?.jobs || [];
    return rows.filter(j => j && j.jobId != null && j.title).map(j => makeJob({
      source: 'phenom', company: t.name || t.host, nativeId: j.jobId,
      title: String(j.title).replace(/<[^>]*>/g, ' '),
      url: `https://${t.host}/${t.prefix}/job/${encodeURIComponent(String(j.jobId))}/${slug(decodeEntities(j.title))}`,
      location: String(j.location || j.cityStateCountry || [j.city, j.state, j.country].filter(Boolean).join(', ')).replace(/<[^>]*>/g, ' '),
      postedAt: j.postedDate || j.dateCreated, description: j.descriptionTeaser || '',
      department: j.category, employment: j.type,
    })).filter(Boolean);
  },
  async fetchJobs(t) {
    const [lang, country] = (t.prefix || 'global/en').split('/').reverse();
    const out = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const r = await request(`https://${t.host}/widgets`, { allow: [t.host], parse: 'json', gapMs: 500, method: 'POST', json: {
        lang: `${lang}_${country || 'global'}`, deviceType: 'desktop', country: country || 'global', pageName: 'search-results', ddoKey: 'refineSearch',
        sortBy: '', subsearch: '', from: p * PAGE, jobs: true, counts: true, all_fields: ['category', 'country', 'city'], size: PAGE,
        clearAll: false, jdsource: 'facets', isSliderEnable: false, pageId: 'page10', siteType: 'external', keywords: '', global: !country || country === 'global',
        selected_fields: t.selected || {}, locationData: {} } });
      const got = this.parse(r.json, t);
      out.push(...got);
      const total = r.json?.refineSearch?.totalHits ?? 0;
      if (got.length < PAGE || out.length >= total) break;
    }
    return out;
  },
};
