// Chrome's built-in AI is small, so the resume is read a part at a time; B3spoken joins the parts and checks
// every word against the resume like any other AI's answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitResume, chromePlan, mergeAnswers } from "../src/helper/resume/chromeread.mjs";
import { readResume } from "../src/helper/resume/aireader.mjs";
import { corpus } from "./fixtures/resume-corpus/score.mjs";

const master = corpus().find((c) => c.id === "kwame-master").text;

test("a resume is split into parts at headings or blank lines, and nothing is lost", () => {
  const long = Array.from({ length: 6 }, () => master).join("\n\n");
  const parts = splitResume(long, 1200);
  assert.ok(parts.length > 3);
  assert.equal(parts.join("\n").replace(/\s+/g, " ").trim(), long.replace(/\s+/g, " ").trim());
  for (const p of parts) assert.ok(p.length <= 1200 + 200, `part of ${p.length} characters`);
  assert.deepEqual(splitResume("Jo Example\njo@example.com", 1200), ["Jo Example\njo@example.com"]);
});

test("the plan the page runs has one prompt per part, each with the part as data and the answer shape", () => {
  const plan = chromePlan(master, 900);
  assert.ok(plan.prompts.length >= 2);
  plan.prompts.forEach((p, i) => assert.match(p, new RegExp(`part ${i + 1} of ${plan.prompts.length}`)));
  assert.match(plan.prompts[0], /<<<PART\n/);
  assert.equal(plan.schema.type, "object");
  assert.ok(plan.schema.properties.entries);
});

test("parts are joined: achievements that start a part belong to the entry the last part ended with", () => {
  const merged = mergeAnswers([
    { name: "Kwame Mensah", contact: ["kwame.mensah@example.net"], skills: [{ label: "Backend", items: ["Java"] }],
      entries: [{ kind: "experience", title: "Backend Developer", organization: "Quillfeather Payments", bullets: ["Built REST APIs."] }] },
    { name: "", contact: ["416-555-0123", "kwame.mensah@example.net"], skills: [{ label: "Delivery", items: ["Docker"] }],
      entries: [{ kind: "experience", title: "", bullets: ["Added JUnit tests."] }, { kind: "experience", title: "Backend Developer", organization: "Quillfeather Payments", bullets: ["Moved builds."] }, { kind: "projects", title: "LedgerLite", bullets: [] }] },
  ]);
  assert.equal(merged.name, "Kwame Mensah");
  assert.deepEqual(merged.contact, ["kwame.mensah@example.net", "416-555-0123"]);
  assert.equal(merged.skills.length, 2);
  assert.equal(merged.entries.length, 2);
  assert.deepEqual(merged.entries[0].bullets, ["Built REST APIs.", "Added JUnit tests.", "Moved builds."]);
});

test("the joined answer goes through the same word-for-word check as ChatGPT's or Claude's", async () => {
  const answers = [JSON.stringify({ name: "Kwame Mensah", contact: ["kwame.mensah@example.net"], entries: [
    { kind: "experience", title: "Backend Developer", organization: "Quillfeather Payments", dates: "Jul 2022–Present",
      bullets: ["Built REST APIs in Spring Boot for card refunds handling 20,000 requests a day.", "Wrote the best code in Canada."] }] }), "not json at all"];
  const { lib, usedAi, warnings } = await readResume(master, { provider: "chrome", answers });
  assert.equal(usedAi, true);
  assert.equal(lib.source, "chrome");
  const job = lib.entries[0];
  assert.equal(job.heading, "Backend Developer — Quillfeather Payments");
  assert.deepEqual(job.bullets.map((b) => b.flagged), [false, true]);
  assert.ok(warnings.some((w) => /1 part/.test(w)), warnings.join(" / ")); // the part it couldn't answer is said
});
