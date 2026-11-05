// A small robots.txt reader: do the rules for "*" (or for B3spokenBot) allow this path?
// Longest matching rule wins; Allow wins a tie, as Google and RFC 9309 do. Missing or unreadable robots.txt = allowed.
import { request } from './http.mjs';

export function parseRobots(text, agent = 'b3spokenbot') {
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && agent.includes(a)));
  const chosen = mine.length ? mine : groups.filter(g => g.agents.includes('*'));
  return chosen.flatMap(g => g.rules).filter(r => r.path !== '' || !r.allow);
}

const toRe = p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
export function allowedBy(rules, path) {
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue; // "Disallow:" with nothing = allow everything
    if (toRe(r.path).test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

const cache = new Map();
export async function robotsAllows(url, allow) {
  const u = new URL(url);
  if (!cache.has(u.host)) {
    let rules = [];
    try { rules = parseRobots((await request(`https://${u.host}/robots.txt`, { allow, parse: 'text', retries: 0, accept: 'text/plain' })).text); } catch { /* none = allowed */ }
    cache.set(u.host, rules);
  }
  return allowedBy(cache.get(u.host), u.pathname + u.search);
}
