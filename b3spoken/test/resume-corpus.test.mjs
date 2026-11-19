// The made-up resume test set (test/fixtures/resume-corpus): 6 people written out in 10 layouts each.
// scripts/resume-eval.mjs runs the same set through a real AI; these tests run without one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLibrary } from "../src/helper/resume/library.mjs";
import { libraryFromAi, fromSource } from "../src/helper/resume/aireader.mjs";
import { corpus, scoreLibrary } from "./fixtures/resume-corpus/score.mjs";

const items = corpus();
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test("the test set has 60 resumes in 10 layouts, and every fact it expects is in the resume", () => {
  assert.equal(items.length, 60);
  assert.equal(new Set(items.map((c) => c.layout)).size, 10);
  for (const c of items) assert.ok(c.text.includes(c.person.email), c.id);
});

// What a careful AI would answer for each resume: the person's real facts. libraryFromAi then has to find every
// one of them in that layout's text, so this checks the word-for-word check works on every layout.
const MONTHS = { Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June", Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December" };
const long = (d) => d.replace(/^([A-Z][a-z]{2})\b/, (m) => MONTHS[m] || m);
// The dates as this layout writes them (a careful AI copies them as written).
const datesIn = (text, e) => !e.from ? "" : [e.to ? `${e.from} – ${e.to}` : e.from, `${long(e.from)} - ${long(e.to || "")}`].find((d) => fromSource(text, d)) || "";
const answer = (p, text) => ({
  name: p.name,
  contact: [p.email, p.phone, p.city, ...p.links],
  summary: p.summary,
  skills: p.skills.map(([label, items]) => ({ label, items })),
  entries: p.entries.map((e) => ({ kind: e.kind, title: e.title, organization: e.org, location: e.place || "", dates: datesIn(text, e), details: [e.tech, e.url].filter(Boolean), bullets: e.bullets })),
});

test("an AI's correct answer survives the word-for-word check in every layout", () => {
  const low = [];
  for (const c of items) {
    const { lib } = libraryFromAi(answer(c.person, c.text), c.text, "test");
    const s = scoreLibrary(lib, c.person, c.text);
    if (s.score < 0.95) low.push(`${c.id} ${Math.round(s.score * 100)}% ${JSON.stringify(s.checks)} ${s.misses.join(" | ")}`);
  }
  assert.deepEqual(low, []);
});

test("an AI that rewords everything gets nothing past the check", () => {
  for (const c of items.slice(0, 10)) {
    const a = answer(c.person, c.text);
    a.entries = a.entries.map((e) => ({ ...e, bullets: e.bullets.map((b) => `Successfully ${b.toLowerCase()}`) }));
    const { lib } = libraryFromAi(a, c.text, "test");
    assert.ok(lib.entries.flatMap((e) => e.bullets).every((b) => b.flagged || !/^Successfully/.test(b.text)), c.id);
  }
});

// B3spoken's own reader (used with no AI) is scored too, so a change that makes it worse fails here.
// These are its scores on 2026-11-19; raise them when it gets better.
const RULES_FLOOR = { classic: 1, pipes: 0.95, stacked: 0.5, labelled: 0.63, plain: 0.97, markdown: 0.32, linkedin: 0.12, wrapped: 0.76, french: 1, master: 0.68 };
test("B3spoken's own reader does no worse than before on any layout", () => {
  const by = {};
  for (const c of items) (by[c.layout] ||= []).push(scoreLibrary(buildLibrary(c.text), c.person, c.text).score);
  const worse = Object.entries(by).filter(([layout, xs]) => avg(xs) + 1e-9 < RULES_FLOOR[layout]).map(([l, xs]) => `${l} ${Math.round(avg(xs) * 100)}%`);
  assert.deepEqual(worse, []);
});
