// The role picker, shared by setup's last step and the "new role ideas" pop-up on the board.
// Shows the AI's career ideas (strengths and industries to read; roles as switches, off until ticked) with real job
// counts and pay, or the quick rule-based roles when no AI is connected.
(() => {
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const money = n => (n == null ? '' : `$${Math.round(n / 1000)}k`);
  const market = m => (!m ? '' : m.count ? `${m.count} posting${m.count === 1 ? '' : 's'} on the board now${m.median ? `, typical pay ${money(m.median)}${m.top && m.top > m.median ? ` (up to ${money(m.top)})` : ''}` : ''}` : 'none on the board right now');

  // career: GET /api/career (or null). ruleRoles: [{title, reason}]. on: titles already searched (extra roles).
  // only: titles to offer (the pop-up's new ideas); without it, every idea is offered.
  // Returns { picked(): ticked titles, shown(): every title offered }.
  function draw(box, { career = null, ruleRoles = [], on = [], fixed = [], only = null } = {}) {
    const isOn = new Set(on.map(t => t.toLowerCase())), skip = new Set(fixed.map(t => t.toLowerCase())), offered = new Map();
    const want = only && new Set(only.map(t => t.toLowerCase()));
    box.replaceChildren();
    const section = (title, rows) => { if (!rows.length) return; const d = mk('div', 'pick-group'); d.append(mk('h3', null, title), ...rows); box.append(d); };
    const sw = (t, extra = [], always = false) => {
      const k = t.title.toLowerCase();
      if (skip.has(k) || offered.has(k) || (want && !want.has(k) && !always)) return null;
      const l = mk('label', 'choice'); const c = mk('input'); c.type = 'checkbox'; c.value = t.title; c.checked = isOn.has(k);
      const text = mk('span', 'choice-text');
      const head = mk('strong', null, t.title); if (t.level) head.append(' ', mk('span', 'tag', t.level));
      text.append(head, mk('span', 'note', t.why || t.reason || ''), ...extra.filter(Boolean).map(x => mk('span', 'note fine', x)));
      l.append(c, text); offered.set(k, c);
      return l;
    };
    const rows = (list, extra = () => []) => list.map(t => sw(t, [...extra(t), market(t.market)])).filter(Boolean);
    if (career?.titles) {
      if (!only) {
        const info = (title, list, a, b) => { if (!list?.length) return; const d = mk('div', 'pick-group info'); d.append(mk('h3', null, title)); for (const x of list) { const p = mk('p'); p.append(mk('strong', null, `${x[a]}: `), document.createTextNode(x[b] || '')); d.append(p); } box.append(d); };
        info('Your strongest skills', career.strengths, 'skill', 'evidence');
        info('Industries that value your background', career.industries, 'name', 'why');
      }
      section('Roles you qualify for now', rows(career.titles));
      section('Roles you may not have considered', rows(career.unexpected));
      section('Better-paid paths', rows(career.higherPay, t => [t.gap ? `To get there: ${t.gap}` : '']));
    } else section('Roles your resume supports', ruleRoles.map(r => sw(r)).filter(Boolean));
    // In the pop-up, the roles already searched are listed too, so any can be switched off.
    if (only) section('Roles you search for now', on.filter(t => !skip.has(t.toLowerCase()) && !offered.has(t.toLowerCase())).map(t => sw({ title: t }, [], true)).filter(Boolean));
    if (!offered.size) box.append(mk('p', 'note', 'No other roles to suggest right now.'));
    return { picked: () => [...offered.values()].filter(c => c.checked).map(c => c.value), shown: () => [...offered.values()].map(c => c.value) };
  }
  window.rolePicker = { draw };
})();
