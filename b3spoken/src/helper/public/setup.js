// Onboarding: connect an AI, read the resume into the library, answer the questions, pick extra roles.
const token = document.querySelector('meta[name="b3spoken-token"]').content;
const $ = id => document.getElementById(id);
const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { 'x-b3spoken-token': token, 'content-type': 'application/json' } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
};
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const csv = s => s.split(',').map(x => x.trim()).filter(Boolean);
let settings, profile, lib;

function show(step) {
  for (const s of document.querySelectorAll('.step')) s.hidden = s.id !== `step-${step}`;
  for (const li of $('steps').children) li.classList.toggle('on', li.dataset.step === step);
  if (step === 'roles') drawRoles();
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => { const go = e.target.closest('[data-go]'); if (go) show(go.dataset.go); });
const msg = (box, text) => { $(box).hidden = !text; $(box).textContent = text || ''; };

// ---- 1. AI ----
async function drawAi() {
  const s = await api('/api/status');
  const chrome = 'LanguageModel' in self;
  const options = [
    ['codex', 'ChatGPT (Codex)', s.ai?.codex?.working ? `Found: ${s.ai.codex.version}` : `Not found. To add it: ${s.ai?.codex?.install || 'install Codex'}`, s.ai?.codex?.working],
    ['claude', 'Claude (Claude Code)', s.ai?.claude?.working ? `Found: ${s.ai.claude.version}` : `Not found. To add it: ${s.ai?.claude?.install || 'install Claude Code'}`, s.ai?.claude?.working],
    ['chrome', 'Chrome built-in AI', chrome ? 'Available in this browser' : 'Not available in this browser (needs desktop Chrome and a strong enough computer)', chrome],
    ['none', 'No AI', 'Tailoring picks and orders your own bullets by keyword match', true],
  ];
  const pick = settings.ai !== 'auto' ? settings.ai : (options.find(o => o[3])?.[0] || 'none');
  $('aiChoices').replaceChildren(...options.map(([id, label, note, ok]) => {
    const l = el('label', `choice${ok ? '' : ' off'}`);
    const r = el('input'); r.type = 'radio'; r.name = 'ai'; r.value = id; r.checked = id === pick;
    l.append(r, el('strong', null, label), el('span', 'note', note));
    return l;
  }));
}
$('aiNext').addEventListener('click', async () => {
  const ai = document.querySelector('input[name="ai"]:checked')?.value || 'none';
  settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ...settings, ai }) });
  $('tidy').hidden = !['codex', 'claude'].includes(ai);
  show('resume');
});

// ---- 2. Resume ----
function drawLibrary() {
  $('libraryBox').hidden = !lib; $('resumeNext').disabled = !lib;
  if (!lib) return;
  const box = $('library'); box.replaceChildren();
  if (lib.contact?.name) box.append(el('p', 'small', `${lib.contact.name} · read by ${lib.source === 'rules' ? 'B3spoken' : lib.source === 'codex' ? 'ChatGPT' : 'Claude'}`));
  for (const e of lib.entries) {
    const card = el('div', 'job');
    card.append(el('h2', null, e.heading || '(no heading)'));
    if (e.dates || e.kind) card.append(el('div', 'meta', [e.kind, e.dates].filter(Boolean).join(' · ')));
    for (const b of e.bullets) {
      const row = el('div', `bullet${b.flagged ? ' flagged' : ''}`);
      row.append(el('code', null, b.id), el('span', null, b.text));
      if (b.flagged) {
        row.append(el('span', 'badge warn', 'check'));
        const ok = el('button', 'small', 'Looks right'); ok.type = 'button';
        ok.addEventListener('click', async () => { Object.assign(b, await api(`/api/library/bullets/${encodeURIComponent(b.id)}`, { method: 'PUT', body: JSON.stringify({ flagged: false }) })); drawLibrary(); });
        const fix = el('button', 'small', 'Fix the words'); fix.type = 'button';
        fix.addEventListener('click', async () => { const t = prompt('Your own words for this line:', b.text); if (t != null) { Object.assign(b, await api(`/api/library/bullets/${encodeURIComponent(b.id)}`, { method: 'PUT', body: JSON.stringify({ text: t, flagged: false }) })); drawLibrary(); } });
        row.append(ok, fix);
      }
      card.append(row);
    }
    box.append(card);
  }
}
async function upload(body) {
  msg('resumeMsg', ''); $('upload').disabled = true;
  try { lib = await api('/api/resume', { method: 'POST', body: JSON.stringify(body) }); drawLibrary(); }
  catch (e) { msg('resumeMsg', e.message); }
  finally { $('upload').disabled = false; }
}
$('upload').addEventListener('click', () => {
  const f = $('file').files[0]; if (!f) return msg('resumeMsg', 'Choose a file first.');
  if (f.size > 10 * 1024 * 1024) return msg('resumeMsg', 'That file is larger than 10 MB.');
  const r = new FileReader();
  r.onload = () => upload({ filename: f.name, dataBase64: String(r.result).split(',')[1] || '' });
  r.readAsDataURL(f);
});
$('usePaste').addEventListener('click', () => upload({ text: $('paste').value }));
$('tidy').addEventListener('click', async () => {
  $('tidy').disabled = true; $('tidy').textContent = 'Your AI is reading it…'; msg('resumeMsg', '');
  try { lib = await api('/api/resume/ai', { method: 'POST', body: JSON.stringify({ provider: settings.ai }) }); drawLibrary(); }
  catch (e) { msg('resumeMsg', `${e.message} The version B3spoken read is kept.`); }
  finally { $('tidy').disabled = false; $('tidy').textContent = 'Tidy it with my AI'; }
});
$('resumeNext').addEventListener('click', () => show('questions'));

// ---- 3. Questions ----
const FIELDS = ['payFloor', 'payFloorUnit', 'payGoal', 'payGoalUnit', 'province', 'cities', 'remote', 'workAuth', 'startDate', 'missingSkills', 'avoidIndustries'];
function fillQuestions() {
  $('targetRoles').value = (profile.targetRoles || []).join(', ');
  for (const f of FIELDS) {
    const v = profile[f];
    if (f.endsWith('Unit') && profile[f.slice(0, -4)] == null) continue; // keep the page's default unit until an amount is saved
    if (v != null && v !== '') $(f).value = Array.isArray(v) ? v.join(', ') : v;
  }
}
const answers = () => ({ ...profile, targetRoles: csv($('targetRoles').value), ...Object.fromEntries(FIELDS.map(f => [f, ['cities', 'missingSkills', 'avoidIndustries'].includes(f) ? csv($(f).value) : $(f).value])) });
let confirmedFar = new Set();
$('questionsNext').addEventListener('click', async () => {
  const a = answers();
  if (!a.targetRoles.length && lib?.roles?.length) a.targetRoles = lib.roles.slice(0, 2).map(r => r.title);
  const far = [];
  for (const t of a.targetRoles) { const c = await api('/api/roles/check', { method: 'POST', body: JSON.stringify({ target: t }) }); if (c.far && !confirmedFar.has(t)) far.push(c); }
  if (far.length) {
    const box = $('roleWarn'); box.hidden = false; box.replaceChildren();
    for (const c of far) {
      const p = el('p', null, `“${c.target}” is far from what your resume shows. Closest fits: ${c.closest.join(', ') || 'none found'}.`);
      const keep = el('button', 'small', `Keep “${c.target}”`); keep.type = 'button';
      keep.addEventListener('click', () => { confirmedFar.add(c.target); p.remove(); if (!box.querySelector('p')) box.hidden = true; });
      const use = el('button', 'small', 'Use the closest fits instead'); use.type = 'button';
      use.addEventListener('click', () => { $('targetRoles').value = [...csv($('targetRoles').value).filter(x => x !== c.target), ...c.closest].join(', '); p.remove(); if (!box.querySelector('p')) box.hidden = true; });
      p.append(' ', keep, ' ', use); box.append(p);
    }
    return;
  }
  profile = await api('/api/profile', { method: 'PUT', body: JSON.stringify(a) });
  show('roles');
});

// ---- 4. Extra roles ----
function drawRoles() {
  const seen = new Set(profile.targetRoles.map(r => r.toLowerCase()));
  const items = [];
  for (const r of lib?.roles || []) {
    if (seen.has(r.title.toLowerCase())) continue; seen.add(r.title.toLowerCase());
    items.push([r.title, r.reason || '']);
    for (const rel of r.related || []) if (!seen.has(rel.toLowerCase())) { seen.add(rel.toLowerCase()); items.push([rel, `Related to ${r.title}`]); }
  }
  $('roleList').replaceChildren(...items.slice(0, 16).map(([title, reason]) => {
    const l = el('label', 'choice');
    const c = el('input'); c.type = 'checkbox'; c.value = title; c.checked = (profile.extraRoles || []).includes(title);
    l.append(c, el('strong', null, title), el('span', 'note', reason));
    return l;
  }));
}
$('finish').addEventListener('click', async () => {
  const extraRoles = [...$('roleList').querySelectorAll('input:checked')].map(c => c.value);
  profile = await api('/api/profile', { method: 'PUT', body: JSON.stringify({ ...profile, extraRoles, done: true }) });
  await api('/api/refresh', { method: 'POST' });
  location.href = '/';
});

(async () => {
  [settings, profile, lib] = await Promise.all([api('/api/settings'), api('/api/profile'), api('/api/library')]);
  if (!lib?.entries) lib = null;
  await drawAi(); drawLibrary(); fillQuestions();
  $('tidy').hidden = !['codex', 'claude'].includes(settings.ai);
  show('ai');
})().catch(e => { document.querySelector('main').textContent = `The helper isn't answering: ${e.message}`; });
