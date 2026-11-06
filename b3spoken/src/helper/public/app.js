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

let offset = 0, timer, view = '', docs = {};
const STATUS = [['', 'Not tracked'], ['saved', 'Saved'], ['applied', 'Applied'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Rejected'], ['not-interested', 'Not interested']];
const today = () => new Date().toISOString().slice(0, 10);

function trackerControls(j) {
  const box = el('div', 'track');
  const t = j.track || {};
  const sel = el('select'); sel.setAttribute('aria-label', 'Status');
  for (const [v, label] of STATUS) { const o = el('option', null, label); o.value = v; o.selected = (t.status || '') === v; sel.append(o); }
  const date = el('input'); date.type = 'date'; date.value = t.followUp || ''; date.setAttribute('aria-label', 'Follow up on');
  const notes = el('textarea'); notes.rows = 2; notes.placeholder = 'Notes'; notes.value = t.notes || ''; notes.setAttribute('aria-label', 'Notes');
  const due = el('span', 'badge warn', 'Follow-up due'); due.hidden = !(t.followUp && t.followUp <= today() && !['rejected', 'not-interested', 'offer'].includes(t.status));
  const save = async () => {
    const r = await api(`/api/tracker/${encodeURIComponent(j.id)}`, { method: 'PUT', body: JSON.stringify({ status: sel.value, followUp: date.value, notes: notes.value }) });
    j.track = r; date.value = r.followUp || '';
    due.hidden = !(r.followUp && r.followUp <= today() && !['rejected', 'not-interested', 'offer'].includes(r.status));
    loadDue();
  };
  sel.addEventListener('change', save); date.addEventListener('change', save); notes.addEventListener('change', save);
  const lab = (text, c) => { const l = el('label', 'mini'); l.append(el('span', null, text), c); return l; };
  const more = el('details', 'notes'); more.open = !!t.notes; more.append(el('summary', null, 'Notes'), notes);
  box.append(lab('Status', sel), lab('Follow up on', date), due, more);
  return box;
}
async function loadDue() {
  const t = await api('/api/tracker');
  docs = t.documents || {};
  $('dueCount').textContent = t.due ? `(${t.due})` : '';
}

function card(j) {
  const li = el('li', 'job');
  const top = el('div', 'top');
  top.append(el('h2', null, j.title));
  if (j.match) top.append(el('span', `score ${j.match.label.toLowerCase()}`, `${j.match.label} · ${j.match.score}`));
  li.append(top);
  const meta = el('div', 'meta');
  meta.append(el('span', null, j.company), el('span', null, j.location || ''));
  if (j.remote) meta.append(el('span', null, 'Remote'));
  if (j.postedAt) meta.append(el('span', null, ago(j.postedAt)));
  if (j.salary) meta.append(el('span', null, j.salary));
  li.append(meta);
  if (j.match?.reasons?.length) li.append(el('p', 'reasons', j.match.reasons.join(' · ')));
  else if (j.snippet) li.append(el('p', 'snippet', j.snippet + (j.snippet.length >= 280 ? '…' : '')));
  const row = el('div', 'row');
  const href = safeLink(j.applyUrl || j.url);
  if (href) { const a = el('a', 'apply', 'Apply'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; row.append(a); }
  if (j.source === 'jobbank') row.append(el('span', 'badge ok', 'Job Bank (Government of Canada)'));
  else if (j.employerVerified !== false) row.append(el('span', 'badge ok', 'On the employer’s own site'));
  else if (j.employerUrl) row.append(el('span', 'badge ok', 'Confirmed on the employer’s site'));
  if (j.via) row.append(el('span', 'badge', `via ${j.via}`));
  const make = el('button', 'small', 'Make my resume and cover letter'); make.type = 'button';
  const files = el('span', 'files');
  make.addEventListener('click', async () => {
    make.disabled = true; make.textContent = 'Writing…';
    try { const d = await api(`/api/jobs/${encodeURIComponent(j.id)}/documents`, { method: 'POST' }); showFiles(files, j.id, d); make.textContent = 'Make them again'; }
    catch (e) { make.textContent = e.message; }
    finally { make.disabled = false; }
  });
  row.append(make, files);
  if (docs[j.id]) { showFiles(files, j.id, { files: docs[j.id] }); make.textContent = 'Make them again'; }
  if (j.moreLocations) row.append(el('span', 'badge', `+${j.moreLocations} more locations`));
  li.append(row, trackerControls(j));
  return li;
}

// Downloads a PDF through the helper (the token can't go on a plain link), then saves it with its own name.
async function download(jobId, kind, name) {
  const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/documents/${kind}`, { headers: { 'x-b3spoken-token': token } });
  if (!r.ok) return;
  const url = URL.createObjectURL(await r.blob());
  const a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function showFiles(box, jobId, d) {
  box.replaceChildren();
  for (const [kind, label] of [['resume', 'Resume PDF'], ['letter', 'Cover letter PDF']]) {
    const b = el('button', 'small link', label); b.type = 'button';
    b.addEventListener('click', () => download(jobId, kind, d.files[kind]));
    box.append(b);
  }
}

async function load(reset = true) {
  if (reset) { offset = 0; $('list').replaceChildren(); }
  const p = new URLSearchParams({ q: $('q').value, province: $('province').value, remote: $('remote').value, maxAgeDays: $('age').value, minLabel: $('minLabel').value, sort: $('sort').value, view, offset, limit: 50 });
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
  const chosen = s.settings?.ai;
  const ai = chosen === 'none' ? { label: 'none (rule-based)' } : chosen === 'chrome' ? { label: 'Chrome built-in AI' } : (s.ai && (s.ai[chosen] || Object.values(s.ai).find(a => a.working)));
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
  for (const id of ['province', 'remote', 'age', 'minLabel', 'sort']) $(id).addEventListener('change', () => load());
  $('more').addEventListener('click', () => load(false));
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => {
    view = b.dataset.view; for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x === b);
    document.querySelector('.filters').hidden = !!view; load();
  });
  $('pasteGo').addEventListener('click', async () => {
    const url = $('pasteUrl').value.trim(); if (!url) return;
    $('pasteGo').disabled = true; $('pasteGo').textContent = 'Checking…'; $('pasteMsg').hidden = true;
    try { const r = await api('/api/paste', { method: 'POST', body: JSON.stringify({ url }) }); $('pasted').prepend(card(r.job)); $('pasteUrl').value = ''; }
    catch (e) { $('pasteMsg').hidden = false; $('pasteMsg').textContent = e.message; }
    finally { $('pasteGo').disabled = false; $('pasteGo').textContent = 'Check link'; }
  });
  await loadDue();
  $('refresh').addEventListener('click', async () => { await api('/api/refresh', { method: 'POST' }); poll(); });
  $('saveKw').addEventListener('click', async () => {
    const cur = await api('/api/settings');
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ...cur, keywords: $('kw').value.split(','), province: $('province').value, remote: $('remote').value }) });
    await api('/api/refresh', { method: 'POST' }); poll();
  });
  poll();
}
init().catch(e => { $('status').textContent = `The helper isn't answering: ${e.message}`; });
