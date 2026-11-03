// Gives the board the same small API it uses on claude.ai, backed by the local server.
(() => {
  const K = window.__KIT || {};
  // The session cookie (set when the shortcut opened the board) authenticates; this header proves the call comes from this page.
  const H = { 'content-type': 'application/json', 'x-kit-csrf': '1' };
  const api = async (path, body) => {
    const r = await fetch(path, body === undefined ? { headers: H } : { method: 'POST', headers: H, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) { document.body.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Your board session ended. Open the board again with the Job Board shortcut.' })); }
    if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.code = j.code || 'http_' + r.status; throw e; }
    return j;
  };
  let snap = null, ver = -1, loading = null;
  const subs = new Set();
  const load = async () => { snap = await api('/api/all'); ver = snap.v; window.__KIT.refreshing = !!snap.refreshing; subs.forEach(f => { try { f(); } catch (e) { console.error(e); } }); };
  const ensure = () => (snap ? Promise.resolve() : (loading = loading || load()));
  setInterval(async () => { try { const v = await api('/api/version'); window.__KIT.refreshing = !!v.refreshing; if (v.v !== ver) await load(); } catch (e) {} }, 4000);

  const docSnap = (data) => ({ exists: data != null, data: () => JSON.parse(JSON.stringify(data || {})) });
  const listSnap = (obj) => ({ docs: Object.entries(obj || {}).map(([id, v]) => ({ id, data: () => JSON.parse(JSON.stringify(v)) })) });
  const watch = (get, cb, onErr) => {
    const f = () => cb(get());
    subs.add(f); ensure().then(f).catch(e => onErr && onErr(e));
    return () => subs.delete(f);
  };
  const write = async (path, op, data) => { await api('/api/write', { path, op, data }); await load(); };

  const db = {
    collection(p) {
      if (p === 'jobs') return { onSnapshot: (cb, err) => watch(() => listSnap(snap.jobs), cb, err) };
      if (p === 'stories') return {
        onSnapshot: (cb, err) => watch(() => listSnap(snap.stories), cb, err),
        doc: id => ({ update: d => write('stories/' + id, 'update', d) }),
      };
      if (/^data\/users\/[^/]+$/.test(p)) return {
        doc: n => ({
          get: async () => { await ensure(); return docSnap(snap.user[n]); },
          set: d => write('user/' + n, 'set', d),
          update: d => write('user/' + n, 'update', d),
          onSnapshot: (cb, err) => watch(() => docSnap(snap.user[n]), cb, err),
        }),
      };
      throw new Error('unknown collection ' + p);
    },
    doc(p) {
      if (p === 'resume/lib') return { onSnapshot: (cb, err) => watch(() => docSnap(snap.lib), cb, err) };
      if (p === 'meta/run') return { onSnapshot: (cb, err) => watch(() => docSnap(snap.meta && Object.keys(snap.meta).length ? snap.meta : null), cb, err) };
      throw new Error('unknown doc ' + p);
    },
  };
  const sample = async (input, opts = {}) => {
    const r = await api('/api/ai', { prompt: String(input) });
    if (r.error) { const e = new Error(r.error); e.code = r.code; throw e; }
    if (opts.onText) try { opts.onText({ text: r.text, delta: r.text }); } catch (e) {}
    return { text: r.text, truncated: false };
  };
  const downloads = { save: async ({ filename, data, mimeType }) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mimeType || 'text/plain' }));
    a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return { status: 'saved' };
  } };
  const user = { id: async () => 'me' };
  window.claude = { use: async n => ({ db, sample, downloads, user })[n] || null };
  window.__KIT.api = api; window.__KIT.reload = load;
})();
