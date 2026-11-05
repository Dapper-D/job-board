// Teamtailor public job feed (no key needed): https://<company>.teamtailor.com/jobs.rss
// Adapted from career-ops (https://github.com/career-ops-hq/career-ops, commit 559b58e), MIT licence,
// Copyright (c) 2026 Santiago Fernández de Valderrama. See NOTICES.md. Rewritten for B3spoken's http client and job shape.
import { request } from '../http.mjs';
import { makeJob, decodeEntities, htmlToText } from '../job.mjs';

const HOSTS = ['*.teamtailor.com'];
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.teamtailor\.com$/;
const text = (block, name) => {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  const c = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return (c ? c[1] : decodeEntities(m[1])).trim();
};

export default {
  id: 'teamtailor',
  label: 'Teamtailor',
  hosts: HOSTS,
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const h = u.hostname.toLowerCase();
    return HOST.test(h) && !['www.teamtailor.com', 'app.teamtailor.com'].includes(h) ? { host: h } : null;
  },
  parse(xml, target) {
    const items = String(xml ?? '').match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
    return items.map(it => {
      const remote = /^(fully|temporary)$/i.test(text(it, 'remoteStatus'));
      const place = [text(it, 'tt:city'), text(it, 'tt:country')].filter(Boolean).join(', ');
      return makeJob({
        source: 'teamtailor', company: target.name || target.host.split('.')[0], nativeId: text(it, 'guid') || undefined,
        title: text(it, 'title'), url: text(it, 'link'), location: place || (remote ? 'Remote' : ''), remote,
        postedAt: text(it, 'pubDate'), description: htmlToText(text(it, 'description')), department: text(it, 'tt:department'),
      });
    }).filter(Boolean);
  },
  async fetchJobs(target) {
    const r = await request(`https://${target.host}/jobs.rss`, { allow: [target.host], parse: 'text', accept: 'application/rss+xml, application/xml' });
    return this.parse(r.text, target);
  },
};
