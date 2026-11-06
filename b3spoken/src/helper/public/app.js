// The board page. Talks only to the helper on this computer; every call carries this run's token.
const token = document.querySelector('meta[name="b3spoken-token"]').content;
const $ = id => document.getElementById(id);
const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { 'x-b3spoken-token': token, 'content-type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const safeLink = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
const ago = iso => { const t = Date.parse(iso); if (!t) return ''; const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`; };

let offset = 0, timer;

function card(j) {
  const li = el('li', 'job');
  li.append(el('h2', null, j.title));
  const meta = el('div', 'meta');
  meta.append(el('span', null, j.company), el('span', null, j.location || ''));
  if (j.remote) meta.append(el('span', null, 'Remote'));
  if (j.postedAt) meta.append(el('span', null, ago(j.postedAt)));
  if (j.salary) meta.append(el('span', null, j.salary));
  li.append(meta);
  if (j.snippet) li.append(el('p', 'snippet', j.snippet + (j.snippet.length >= 280 ? '…' : '')));
  const row = el('div', 'row');
  const href = safeLink(j.applyUrl || j.url);
  if (href) { const a = el('a', 'apply', 'Apply'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; row.append(a); }
  if (j.source === 'jobbank') row.append(el('span', 'badge ok', 'Job Bank (Government of Canada)'));
  else if (j.employerVerified !== false) row.append(el('span', 'badge ok', 'On the employer’s own site'));
  else if (j.employerUrl) row.append(el('span', 'badge ok', 'Confirmed on the employer’s site'));
  if (j.via) row.append(el('span', 'badge', `via ${j.via}`));
  if (j.moreLocations) row.append(el('span', 'badge', `+${j.moreLocations} more locations`));
  li.append(row);
  return li;
}

async function load(reset = true) {
  if (reset) { offset = 0; $('list').replaceChildren(); }
  const p = new URLSearchParams({ q: $('q').value, province: $('province').value, remote: $('remote').value, maxAgeDays: $('age').value, offset, limit: 50 });
  const r = await api(`/api/jobs?${p}`);
  r.jobs.forEach(j => $('list').append(card(j)));
  offset += r.jobs.length;
  $('count').textContent = `${r.total.toLocaleString()} jobs`;
  $('more').hidden = offset >= r.total;
}

async function status() {
  const s = await api('/api/status');
  const parts = [];
  if (s.pool) parts.push(`Job pool: ${s.pool.count.toLocaleString()} jobs, ${ago(s.pool.generatedAt)}`);
  if (s.jobBank) parts.push(`Job Bank: ${s.jobBank.count.toLocaleString()}`);
  const ai = s.ai && Object.values(s.ai).find(a => a.working);
  parts.push(ai ? `AI: ${ai.label}` : 'AI: none found yet');
  $('status').textContent = s.refreshing ? 'Updating jobs…' : parts.join(' · ');
  $('problems').hidden = !s.problems.length; $('problems').textContent = s.problems.join(' ');
  return s;
}

async function poll() {
  const s = await status().catch(() => null);
  if (s && !s.refreshing) { await load(); return; }
  setTimeout(poll, 2000);
}

async function init() {
  const prof = await api('/api/profile');
  if (!prof.done) { location.href = '/setup'; return; }
  const s = await api('/api/settings');
  $('kw').value = s.keywords.join(', ');
  $('province').value = s.province; $('remote').value = s.remote;
  for (const id of ['q']) $(id).addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(), 250); });
  for (const id of ['province', 'remote', 'age']) $(id).addEventListener('change', () => load());
  $('more').addEventListener('click', () => load(false));
  $('refresh').addEventListener('click', async () => { await api('/api/refresh', { method: 'POST' }); poll(); });
  $('saveKw').addEventListener('click', async () => {
    const cur = await api('/api/settings');
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ...cur, keywords: $('kw').value.split(','), province: $('province').value, remote: $('remote').value }) });
    await api('/api/refresh', { method: 'POST' }); poll();
  });
  poll();
}
init().catch(e => { $('status').textContent = `The helper isn't answering: ${e.message}`; });
