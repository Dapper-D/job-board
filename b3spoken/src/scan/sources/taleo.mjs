// Taleo Enterprise career sections (no key needed): https://<tenant>.taleo.net/careersection/<section>/jobsearch.ftl
// We read the public page for its portal number and column names, then ask the same search the page uses:
//   POST https://<tenant>.taleo.net/careersection/rest/jobboard/searchjobs?lang=en&portal=<portal>
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOST = /^[a-z0-9-]+\.taleo\.net$/i;
const MAX_PAGES = 100;
const text = v => v == null ? '' : typeof v === 'object' ? (Array.isArray(v) ? v.map(text).filter(Boolean).join(', ') : text(v.value ?? v.text ?? v.label ?? v.name ?? '')) : htmlToText(String(v));

export default {
  id: 'taleo',
  label: 'Taleo',
  hosts: ['*.taleo.net'],
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (!HOST.test(u.hostname) || /\.tbe\.taleo\.net$|^tre\.taleo\.net$/i.test(u.hostname)) return null; // Taleo Business Edition is different
    const m = u.pathname.match(/^\/careersection\/([a-z0-9._-]+)\/(?:jobsearch|joblist|jobdetail|moresearch)\.ftl$/i);
    return m && m[1] !== 'rest' ? { host: u.hostname.toLowerCase(), section: m[1], lang: u.searchParams.get('lang') || 'en' } : null;
  },
  parse(data, t, headings = []) {
    const idx = res => headings.findIndex(h => res.some(r => r.test(h)));
    const ti = idx([/title/i]), li = idx([/location/i, /city/i]), pi = idx([/post/i, /date/i]);
    return (data?.requisitionList || []).map(row => {
      const cols = (row.column || []).map(text);
      const id = String(row.contestNo ?? row.jobId ?? '').trim();
      if (!id) return null;
      let loc = cols[li >= 0 ? li : 1] || '';
      if (loc.startsWith('[')) { try { loc = JSON.parse(loc).join(' / '); } catch {} }
      return makeJob({
        source: 'taleo', company: t.name || t.host.split('.')[0], nativeId: id, title: cols[ti >= 0 ? ti : 0],
        url: `https://${t.host}/careersection/${encodeURIComponent(t.section)}/jobdetail.ftl?job=${encodeURIComponent(id)}&lang=${t.lang || 'en'}`,
        location: loc, postedAt: cols[pi >= 0 ? pi : 2] || null,
      });
    }).filter(Boolean);
  },
  async fetchJobs(t) {
    const allow = [t.host];
    const shell = await request(`https://${t.host}/careersection/${encodeURIComponent(t.section)}/jobsearch.ftl?lang=${t.lang || 'en'}`, { allow, parse: 'text', accept: 'text/html' });
    const portal = (shell.text.match(/[?&]portal=(\d+)/i) || shell.text.match(/["']portal(?:Id)?["']?\s*[:=]\s*["']?(\d+)/i) || [])[1];
    if (!portal) throw new Error('this Taleo career section is private or has no public job list');
    const table = (shell.text.match(/<table\b[^>]*id=["']jobs["'][^>]*>[\s\S]*?<thead\b[^>]*>([\s\S]*?)<\/thead>/i) || [])[1] || '';
    const headings = [...table.matchAll(/<(?:th|label)[^>]*>([\s\S]*?)<\/(?:th|label)>/gi)].map(m => htmlToText(m[1])).filter(h => h && !/^(icons?|actions?)$/i.test(h));
    const out = [];
    for (let p = 1; p <= MAX_PAGES; p++) {
      const r = await request(`https://${t.host}/careersection/rest/jobboard/searchjobs?lang=${t.lang || 'en'}&portal=${portal}`, {
        allow, parse: 'json', method: 'POST', gapMs: 400, headers: { 'x-requested-with': 'XMLHttpRequest', tz: 'America/Toronto' },
        json: { multilineEnabled: false, sortingSelection: { sortBySelectionParam: '5', ascendingSortingOrder: 'true' }, fieldData: { fields: { KEYWORD: '', LOCATION: '' }, valid: true }, filterSelectionParam: { searchFilterSelections: [] }, advancedSearchFiltersSelectionParam: { searchFilterSelections: [] }, pageNo: p } });
      const got = this.parse(r.json, t, headings);
      out.push(...got);
      const pg = r.json?.pagingData || {};
      if (!got.length || (pg.totalCount && out.length >= pg.totalCount)) break;
    }
    return out;
  },
};
