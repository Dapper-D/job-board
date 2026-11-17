// Structured career inventories are source banks, not one-page resumes.
// Keep instructions/evidence notes out of application bullets.
// PDFs often give "•Supported 80 students" with no space after the dot. A dash or a star is a bullet only with a
// space after it ("-5 C storage" and "**Bold**" are text).
const BULLET = /^(?:[•▪◦‣\uf0b7]\s*|[*\-–]\s+)/;
const heading = (line) =>
  line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\d+\s*[|.)]\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
function kind(line) {
  const h = heading(line);
  if (
    /^(?:professional identity|professional summary|professional profile|positioning)/i.test(
      h,
    )
  )
    return "summary";
  if (
    /^(?:verified |professional |work )?(?:employment history|work experience|experience)$/i.test(
      h,
    )
  )
    return "experience";
  if (/^(?:key |selected )?projects?(?:\s*[—–:|-].*)?$/i.test(h))
    return "projects";
  if (/^(?:technical )?skill(?:s| matrix)(?:\s*[&—–:|-].*)?$/i.test(h))
    return "skills";
  if (/^education(?:[, &—–:|-].*)?$/i.test(h)) return "education";
  return "notes";
}
const numbered = (line) => /^\s*(?:#{1,6}\s*)?\d+\s*[|.)]\s+/.test(line);
const sectionHeader = (line) => {
  if (numbered(line)) return true;
  const t = heading(line);
  if (t.length > 115) return false;
  // Recognize master section titles only, not the all-caps document cover.
  if (kind(t) !== "notes") return true;
  return /^(?:secondary project|reusable role|consistency & claims)/i.test(t);
};
const month =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const dateStart = new RegExp(`^(?:${month}\\s+)?(?:19|20)\\d{2}`, "i");
function experienceParts(line) {
  // A role/employer may itself contain an em dash: split only immediately before dates.
  if (
    /^(?:Context|Repository|Status|Technical evidence|Claim boundary):/i.test(
      line,
    )
  )
    return null;
  const separators = /\s*\|\s*|\s+[—–-]\s+/g;
  for (const m of line.matchAll(separators)) {
    const remainder = line.slice(m.index + m[0].length).trim();
    if (dateStart.test(remainder))
      return [line.slice(0, m.index).trim(), remainder];
  }
  const direct = line.match(
    new RegExp(
      `^(.+?)\\s+((?:${month}\\s+)?(?:19|20)\\d{2}\\s*[–—-](?:${month}\\s+)?(?:19|20)\\d{2}(?:\\s*\\(expected\\))?)$`,
      "i",
    ),
  );
  return direct ? [direct[1].trim(), direct[2].trim()] : null;
}
const meta =
  /^(Context|Status\s*\/\s*ownership|Technical evidence|Claim boundary|Transferable strengths|Relevant studies|Academic recognition|Capstone|Professional positioning|Locations\s*\/\s*eligibility|Target job families):/i;
const nonClaim =
  /\b(?:do not|don't|never claim|always retain|before selecting|avoid claiming|inspect actual|include only when|current academic record)\b/i;

// Where a master file keeps who the person is, and what its lines look like.
const IDENTITY = /\b(identity|contact|personal (details|information|info))\b/i;
const NAME_LABEL = /^(full |legal |preferred )?name$/;
const CONTACT_LABEL = /^(e-?mail|phone|mobile|cell|tel|telephone|linkedin|github|portfolio|website|web|location|address|city|based in)$/;
const CONTACT_VALUE = /@|linkedin\.com|github\.com|\b\d{3}[- .]\d{3}[- .]\d{4}\b/;
const COVER = /specification|master source|^verified|^master\b/i;

export function isMasterDocument(text) {
  const lines = String(text).split(/\r?\n/);
  const relevant = lines.filter((l) => sectionHeader(l) && kind(l) !== "notes");
  return (
    relevant.length >= 2 &&
    (relevant.some(numbered) ||
      /master (?:career|resume|résumé|source|specification)|verified employment history/i.test(
        text,
      ))
  );
}

export function buildMasterLibrary(text) {
  const source = String(text)
    .replace(/\f/g, "\n")
    .split(/\r?\n/)
    .map((s) => s.trim());
  const count = new Map();
  source.forEach((s) => count.set(s, (count.get(s) || 0) + 1));
  const lines = source.filter(
    (s) =>
      !(
        /^(?:master .*specification|page\s+\d+|\d+\s+of\s+\d+)/i.test(s) &&
        count.get(s) > 1
      ),
  );
  const lib = {
    contact: { name: "", lines: [] },
    summary: "",
    skills: [],
    entries: [],
    other: [],
    source: "rules",
    notes: [],
  };
  let section = "contact",
    fieldLine = -1,
    entry = null,
    bullet = "",
    field = "",
    n = 0;
  const addSkill = (label, items) => {
    items = items.map((s) => s.trim()).filter(Boolean);
    if (!items.length) return;
    let group = lib.skills.find((s) => s.label === label);
    if (!group) lib.skills.push((group = { label, items: [] }));
    for (const item of items)
      if (!group.items.includes(item)) group.items.push(item);
  };
  const flush = () => {
    if (bullet) {
      if (section === "skills") {
        const m = bullet.match(/^([^:]+):\s+(.*)$/);
        if (m) addSkill(m[1], m[2].split(/;\s*/)[0].split(/,\s*/));
        else {
          const name = bullet.split(/\s+[—–]\s+/)[0];
          if (name.length < 70 && !nonClaim.test(name))
            addSkill("Languages", name.split(/\s+and\s+/));
        }
      } else if (entry && !nonClaim.test(bullet))
        entry.bullets.push({
          id: `${entry.id}b${entry.bullets.length + 1}`,
          text: bullet,
          flagged: false,
        });
      else if (entry) (entry.notes ||= []).push(bullet);
      bullet = "";
    }
  };
  const newEntry = (line, entryKind) => {
    flush();
    field = "";
    const parts =
      entryKind === "experience"
        ? experienceParts(line) || [line, ""]
        : line.split(/\s*\|\s*/);
    entry = {
      id: `e${++n}`,
      kind: entryKind,
      heading: parts[0],
      dates: "",
      details: [],
      bullets: [],
    };
    if (entryKind === "experience") entry.dates = parts.slice(1).join(" | ");
    else if (parts[1]) entry.details.push(parts.slice(1).join(" | "));
    lib.entries.push(entry);
  };
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\*\*/g, "");
    if (sectionHeader(line)) {
      flush();
      // "1. CANDIDATE IDENTITY AND CONTACT": the name, email and phone live there, not above the first section.
      section = kind(line) === "notes" && IDENTITY.test(heading(line)) ? "contact" : kind(line);
      entry = null;
      field = "";
      continue;
    }
    if (!line) {
      flush();
      field = "";
      continue;
    }
    if (section === "contact") {
      // "Name: Jo Example", "Email: jo@example.com | Phone: 604-555-0100": the label names the field, the value is kept.
      const pieces = line.split(/\s+\|\s+/).map((piece) => {
        const m = piece.match(/^([A-Za-z][A-Za-z /-]{1,28}?)\s*:\s*(\S.*)$/);
        return m && !/^https?$/i.test(m[1]) ? { label: m[1].toLowerCase(), value: m[2].trim() } : { label: "", value: piece.trim() };
      });
      const named = pieces.find((x) => NAME_LABEL.test(x.label));
      if (named && !lib.contact.name) lib.contact.name = named.value;
      const fields = pieces.filter((x) => CONTACT_LABEL.test(x.label));
      if (named || fields.length) {
        // One field a line ("Phone: …", then "Email: …") still makes one contact line, in the order written.
        if (fields.length) {
          const values = fields.map((x) => x.value).join(" | ");
          if (fieldLine < 0) fieldLine = lib.contact.lines.push(values) - 1;
          else lib.contact.lines[fieldLine] += ` | ${values}`;
        }
        continue;
      }
      if (pieces.some((x) => x.label)) continue; // "Work authorization: …" and other notes about the person
      if (CONTACT_VALUE.test(line)) lib.contact.lines.push(line);
      else if (COVER.test(line)) {
        // "JO EXAMPLE - MASTER CAREER SPECIFICATION": the name is the part before the title.
        const own = line.match(/^(.{3,40}?)\s+[—–|:-]\s+/);
        if (!lib.contact.name && own && !COVER.test(own[1]) && /^[A-Za-z][A-Za-z.' -]+$/.test(own[1]) && own[1].trim().split(/\s+/).length <= 4)
          lib.contact.name = own[1].trim();
      } else if (!lib.contact.name && !/\d/.test(line)) lib.contact.name = line;
      continue;
    }
    if (section === "notes") continue;
    if (section === "summary") {
      if (meta.test(line)) field = "note";
      if (!field) lib.summary += (lib.summary ? " " : "") + line;
      else lib.notes.push(line);
      continue;
    }
    if (
      entry &&
      field === "repository" &&
      !BULLET.test(line) &&
      !meta.test(line) &&
      !(
        section === "projects" &&
        /\s[|]\s/.test(line) &&
        !/^(?:https?:\/\/|github\.com\/)/i.test(line)
      )
    ) {
      entry.details[entry.details.length - 1] = (
        (entry.details.at(-1) || "") +
        " " +
        line
      ).trim();
      continue;
    }
    if (
      entry &&
      entry.kind === "experience" &&
      /[–—-]$/.test(entry.dates) &&
      /^[A-Za-z]+\s+\d{4}/.test(line)
    ) {
      entry.dates += line;
      continue;
    }
    if (
      section === "skills" &&
      bullet &&
      /[.;]$/.test(bullet) &&
      !BULLET.test(line) &&
      !/[.;:]$/.test(line) &&
      BULLET.test(lines.slice(index + 1).find(Boolean) || "")
    ) {
      flush();
      field = "skill-section";
      continue;
    }
    // Entries start with a title/date or title/stack, and education starts with the institution.
    if (
      (section === "experience" && experienceParts(line) != null) ||
      (section === "projects" &&
        /\s\|\s/.test(line) &&
        !/^(Repository|Status|Technical|Claim|Context|https?:|github\.com|gitlab\.com)/i.test(
          line,
        )) ||
      (section === "education" &&
        /\b(?:College|University|Institute)\b.*\s[—–]\s/.test(line))
    ) {
      newEntry(line, section);
      continue;
    }
    if (
      section === "education" &&
      /^Certifications and hands-on programs$/i.test(line)
    ) {
      flush();
      entry = null;
      field = "certifications";
      continue;
    }
    if (/^(Repository|Dates):/i.test(line)) {
      flush();
      field = /^Repository/i.test(line) ? "repository" : "dates";
      const value = line.replace(/^[^:]+:\s*/, "");
      if (entry && field === "dates") entry.dates = value;
      if (entry && field === "repository") entry.details.push(value);
      continue;
    }
    if (meta.test(line)) {
      flush();
      field = "note";
      if (entry) (entry.notes ||= []).push(line);
      continue;
    }
    if (BULLET.test(line)) {
      const certification =
        section === "education" && field === "certifications";
      flush();
      if (certification) {
        newEntry(line.replace(BULLET, ""), "certifications");
        field = "certifications";
      } else {
        field = "";
        bullet = line.replace(BULLET, "");
      }
      continue;
    }
    if (bullet) {
      bullet += " " + line;
      continue;
    }
    if (entry && field === "dates") {
      entry.dates = (entry.dates + " " + line).trim();
      continue;
    }
    if (entry && field === "certifications") {
      entry.heading += " " + line;
      continue;
    }
    if (entry && !field && !entry.bullets.length) {
      if (entry.kind === "projects" && entry.details.length)
        entry.details[0] += " " + line;
      else entry.heading += " " + line;
    }
  }
  flush();
  return lib;
}
