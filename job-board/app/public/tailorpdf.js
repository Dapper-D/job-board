// Tailored resume and cover letter as one-page PDFs (pdfmake + Carlito, a free font with Calibri's metrics).
// The same file runs in the board page (window.TailorPDF) and in Node (require / import).
//
// Honesty rule: every resume line comes from the resume library (data/resume-lib.json), which is built from the
// person's own resume. The per-job "tailor" only picks and orders library items and writes the summary and
// cover letter; anything it names that isn't in the library is dropped.
// After the picks, the rest of their real experience and projects are added one at a time, each kept only if
// the resume is still exactly one page (measured by pdfmake, not estimated).
(function (root) {
  const LINK = '#0563C1';
  const link = (text, url) => ({ text, link: url, color: LINK, decoration: 'underline' });
  const low = s => String(s || '').toLowerCase();
  const noProto = u => String(u || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  // Bullets are real "•" characters so ATS text extraction keeps them; wrapped lines hang under the text.
  const bl = (content, gap) => ({ columns: [{ text: '•', width: 8 }, { text: content, width: '*' }], columnGap: 0, margin: [0, 0, 0, gap || 0] });

  // The posting's own title, minus location, employer name and bracketed notes, so a recruiter search by title finds it.
  const PLACE = /\b(remote|hybrid|on-?site|north america|americas|emea|apac|latam|usa|us|canada|uk|united states|united kingdom)\b/i;
  function jobTitle(job) {
    const co = low(job.company).split(/[\s(]/)[0];
    const loc = low(job.location).split(/[,|/]/).map(s => s.trim()).filter(s => s.length > 2);
    const t = String(job.title || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return t.split(/(\s+[-–—|]\s+|,\s+)/).reduce((out, part, i, a) => {
      if (i % 2) return out;
      const p = low(part);
      if (i && ((co && p.includes(co)) || PLACE.test(part) || loc.some(l => p.includes(l)))) return out;
      return out + (i ? a[i - 1] : '') + part;
    }, '').trim();
  }
  // Ends the summary with the role sought (never claims it was held). Skipped when the summary already names it.
  function withTitle(summary, job) {
    const t = jobTitle(job), s = String(summary || '').trim();
    if (!t || low(s).includes(low(t))) return s;
    return (s ? s.replace(/[.\s]*$/, '. ') : '') + 'Seeking ' + (/^[aeiou]/i.test(t) ? 'an ' : 'a ') + t + ' role.';
  }

  // Lines flagged "check" during setup (not found word for word in the resume) are never used until the person clears the flag.
  function usable(lib) {
    const keep = item => ({ ...item, bullets: (item.bullets || []).filter(b => b && b.text && !b.check) });
    return { ...lib, experience: (lib.experience || []).map(keep), projects: (lib.projects || []).map(keep) };
  }
  // Keep only library items; fall back to the library's own choices.
  function clean(lib, tl) {
    const allSkills = new Map();
    (lib.skills || []).forEach(g => (g.items || []).forEach(i => allSkills.set(low(i), i)));
    let skills = (tl.skills || []).map(g => ({ group: String(g.group || '').trim(), items: [...new Set((g.items || []).map(i => allSkills.get(low(i))).filter(Boolean))] }))
      .filter(g => g.group && g.items.length);
    if (!skills.length) skills = (lib.skills || []).map(g => ({ group: g.group, items: [...g.items] }));
    const expById = new Map((lib.experience || []).map(e => [e.id, e]));
    const projById = new Map((lib.projects || []).map(p => [p.id, p]));
    const pick = (list, byId) => {
      const seen = new Set(), out = [];
      for (const x of list || []) {
        const item = byId.get(x && x.id); if (!item || seen.has(item.id)) continue; seen.add(item.id);
        const ok = new Set(item.bullets.map(b => b.id));
        const ids = [...new Set((x.bullets || []).filter(b => ok.has(b)))];
        out.push({ id: item.id, bullets: ids.length ? ids : item.bullets.slice(0, 2).map(b => b.id) });
      }
      return out;
    };
    let exps = pick(tl.experience, expById);
    if (!exps.length) exps = (lib.experience || []).map(e => ({ id: e.id, bullets: e.bullets.slice(0, 3).map(b => b.id) }));
    const projs = pick(tl.projects, projById).slice(0, 6);
    return { skills, exps, projs, expById, projById };
  }

  function contactLine(lib) {
    const parts = [lib.contactLine ? lib.contactLine + ' | ' : ''];
    const bits = [];
    if (lib.email) bits.push(link(lib.email, 'mailto:' + lib.email));
    for (const l of lib.links || []) {
      if (!l || !/^https?:\/\//i.test(l.url || '')) continue;
      // LinkedIn shows its full address (ATS tools read it as text); other links show a short word.
      const text = /linkedin\.com/i.test(l.url) ? noProto(l.url) : (l.label || noProto(l.url));
      bits.push(link(text, l.url));
    }
    bits.forEach((b, i) => { if (i) parts.push(' | '); parts.push(b); });
    return parts.filter(p => p !== '');
  }

  function resumeDef(lib, tl, sel) {
    const W = 612 - 2 * 39.6;
    const sec = title => ({ stack: [
      { text: title, bold: true, fontSize: 11 },
      { canvas: [{ type: 'line', x1: 0, y1: 1, x2: W, y2: 1, lineWidth: 0.5, lineColor: '#444444' }] },
    ], margin: [0, 5, 0, 2] });
    const dated = (left, date) => ({ columns: [{ text: left, width: '*' }, { text: date || '', width: 'auto', alignment: 'right' }], margin: [0, 2.5, 0, 0.5] });
    const bullets = list => list.length ? { stack: list.map(x => bl(x)), margin: [4, 0.5, 0, 0] } : null;
    const text = (item, ids) => ids.map(id => (item.bullets.find(b => b.id === id) || {}).text).filter(Boolean);
    const project = ({ id, bullets: ids }) => {
      const pr = sel.projById.get(id);
      const line = [];
      if (pr.url && /^https?:\/\//i.test(pr.url)) line.push({ text: /github\.com/i.test(pr.url) ? 'GitHub: ' : 'Link: ' }, link(noProto(pr.url), pr.url));
      if (pr.stack) line.push({ text: (line.length ? ' | ' : '') + pr.stack, italics: true });
      return { stack: [
        { text: pr.title, bold: true, fontSize: 10.5, margin: [0, 3, 0, 0] },
        line.length ? { text: line } : null,
        bullets(text(pr, ids)),
      ].filter(Boolean), unbreakable: true };
    };
    const expBlock = sel.exps.length ? [sec('PROFESSIONAL EXPERIENCE'), ...sel.exps.flatMap(({ id, bullets: ids }) => {
      const e = sel.expById.get(id);
      return [dated({ text: e.title, bold: true }, e.dates), bullets(text(e, ids))].filter(Boolean);
    })] : [];
    const projBlock = sel.projs.length ? [sec(lib.projectsHeading || 'KEY PROJECTS'), ...sel.projs.map(project)] : [];
    return {
      pageSize: 'LETTER', pageMargins: [39.6, 28.8, 39.6, 28.8],
      info: { title: lib.name + ' - Resume', author: lib.name, creator: lib.name, subject: '', keywords: '' },
      defaultStyle: { font: 'Carlito', fontSize: 9.5 },
      content: [
        { text: lib.name, bold: true, fontSize: 16, alignment: 'center', margin: [0, 0, 0, 2] },
        { text: contactLine(lib), alignment: 'center', margin: [0, 0, 0, 2] },
        sec('PROFESSIONAL SUMMARY'), { text: tl.summary || '' },
        sec('SKILLS'), ...sel.skills.map(g => ({ text: [{ text: g.group + ': ', bold: true }, g.items.join(', ')], margin: [0, 0, 0, 1] })),
        ...((lib.education || []).length ? [sec('EDUCATION'), ...lib.education.map(ed => dated([{ text: ed.school, bold: true }, ed.detail ? ' — ' + ed.detail : ''], ed.dates))] : []),
        ...(lib.extras || []).filter(x => x && x.heading && (x.lines || []).length).flatMap(x => [sec(String(x.heading).toUpperCase()), bullets(x.lines)]),
        ...(tl.expFirst === false && projBlock.length ? [...projBlock, ...expBlock] : [...expBlock, ...projBlock]),
      ],
    };
  }

  function coverDef(lib, job, tl, company) {
    const c = tl.cover;
    const par = (text, after = 8) => ({ text, margin: [0, 0, 0, after] });
    const date = new Date((tl.at || new Date().toISOString().slice(0, 10)) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const to = (c.to && c.to.length ? c.to : ['Hiring Team', company]).filter(Boolean);
    return {
      pageSize: 'LETTER', pageMargins: [54, 54, 54, 54],
      info: { title: lib.name + ' - Cover Letter - ' + company, author: lib.name, creator: lib.name, subject: '', keywords: '' },
      defaultStyle: { font: 'Carlito', fontSize: 11, lineHeight: 1.1 },
      content: [
        { text: lib.name, bold: true, fontSize: 16, margin: [0, 0, 0, 2] },
        par(contactLine(lib), 14),
        par(date, 10),
        ...to.map((line, i) => par(line, i === to.length - 1 ? 10 : 0)),
        par({ text: 'Subject: Application for ' + (jobTitle(job) || c.subject || 'this role'), bold: true }, 10),
        par('Dear Hiring Manager,'),
        par([c.hook, lib.ident].filter(Boolean).join(' ')),
        ...((c.bullets || []).length ? [
          par([c.proof, 'This work has given me hands-on experience in:'].filter(Boolean).join(' '), 5),
          { stack: c.bullets.slice(0, 3).map(b => bl([{ text: b.label, bold: true }, ' ' + b.text], 4)), margin: [8, 0, 0, 8] },
        ] : [par(c.proof || '')]),
        par([c.why, c.gap, lib.start].filter(Boolean).join(' ')),
        par(c.close || 'Thank you for your time and consideration. I would welcome the chance to discuss how I could contribute to your team.'),
        par('Sincerely,', 0),
        par(lib.name, 0),
      ],
    };
  }

  function fileNames(lib, job) {
    const company = String(job.company || '').split(' (')[0];
    const short = String(job.title || '').replace(/\s*\(.*?\)\s*/g, ' ').split(/\s+[-–—|]\s+/)[0].trim();
    const fn = (company + ' - ' + short).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 70).trim();
    return { company, resume: lib.name + ' - Resume - ' + fn + '.pdf', cover: lib.name + ' - Cover Letter - ' + fn + '.pdf' };
  }

  // countPages(def) -> Promise<number>, supplied by the caller (browser or Node).
  // Returns { resume, cover, names }: pdfmake document definitions (cover is null when there is no letter).
  async function build(fullLib, job, tailor, countPages) {
    const lib = usable(fullLib);
    const names = fileNames(lib, job);
    const tl = { ...tailor, summary: withTitle(tailor.summary || lib.summary, job) };
    const sel = clean(lib, tl);
    const fits = async () => (await countPages(resumeDef(lib, tl, sel))) <= 1;
    const tryAdd = async (apply, undo) => { apply(); if (await fits()) return true; undo(); return false; };
    if (await fits()) {
      for (const e of lib.experience || []) if (!sel.exps.some(x => x.id === e.id) && e.bullets.length) {
        const row = { id: e.id, bullets: [e.bullets[0].id] };
        await tryAdd(() => sel.exps.push(row), () => sel.exps.pop());
      }
      for (const x of sel.exps) for (const b of sel.expById.get(x.id).bullets) {
        if (x.bullets.includes(b.id)) continue;
        await tryAdd(() => x.bullets.push(b.id), () => x.bullets.pop());
      }
      for (const p of lib.projects || []) {
        if (sel.projs.some(x => x.id === p.id) || sel.projs.length >= 6 || !p.bullets.length) continue;
        const d = p.bullets.slice(0, 2).map(b => b.id);
        if (!(await tryAdd(() => sel.projs.push({ id: p.id, bullets: d }), () => sel.projs.pop()))) await tryAdd(() => sel.projs.push({ id: p.id, bullets: d.slice(0, 1) }), () => sel.projs.pop());
      }
      for (const x of sel.projs) if (x.bullets.length < 2) {
        const extra = sel.projById.get(x.id).bullets.find(b => !x.bullets.includes(b.id));
        if (extra) await tryAdd(() => x.bullets.push(extra.id), () => x.bullets.pop());
      }
    }
    const resume = resumeDef(lib, tl, sel);
    const cover = tl.cover && tl.cover.hook && !tl.noAI ? coverDef(lib, job, tl, names.company) : null;
    return { resume, cover, names, summary: tl.summary };
  }

  // Text the person would be sending (used to catch a posting's AI-trap phrase before anything is saved).
  function writtenText(tl) {
    const c = (tl && tl.cover) || {};
    return [tl && tl.summary, c.subject, c.hook, c.proof, c.why, c.gap, c.close, ...(c.to || []), ...(c.bullets || []).flatMap(b => [b.label, b.text])].filter(Boolean).join(' ').toLowerCase();
  }

  const api = { build, jobTitle, withTitle, writtenText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TailorPDF = api;
})(typeof window !== 'undefined' ? window : globalThis);
