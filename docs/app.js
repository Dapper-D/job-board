// Renders docs/data/jobs.json and meta.json. No build step, no dependencies.
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const STATUSES = ['Not started', 'Draft prepared', 'Applied', 'Viewed', 'Interview', 'Rejected', 'Not interested'];
  const KEY = 'jobboard.tracker.v1';

  const S = { jobs: [], track: 'all', region: 'all', status: 'all', only100: false, onlyApply: false, sort: 'overall', tracker: loadTracker() };

  function loadTracker() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveTracker() {
    try { localStorage.setItem(KEY, JSON.stringify(S.tracker)); } catch (e) { /* private window: keep in memory */ }
  }

  const fmtDate = (d) => {
    if (!d) return 'not shown';
    const x = new Date(String(d).slice(0, 10) + 'T12:00:00');
    return isNaN(x) ? d : x.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const recClass = (r) => (r === 'Apply' ? 'good' : r === 'Stretch' ? 'warn' : 'bad');
  const levelClass = (s) => (s === 'Strong' ? 'good' : s === 'Partial' ? 'warn' : 'bad');
  const safeUrl = (u) => (/^https:\/\//i.test(u || '') ? u : null);

  function render() {
    const list = $('#list');
    list.replaceChildren();
    let jobs = S.jobs.filter((j) => j.active !== false);
    $('#cTotal').textContent = jobs.length;
    $('#c100').textContent = jobs.filter((j) => (j.salaryMax || 0) >= 100000).length;
    $('#cApply').textContent = jobs.filter((j) => j.rec === 'Apply').length;
    if (!jobs.length) {
      list.append(el('div', 'empty', 'No postings yet. Run the "Refresh job board" workflow in GitHub Actions, or run python -m jobboard refresh, to fill the board.'));
      return;
    }
    const status = (j) => S.tracker[j.id] || 'Not started';
    if (S.track !== 'all') jobs = jobs.filter((j) => (j.tracks || []).includes(S.track));
    if (S.region !== 'all') jobs = jobs.filter((j) => (j.region || 'Canada') === S.region);
    if (S.status !== 'all') jobs = jobs.filter((j) => status(j) === S.status);
    if (S.only100) jobs = jobs.filter((j) => (j.salaryMax || 0) >= 100000);
    if (S.onlyApply) jobs = jobs.filter((j) => j.rec === 'Apply');
    const by = {
      overall: (a, b) => (b.overall - a.overall) || (b.tech - a.tech) || ((b.salaryMax || 0) - (a.salaryMax || 0)),
      salary: (a, b) => (b.salaryMax || 0) - (a.salaryMax || 0),
      posted: (a, b) => String(b.posted || b.firstSeen || '').localeCompare(String(a.posted || a.firstSeen || '')),
    };
    jobs.sort(by[S.sort]);
    if (!jobs.length) { list.append(el('div', 'empty', 'No postings match these filters.')); return; }
    jobs.forEach((j) => list.append(card(j)));
  }

  function card(j) {
    const a = el('article', 'job');
    a.dataset.rec = j.rec || '';
    a.append(el('div', 'stripe'));
    const b = el('div', 'body');
    a.append(b);

    const head = el('div', 'row');
    head.append(
      el('h3', null, j.title),
      el('span', 'pill ' + recClass(j.rec), j.rec || '—'),
      el('span', 'pill ' + (j.verify === 'employer' ? 'acc' : ''), j.verify === 'employer' ? "Company's own job board" : 'Listed on ' + (j.sourceName || 'a job board')),
    );
    b.append(head);

    const m = el('div', 'meta');
    m.append(
      el('span', 'co', j.company),
      el('span', 'pill', j.region || 'Canada'),
      el('span', null, [j.location, j.mode].filter(Boolean).join(' · ')),
      el('span', 'mono', j.salary || 'Salary not posted'),
      el('span', null, 'Posted ' + fmtDate(j.posted)),
      el('span', 'mono', 'Checked ' + fmtDate(j.checked)),
    );
    b.append(m);

    const sc = el('div', 'scores');
    [['Technical', j.tech], ['Overall fit', j.overall]].forEach(([k, v]) => {
      const s = el('div', 'score');
      const bar = el('div', 'bar');
      const i = el('i');
      i.style.width = Math.max(0, Math.min(10, v || 0)) * 10 + '%';
      bar.append(i);
      s.append(el('span', 'lbl', k), bar, el('span', 'mono', (v ?? '–') + '/10'));
      sc.append(s);
    });
    b.append(sc);
    if (j.why) b.append(el('p', 'note', j.why));

    const d = el('details');
    d.append(el('summary', null, 'Requirements vs. your evidence'));
    const wrap = el('div', 'tbl');
    const t = el('table', 'req');
    const tb = el('tbody');
    (j.req || []).forEach((q) => {
      const tr = el('tr');
      const td = el('td');
      td.append(el('span', 'pill ' + levelClass(q.s), q.s));
      tr.append(el('td', null, q.r), el('td', null, q.e || ''), td);
      tb.append(tr);
    });
    t.append(tb);
    wrap.append(t);
    d.append(wrap);
    if (j.blockers) d.append(el('p', 'note', 'Check first: ' + j.blockers));
    if (j.projects && j.projects.length) d.append(el('p', 'note', 'Resume project order: ' + j.projects.join(' → ')));
    if (j.scoredBy) d.append(el('p', 'note', 'Scored by ' + j.scoredBy + '.'));
    b.append(d);

    const act = el('div', 'actions');
    const url = safeUrl(j.applyUrl);
    if (url) {
      const ap = el('a', 'btn primary', 'Apply ↗');
      ap.href = url;
      ap.target = '_blank';
      ap.rel = 'noopener noreferrer';
      act.append(ap);
    }
    const sel = el('select');
    sel.id = 'st-' + j.id;
    sel.setAttribute('aria-label', 'Application status for ' + j.title);
    STATUSES.forEach((o) => sel.append(el('option', null, o)));
    sel.value = S.tracker[j.id] || 'Not started';
    sel.addEventListener('change', () => {
      if (sel.value === 'Not started') delete S.tracker[j.id]; else S.tracker[j.id] = sel.value;
      saveTracker();
      if (S.status !== 'all') render();
    });
    act.append(sel);
    b.append(act);
    return a;
  }

  function renderMeta(meta) {
    if (meta.site && meta.site.title) { $('#siteTitle').textContent = meta.site.title; document.title = meta.site.title; }
    if (meta.site && meta.site.subtitle) $('#siteSubtitle').textContent = meta.site.subtitle;
    if (meta.lastRun) $('#cRun').textContent = fmtDate(meta.lastRun);
    if (meta.scoredBy) $('#scoredBy').textContent = 'Scored with ' + meta.scoredBy + '. Added ' + (meta.added || 0) + ', closed ' + (meta.closed || 0) + ' in this run.';

    const src = $('#sources');
    src.replaceChildren();
    (meta.sources || []).forEach((s) => {
      const tr = el('tr');
      tr.append(el('td', null, s.label), el('td', null, s.ok ? String(s.count) : 'failed'));
      if (!s.ok && s.error) tr.title = s.error;
      src.append(tr);
    });
    if (!src.children.length) { const tr = el('tr'); tr.append(el('td', null, 'No refresh yet.'), el('td')); src.append(tr); }

    const fill = (id, items, empty) => {
      const ul = $(id);
      ul.replaceChildren();
      if (!items.length) ul.append(el('li', null, empty));
      items.forEach((x) => ul.append(el('li', null, x)));
    };
    fill('#removed', meta.removed || [], 'None yet.');
    fill('#skipped', Object.entries(meta.skipped || {}).map(([k, v]) => v + ' · ' + k), 'Nothing yet.');
  }

  async function getJson(path) {
    const r = await fetch(path + '?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(path + ' returned ' + r.status);
    return r.json();
  }

  document.querySelectorAll('.chip[data-v]').forEach((c) => c.addEventListener('click', () => {
    document.querySelectorAll('.chip[data-v]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    c.setAttribute('aria-pressed', 'true');
    S.track = c.dataset.v;
    render();
  }));
  $('#f100').addEventListener('click', (e) => { S.only100 = !S.only100; e.currentTarget.setAttribute('aria-pressed', String(S.only100)); render(); });
  $('#fApply').addEventListener('click', (e) => { S.onlyApply = !S.onlyApply; e.currentTarget.setAttribute('aria-pressed', String(S.onlyApply)); render(); });
  $('#sort').addEventListener('change', (e) => { S.sort = e.target.value; render(); });
  $('#region').addEventListener('change', (e) => { S.region = e.target.value; render(); });
  $('#status').addEventListener('change', (e) => { S.status = e.target.value; render(); });

  Promise.all([getJson('data/jobs.json'), getJson('data/meta.json').catch(() => ({}))])
    .then(([data, meta]) => { S.jobs = data.jobs || []; renderMeta(meta); render(); })
    .catch(() => {
      $('#list').replaceChildren(el('div', 'empty',
        location.protocol === 'file:'
          ? 'Open this page through a web server: run python -m jobboard serve, then visit http://localhost:8000.'
          : "The job data couldn't load. Reload the page; if it keeps failing, check that docs/data/jobs.json exists."));
    });
})();
