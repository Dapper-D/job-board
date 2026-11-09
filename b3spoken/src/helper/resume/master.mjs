// Structured career inventories are source banks, not one-page resumes.
// Keep instructions/evidence notes out of application bullets.
const BULLET = /^[•▪◦‣*\-–\uf0b7]\s+/;
const heading = line => line.replace(/^#{1,6}\s+/, '').replace(/^\d+\s*[|.)]\s*/, '').replace(/\*\*/g, '').trim();
function kind(line) {
  const h = heading(line);
  if (/^(?:professional identity|professional summary|professional profile|positioning)/i.test(h)) return 'summary';
  if (/^(?:verified |professional |work )?(?:employment history|work experience|experience)$/i.test(h)) return 'experience';
  if (/^(?:key |selected )?projects?(?:\s*[—–:|-].*)?$/i.test(h)) return 'projects';
  if (/^(?:technical )?skill(?:s| matrix)(?:\s*[&—–:|-].*)?$/i.test(h)) return 'skills';
  if (/^education(?:[, &—–:|-].*)?$/i.test(h)) return 'education';
  return 'notes';
}
const numbered = line => /^\s*(?:#{1,6}\s*)?\d+\s*[|.)]\s+/.test(line);
const meta = /^(Context|Status\s*\/\s*ownership|Technical evidence|Claim boundary|Transferable strengths|Relevant studies|Academic recognition|Capstone|Professional positioning|Locations\s*\/\s*eligibility|Target job families):/i;
const nonClaim = /\b(?:do not|don't|never claim|always retain|before selecting|avoid claiming|inspect actual|include only when|current academic record)\b/i;

export function isMasterDocument(text) {
  return String(text).split(/\r?\n/).filter(l => numbered(l) && kind(l) !== 'notes').length >= 2;
}

export function buildMasterLibrary(text) {
  const source = String(text).replace(/\f/g, '\n').split(/\r?\n/).map(s => s.trim());
  const count = new Map();
  source.forEach(s => count.set(s, (count.get(s) || 0) + 1));
  const lines = source.filter(s => !(/^(?:master .*specification|page\s+\d+|\d+\s+of\s+\d+)/i.test(s) && count.get(s) > 1));
  const lib = { contact: { name: '', lines: [] }, summary: '', skills: [], entries: [], other: [], source: 'rules', notes: [] };
  let section = 'contact', entry = null, bullet = '', field = '', n = 0;
  const addSkill = (label, items) => {
    items = items.map(s => s.trim()).filter(Boolean);
    if (!items.length) return;
    let group = lib.skills.find(s => s.label === label);
    if (!group) lib.skills.push(group = { label, items: [] });
    for (const item of items) if (!group.items.includes(item)) group.items.push(item);
  };
  const flush = () => {
    if (bullet) {
      if (section === 'skills') {
        const m = bullet.match(/^([^:]+):\s+(.*)$/);
        if (m) addSkill(m[1], m[2].split(/;\s*/)[0].split(/,\s*/));
        else {
          const name = bullet.split(/\s+[—–]\s+/)[0];
          if (name.length < 70 && !nonClaim.test(name)) addSkill('Languages', name.split(/\s+and\s+/));
        }
      } else if (entry && !nonClaim.test(bullet)) entry.bullets.push({ id: `${entry.id}b${entry.bullets.length + 1}`, text: bullet, flagged: false });
      else if (entry) (entry.notes ||= []).push(bullet);
      bullet = '';
    }
  };
  const newEntry = (line, entryKind) => {
    flush(); field = '';
    const parts = line.split(/\s*\|\s*/);
    entry = { id: `e${++n}`, kind: entryKind, heading: parts[0], dates: '', details: [], bullets: [] };
    if (entryKind === 'experience') entry.dates = parts.slice(1).join(' | ');
    else if (parts[1]) entry.details.push(parts.slice(1).join(' | '));
    lib.entries.push(entry);
  };
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\*\*/g, '');
    if (numbered(line)) { flush(); section = kind(line); entry = null; field = ''; continue; }
    if (!line) { flush(); field = ''; continue; }
    if (section === 'contact') {
      if (!lib.contact.name && !/specification|master source|^verified|^master\b/i.test(line)) lib.contact.name = line;
      else if (/@|linkedin\.com|github\.com|\b\d{3}[- .]\d{3}[- .]\d{4}\b/.test(line)) lib.contact.lines.push(line);
      continue;
    }
    if (section === 'notes') continue;
    if (section === 'summary') {
      if (meta.test(line)) field = 'note';
      if (!field) lib.summary += (lib.summary ? ' ' : '') + line;
      else lib.notes.push(line);
      continue;
    }
    if (entry && field === 'repository' && !BULLET.test(line) && !meta.test(line)) {
      entry.details[entry.details.length - 1] = ((entry.details.at(-1) || '') + ' ' + line).trim(); continue;
    }
    if (entry && entry.kind === 'experience' && /[–—-]$/.test(entry.dates) && /^[A-Za-z]+\s+\d{4}/.test(line)) { entry.dates += line; continue; }
    if (section === 'skills' && bullet && /[.;]$/.test(bullet) && !BULLET.test(line) && !/[.;:]$/.test(line) && BULLET.test(lines.slice(index + 1).find(Boolean) || '')) { flush(); field = 'skill-section'; continue; }
    // Entries start with a title/date or title/stack, and education starts with the institution.
    if ((section === 'experience' && /\|\s*(?:[A-Za-z]+\s+)?(?:19|20)\d{2}/.test(line)) ||
        (section === 'projects' && /\s\|\s/.test(line) && !/^(Repository|Status|Technical|Claim)/.test(line)) ||
        (section === 'education' && /\b(?:College|University|Institute)\b.*\s[—–]\s/.test(line))) {
      newEntry(line, section); continue;
    }
    if (section === 'education' && /^Certifications and hands-on programs$/i.test(line)) { flush(); entry = null; field = 'certifications'; continue; }
    if (/^(Repository|Dates):/i.test(line)) {
      flush(); field = /^Repository/i.test(line) ? 'repository' : 'dates';
      const value = line.replace(/^[^:]+:\s*/, '');
      if (entry && field === 'dates') entry.dates = value;
      if (entry && field === 'repository') entry.details.push(value);
      continue;
    }
    if (meta.test(line)) { flush(); field = 'note'; if (entry) (entry.notes ||= []).push(line); continue; }
    if (BULLET.test(line)) {
      const certification = section === 'education' && field === 'certifications';
      flush();
      if (certification) { newEntry(line.replace(BULLET, ''), 'certifications'); field = 'certifications'; }
      else { field = ''; bullet = line.replace(BULLET, ''); }
      continue;
    }
    if (bullet) { bullet += ' ' + line; continue; }
    if (entry && field === 'dates') { entry.dates = (entry.dates + ' ' + line).trim(); continue; }
    if (entry && field === 'certifications') { entry.heading += ' ' + line; continue; }
    if (entry && !field && !entry.bullets.length) {
      if (entry.kind === 'projects' && entry.details.length) entry.details[0] += ' ' + line;
      else entry.heading += ' ' + line;
    }
  }
  flush();
  return lib;
}
