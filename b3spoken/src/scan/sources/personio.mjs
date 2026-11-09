// Personio public jobs feed (no key needed): https://<company>.jobs.personio.de/xml (or .jobs.personio.com)
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
// The XML feed is Personio's documented feed and carries the full text. Some companies turn it off (404); then we
// read the careers page itself (after checking robots.txt), which lists every job in its HTML.
// Each job comes back once, in the language the feed or page uses; other translations are not fetched.
import { request } from '../http.mjs';
import { robotsAllows } from '../robots.mjs';
import { makeJob, htmlToText, decodeEntities } from '../job.mjs';

const HOSTS = ['*.jobs.personio.de', '*.jobs.personio.com'];
const HOST = /^[a-z0-9][a-z0-9-]*\.jobs\.personio\.(de|com)$/;

// Text of a tag: unwrap CDATA, else decode entities.
const inner = s => { const c = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/); return c ? c[1].trim() : decodeEntities(s).trim(); };
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`)); return m ? inner(m[1]) : ''; };
const stripTags = s => { let p; do { p = s; s = s.replace(/<[^>]*>/g, ''); } while (s !== p); return s; };

// <workzag-jobs><position><id/><office/><name/><jobDescriptions>…</jobDescriptions><createdAt/></position>…
export function parsePersonioXml(xml) {
  // Descriptions are free HTML that could hold "</position>" or their own <name>, so set them aside first.
  const descs = [];
  const safe = String(xml).replace(/<jobDescriptions\b[^>]*>([\s\S]*?)<\/jobDescriptions>/gi, (m, body) => `<jd n="${descs.push(body) - 1}"/>`);
  return (safe.match(/<position\b[^>]*>[\s\S]*?<\/position>/g) || []).map(b => {
    const n = b.match(/<jd n="(\d+)"\/>/);
    const parts = n ? (descs[n[1]].match(/<jobDescription\b[^>]*>[\s\S]*?<\/jobDescription>/g) || []) : [];
    const description = parts.map(p => { const head = tag(p, 'name'), text = htmlToText(tag(p, 'value')); return text ? (head ? `${head}\n${text}` : text) : ''; }).filter(Boolean).join('\n\n');
    const offices = [...new Set([...b.matchAll(/<office\b[^>]*>([\s\S]*?)<\/office>/g)].map(m => inner(m[1])).filter(Boolean))];
    return { id: tag(b, 'id'), name: tag(b, 'name'), offices, createdAt: tag(b, 'createdAt'), description,
      department: tag(b, 'department'), employment: [tag(b, 'schedule'), tag(b, 'employmentType')].filter(Boolean).join(', ') };
  });
}

// Careers page: Next.js payload chunks self.__next_f.push([1,"…"]) holding {"id":"123","name":…,"available_languages":[…]}.
export function parsePersonioPage(html) {
  let payload = '';
  for (const m of String(html).matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try { const c = JSON.parse(m[1]); if (c[0] === 1 && typeof c[1] === 'string') payload += c[1]; } catch { /* not a data chunk */ }
  }
  const out = [], seen = new Set();
  for (let from = 0; ;) {
    const start = payload.indexOf('{"id":"', from);
    if (start === -1) break;
    from = start + 1;
    const end = objectEnd(payload, start);
    if (end === -1) continue;
    let o; try { o = JSON.parse(payload.slice(start, end)); } catch { continue; }
    if (!/^\d+$/.test(o?.id || '') || typeof o.name !== 'string' || !Array.isArray(o.available_languages) || seen.has(o.id)) continue;
    seen.add(o.id); from = end;
    out.push({ id: o.id, name: o.name, offices: [...new Set([o.main_office, ...(o.additional_offices || [])].filter(x => typeof x === 'string' && x.trim()))], createdAt: o.created_at });
  }
  if (out.length) return out;
  // Older page build: <a class="job-box" href="/job/123"><h3>Title</h3><span class="…jobMetaText…">Place</span></a>
  for (const m of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const id = /\bclass="[^"]*\bjob-box\b/.test(m[1]) && m[1].match(/\bhref="\/job\/(\d+)(?:\?[^"]*)?"/)?.[1];
    const title = m[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/)?.[1];
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const loc = m[2].match(/<span\b[^>]*class="[^"]*jobMetaText[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1];
    out.push({ id, name: decodeEntities(stripTags(title)).trim(), offices: loc ? [decodeEntities(stripTags(loc)).trim()] : [] });
  }
  return out;
}

// Index just past the JSON object starting at `start` (braces inside strings ignored), or -1.
function objectEnd(text, start) {
  let depth = 0, str = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (str) { if (c === '\\') i++; else if (c === '"') str = false; }
    else if (c === '"') str = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

export default {
  id: 'personio',
  label: 'Personio',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const h = u.hostname.toLowerCase();
    return HOST.test(h) && !h.startsWith('www.') ? { host: h } : null;
  },
  // data: the XML feed text or the careers page HTML.
  parse(data, target) {
    const s = String(data ?? '');
    const rows = /<workzag-jobs\b/.test(s) ? parsePersonioXml(s) : parsePersonioPage(s);
    return rows.map(p => /^\d+$/.test(p.id) ? makeJob({
      source: 'personio', company: target.name || target.host.split('.')[0], nativeId: p.id,
      title: p.name, url: `https://${target.host}/job/${p.id}`,
      location: p.offices.join(' / '), postedAt: p.createdAt || null,
      description: p.description, department: p.department, employment: p.employment,
    }) : null).filter(Boolean);
  },
  async fetchJobs(target) {
    const allow = [target.host];
    try {
      const r = await request(`https://${target.host}/xml`, { allow, parse: 'text', accept: 'application/xml, text/xml' });
      if (/<workzag-jobs\b/.test(r.text)) return this.parse(r.text, target);
    } catch (e) { if (e.status !== 404) throw e; }
    // Feed turned off: read the careers page.
    const page = `https://${target.host}/`;
    if (!(await robotsAllows(page, allow))) throw new Error(`${target.host} robots.txt does not allow its careers page`);
    const r = await request(page, { allow, parse: 'text', accept: 'text/html' });
    return this.parse(r.text, target);
  },
};
