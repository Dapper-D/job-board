// JazzHR career pages on ApplyToJob (no key needed): https://<tenant>.applytojob.com/apply
// One server-rendered page lists every open job (no paging). robots.txt is checked first.
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { robotsAllows } from '../robots.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOST = /^[a-z0-9][a-z0-9-]*\.applytojob\.com$/i;
const MAX_JOBS = 1000;
const clean = s => htmlToText(String(s ?? '')).replace(/\s+/g, ' ').trim();
const LINK = /<a\b[^>]*href=["']([^"']*\/apply\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

// A job link on this board, without its query; null for anything else (other hosts, the bare /apply/ back link).
function jobUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (u.origin !== base.origin || !/^\/apply\/[^/]/i.test(u.pathname)) return null;
    u.search = ''; u.hash = '';
    return u;
  } catch { return null; }
}

// Jobs on the board page: { id, title, url, location }.
export function parseBoard(html, host) {
  const s = String(html ?? '');
  const base = new URL(`https://${host}/apply`);
  const out = [], seen = new Set();
  const add = (u, title, location) => {
    if (!u || !title || seen.has(u.href) || out.length >= MAX_JOBS) return;
    seen.add(u.href);
    out.push({ id: u.pathname.split('/')[2], title, url: u.href, location });
  };
  // Usual markup: one list-group-item per job, with the title link and a map-marker location.
  for (const m of s.matchAll(/<li\b[^>]*class=["'][^"']*list-group-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const card = m[1];
    const a = card.match(/<a\b[^>]*href=["']([^"']*\/apply\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    add(jobUrl(a[1], base), clean(a[2]), clean((card.match(/fa-map-marker[^<]*<\/i>\s*([^<]+)/i) || [])[1]));
  }
  // Any other job links (a redesigned page without list-group-item): title only.
  for (const m of s.matchAll(LINK)) add(jobUrl(m[1], base), clean(m[2]), '');
  return out;
}

export default {
  id: 'jazzhr',
  label: 'JazzHR',
  hosts: ['*.applytojob.com'],
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && HOST.test(h) && !h.startsWith('www.') ? { host: h } : null;
  },
  parse(html, t) {
    return parseBoard(html, t.host).map(j => makeJob({
      source: 'jazzhr', company: t.name || t.host.split('.')[0], nativeId: j.id, title: j.title, url: j.url, location: j.location,
    })).filter(Boolean);
  },
  async fetchJobs(t) {
    const allow = [t.host];
    const url = `https://${t.host}/apply`;
    if (!(await robotsAllows(url, allow))) throw new Error(`${t.host} robots.txt does not allow reading its job list`);
    const r = await request(url, { allow, parse: 'text', accept: 'text/html', gapMs: 1000 });
    const jobs = this.parse(r.text, t);
    if (!jobs.length && /<a\b[^>]*href=["'][^"']*\/apply\/[^"'/][^"']*["']/i.test(r.text)) throw new Error('JazzHR changed its job list page (job links found but none could be read)');
    return jobs;
  },
};
