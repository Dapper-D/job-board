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
const PLANS = { codex: 'Needs a ChatGPT Plus, Pro or Business plan.', claude: 'Needs a Claude Pro or Max plan.' };
const SIGNIN_HELP = {
  codex: 'A window opens and your browser asks you to sign in to ChatGPT. When the browser says you\u2019re signed in, close the window and click Check it works.',
  claude: 'A window opens. Pick any colour theme with Enter, choose "Claude account with subscription", and sign in in your browser. When it says you\u2019re logged in, close the window and click Check it works.',
};
const aiState = {}; // provider -> message under its buttons

function aiButtons(id, info) {
  const box = el('div', 'aiact');
  const btn = (text, fn, cls = 'small') => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', e => { e.preventDefault(); fn(b); }); return b; };
  const msgLine = el('p', 'note', aiState[id] || '');
  if (!info?.installed) {
    box.append(btn('Install it for me', async b => {
      b.disabled = true; b.textContent = 'Installing\u2026 (1\u20133 minutes)';
      await api('/api/ai/install', { method: 'POST', body: JSON.stringify({ provider: id }) });
      for (;;) {
        await new Promise(r => setTimeout(r, 2500));
        const st = (await api('/api/ai/install'))[id];
        if (st?.state === 'done') { aiState[id] = 'Installed. Next: sign in.'; break; }
        if (st?.state === 'failed') { aiState[id] = `The install didn\u2019t finish: ${(st.log || '').trim().split('\n').pop() || 'unknown error'}`; break; }
      }
      await api('/api/ai/detect', { method: 'POST' }); drawAi();
    }, 'small primary'));
  } else {
    box.append(btn('Sign in', async () => {
      try { await api('/api/ai/signin', { method: 'POST', body: JSON.stringify({ provider: id }) }); aiState[id] = SIGNIN_HELP[id]; }
      catch (e) { aiState[id] = e.message; }
      drawAi();
    }), btn('Check it works', async b => {
      b.disabled = true; b.textContent = 'Checking\u2026';
      const r = await api('/api/ai/test', { method: 'POST', body: JSON.stringify({ provider: id }) });
      aiState[id] = r.ok ? 'Working and signed in.' : r.error || 'It answered, but not as expected. Try signing in again.';
      if (r.ok) document.querySelector(`input[name="ai"][value="${id}"]`).checked = true;
      drawAi();
    }));
  }
  box.append(msgLine);
  return box;
}

async function drawAi() {
  const s = await api('/api/status');
  const chrome = 'LanguageModel' in self;
  const status = info => info?.working ? `Installed (${info.version}). ` : info?.installed ? 'Installed. ' : 'Not installed yet. ';
  const options = [
    ['codex', 'ChatGPT (Codex)', `${status(s.ai?.codex)}${PLANS.codex}`, true],
    ['claude', 'Claude (Claude Code)', `${status(s.ai?.claude)}${PLANS.claude}`, true],
    ['chrome', 'Chrome built-in AI', chrome ? 'Available in this browser' : 'Not available in this browser (needs desktop Chrome and a strong enough computer)', chrome],
    ['none', 'No AI', 'Tailoring picks and orders your own bullets by keyword match', true],
  ];
  const current = document.querySelector('input[name="ai"]:checked')?.value;
  const pick = current || (settings.ai !== 'auto' ? settings.ai : (s.ai?.codex?.working ? 'codex' : s.ai?.claude?.working ? 'claude' : 'none'));
  $('aiChoices').replaceChildren(...options.map(([id, label, note, ok]) => {
    const l = el('label', `choice${ok ? '' : ' off'}`);
    const r = el('input'); r.type = 'radio'; r.name = 'ai'; r.value = id; r.checked = id === pick; r.disabled = !ok;
    l.append(r, el('strong', null, label), el('span', 'note', note));
    if (id === 'codex' || id === 'claude') l.append(aiButtons(id, s.ai?.[id]));
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
  $('libraryBox').hidden = !lib; $('resumeNext').disabled = !lib?.entries?.some(e => !e.flagged && (e.bullets?.some(b => !b.flagged && b.text) || ['education', 'certifications'].includes(e.kind)));
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

async function drawKit() {
  const { found } = await api('/api/kit/find');
  $('kitBox').hidden = false;
  if (found.length) { $('kitDir').value = found[0]; $('kitMsg').textContent = `Found your kit at ${found[0]}.`; }
  else $('kitMsg').textContent = 'Type the folder your kit is in, or skip this.';
  $('kitGo').onclick = async () => {
    $('kitGo').disabled = true; $('kitMsg').textContent = 'Importing…';
    try {
      const r = await api('/api/kit/import', { method: 'POST', body: JSON.stringify({ dir: $('kitDir').value }) });
      $('kitMsg').textContent = `Brought over ${r.imported.join(', ')}. Check each step and click Next.`;
      [settings, profile, lib] = await Promise.all([api('/api/settings'), api('/api/profile'), api('/api/library')]);
      if (!lib?.entries) lib = null;
      await drawAi(); drawLibrary(); fillQuestions();
    } catch (e) { $('kitMsg').textContent = e.message; }
    finally { $('kitGo').disabled = false; }
  };
}

(async () => {
  [settings, profile, lib] = await Promise.all([api('/api/settings'), api('/api/profile'), api('/api/library')]);
  if (!lib?.entries) lib = null;
  await drawAi(); drawLibrary(); fillQuestions();
  if (!profile.done) drawKit().catch(() => {});
  $('tidy').hidden = !['codex', 'claude'].includes(settings.ai);
  show('ai');
})().catch(e => { document.querySelector('main').textContent = `The helper isn't answering: ${e.message}`; });
