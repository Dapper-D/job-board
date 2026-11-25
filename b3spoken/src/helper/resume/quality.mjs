// How each resume line reads, measured against widely published resume guidance:
// lead with the result, use a strong verb, keep it to a line or two, and stay out of the first person.
// These are notes for the person, never rewrites. B3spoken does not touch the words on their resume.

// "Helped the team ship" says less than "Shipped". Flagged as openers only.
const WEAK_OPENERS = /^\s*(helped|assisted( with| in)?|participated in|was responsible for|responsible for|worked on|supported|involved in|tasked with|duties included)\b/i;
const FIRST_PERSON = /(^|[^a-z])(i|me|my|mine|we|our|us)([^a-z]|$)/i;
const HAS_NUMBER = /\d|\b(several|dozens?|hundreds?|thousands?)\b/i;
const LONG = 220; // about two printed lines at the sizes B3spoken uses

export function lineNotes(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  const notes = [];
  const weak = t.match(WEAK_OPENERS);
  if (weak) notes.push({ kind: "weak-opener", word: weak[0].trim(), says: `starts with "${weak[0].trim()}" — the stronger verb is usually the one after it` });
  if (FIRST_PERSON.test(t)) notes.push({ kind: "first-person", says: "written in the first person; resume lines usually drop I and we" });
  if (t.length > LONG) notes.push({ kind: "long", says: `${t.length} characters, over two printed lines` });
  if (!HAS_NUMBER.test(t)) notes.push({ kind: "no-number", says: "no figure in it; a number makes the result concrete, where you have one" });
  if (BUILT_WITH_AI.test(t)) notes.push({ kind: "built-with-ai", says: "names the AI tool in the same breath as what you built; readers take that as the tool's work. The tool belongs in Skills" });
  return notes;
}

// Credit for the work. A reader who sees the tool named in the sentence that says what was built often reads
// it as the tool's work, which is the opposite of what the line is for. The fact belongs in Skills.
const BUILT_WITH_AI = /\b(?:with|using|via)\s+(?:the\s+)?(?:help of\s+)?(?:ai[- ]assisted|ai\b|an?\s+ai\b|claude|chatgpt|gpt-?\d*|copilot|gemini|cursor|codex)\b/i;

// Every line in the library, with its notes. Flagged lines are left alone: they are already waiting on the person.
export function resumeNotes(lib) {
  const out = [];
  for (const e of lib?.entries || [])
    for (const b of e.bullets || []) {
      if (b.flagged || !b.text) continue;
      const notes = lineNotes(b.text);
      if (notes.length) out.push({ id: b.id, heading: e.heading, text: b.text, notes });
    }
  return out;
}

// A job with no employer on it. An applicant tracking system files the next word as the company
// ("Intern, Lagos, Nigeria" becomes a job at Lagos), and a reader wonders what is being left out.
export function entriesMissingEmployer(lib) {
  return (lib?.entries || [])
    .filter((e) => e.kind === "experience" && e.heading)
    .filter((e) => {
      const after = String(e.heading).split(/\s*,\s*/).slice(1);
      // Everything after the comma looks like a place, so no employer was named.
      return !after.length || after.every((part) => /^[A-Z][a-z]+(?:[ -][A-Z][a-z]+)*$/.test(part.trim()) && PLACEY.test(part.trim()));
    })
    .map((e) => e.heading);
}
// Words that read as somewhere rather than someone. Deliberately short: a wrong guess here is only a note.
const PLACEY = /^(?:remote|hybrid|canada|usa|united states|nigeria|india|ontario|quebec|alberta|manitoba|saskatchewan|toronto|vancouver|montreal|calgary|ottawa|lagos|abuja|london|dubai|[A-Z]{2})$/i;

// A short count for the health check: how many lines each note applies to.
export function noteCounts(lib) {
  const counts = {};
  for (const line of resumeNotes(lib))
    for (const n of line.notes) counts[n.kind] = (counts[n.kind] || 0) + 1;
  return counts;
}
