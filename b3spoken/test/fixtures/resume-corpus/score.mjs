// Scores a resume library (what B3spoken read) against the made-up person it was written from.
// Each check is 0..1; the resume's score is their average. Used by test/resume-corpus.test.mjs and
// scripts/resume-eval.mjs (which can also score an AI's reading).
import { PERSONAS } from "./personas.mjs";
import { LAYOUTS } from "./layouts.mjs";
import { norm } from "../../../src/helper/resume/library.mjs";

export const corpus = () =>
  PERSONAS.flatMap((p) => Object.entries(LAYOUTS).map(([layout, write]) => ({ id: `${p.id}-${layout}`, layout, person: p, text: write(p) })));

const digits = (s) => String(s).replace(/\D/g, "");
const has = (hay, needle) => !needle || norm(hay).includes(norm(needle));
// Whole words only: "Git" is not in "github.com".
const word = (hay, w) => new RegExp(`(^|[^a-z0-9])${norm(w).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}($|[^a-z0-9])`).test(hay);
const year = (d) => (String(d).match(/(19|20)\d{2}/) || [""])[0];

// Only what the resume actually says is expected: a LinkedIn export has no phone number and lists three skills.
export function scoreLibrary(lib, p, source = "") {
  if (source) {
    const t = norm(source), in_ = (s) => t.includes(norm(s));
    // A skill named only in the summary or an achievement isn't on a skills list.
    const listed = norm([p.summary, ...p.entries.flatMap((e) => e.bullets)].reduce((t, x) => t.split(x).join(" "), source));
    p = { ...p, phone: digits(source).includes(digits(p.phone)) ? p.phone : "",
      skills: p.skills.map(([l, items]) => [l, items.filter((i) => word(listed, i))]).filter(([, items]) => items.length),
      entries: p.entries.filter((e) => in_(e.title)).map((e) => ({ ...e, bullets: e.bullets.filter(in_) })) };
  }
  const checks = {};
  const contact = [lib.contact?.name, ...(lib.contact?.lines || [])].join(" ");
  checks.name = norm(lib.contact?.name) === norm(p.name) ? 1 : 0;
  checks.email = (lib.contact?.lines || []).some((l) => l.includes(p.email)) ? 1 : 0;
  if (p.phone) checks.phone = digits(contact).includes(digits(p.phone)) ? 1 : 0;
  const entries = (lib.entries || []).filter((e) => !e.flagged);
  const text = (e) => [e.heading, e.dates, ...(e.details || [])].join(" ");
  const found = [], misses = [];
  let kind = 0, dates = 0, bullets = 0, bulletTotal = 0;
  for (const want of p.entries) {
    const got = entries.find((e) => has(e.heading, want.title) && (has(text(e), want.org) || want.kind === "projects"))
      || entries.find((e) => has(text(e), want.title) && has(text(e), want.org));
    if (!got) { misses.push(`${want.kind}: ${want.title}`); bulletTotal += want.bullets.length; continue; }
    found.push(got);
    if (got.kind === want.kind) kind++;
    const d = text(got);
    const toOk = !want.to || (/present/i.test(want.to) ? /present|current|now/i.test(d) : d.includes(year(want.to)));
    if (want.kind === "projects" || (d.includes(year(want.from)) && toOk)) dates++;
    const mine = norm(got.bullets.filter((b) => !b.flagged).map((b) => b.text).join(" \n "));
    for (const b of want.bullets) { bulletTotal++; if (mine.includes(norm(b))) bullets++; else misses.push(`bullet: ${b.slice(0, 50)}`); }
  }
  const n = p.entries.length;
  checks.entries = found.length / n;
  checks.kinds = found.length ? kind / n : 0;
  checks.dates = found.length ? dates / n : 0;
  checks.bullets = bulletTotal ? bullets / bulletTotal : 1;
  // Entries that aren't any of the person's real jobs, projects or schools (a wrapped line or a date read as a job).
  const extra = entries.filter((e) => !found.includes(e) && ["experience", "projects", "volunteer"].includes(e.kind));
  checks.noExtras = Math.max(0, 1 - extra.length / n);
  const skills = p.skills.flatMap(([, items]) => items);
  const mySkills = norm([...(lib.skills || []).flatMap((g) => g.items), lib.skillsText || ""].join(" , "));
  if (skills.length) checks.skills = skills.filter((s) => mySkills.includes(norm(s))).length / skills.length;
  const values = Object.values(checks);
  return { score: values.reduce((a, b) => a + b, 0) / values.length, checks, misses, extra: extra.map((e) => e.heading) };
}
