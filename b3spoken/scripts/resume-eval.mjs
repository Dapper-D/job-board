// Runs the made-up resume test set (test/fixtures/resume-corpus) through B3spoken's resume reader and prints
// a score per layout. With an AI, it also scores what that AI reads (the same path as Read it with an AI):
//   node scripts/resume-eval.mjs                 rules reader only
//   node scripts/resume-eval.mjs --ai claude     rules reader and Claude (codex, claude or gemini)
//   node scripts/resume-eval.mjs --ai claude --only master,linkedin --details
//   node scripts/resume-eval.mjs --ai claude --parts 900   reads part by part, the way Chrome's built-in AI does
//                                                        (the AI named stands in for Chrome's on-device model)
// Every person and resume in the set is invented, so this is safe to run anywhere.
import { buildLibrary } from "../src/helper/resume/library.mjs";
import { readWithAi, readResume } from "../src/helper/resume/aireader.mjs";
import { chromePlan } from "../src/helper/resume/chromeread.mjs";
import { ask } from "../src/helper/ai.mjs";
import { corpus, scoreLibrary } from "../test/fixtures/resume-corpus/score.mjs";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ""; };
const ai = arg("--ai"), parts = Number(arg("--parts")) || 0, only = arg("--only").split(",").filter(Boolean), details = process.argv.includes("--details");
const items = corpus().filter((c) => !only.length || only.includes(c.layout) || only.includes(c.id));

async function pool(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } }));
  return out;
}

const rows = await pool(items, ai ? 4 : 1, async (c) => {
  const rules = scoreLibrary(buildLibrary(c.text), c.person, c.text);
  let viaAi = null;
  if (ai) {
    try {
      let r;
      if (parts) {
        const plan = chromePlan(c.text, parts);
        const answers = [];
        for (const p of plan.prompts) answers.push(await ask(ai, `${plan.system}\n\n${p}`).catch(() => ""));
        r = await readResume(c.text, { provider: "chrome", answers });
        if (!r.usedAi) throw new Error(r.warnings[0]);
      } else r = await readWithAi(c.text, { provider: ai, ask });
      viaAi = scoreLibrary(r.lib, c.person, c.text);
    }
    catch (e) { viaAi = { score: 0, checks: {}, misses: [`AI failed: ${e.message.slice(0, 120)}`], extra: [] }; }
  }
  return { c, rules, viaAi };
});

const pct = (x) => `${Math.round(x * 100)}%`.padStart(5);
const byLayout = {};
for (const r of rows) (byLayout[r.c.layout] ||= []).push(r);
console.log(`layout      rules${ai ? `   ${ai}` : ""}`);
for (const [layout, rs] of Object.entries(byLayout)) {
  const avg = (k) => rs.reduce((a, r) => a + r[k].score, 0) / rs.length;
  console.log(`${layout.padEnd(10)} ${pct(avg("rules"))}${ai ? `   ${pct(avg("viaAi"))}` : ""}`);
}
const all = (k) => rows.reduce((a, r) => a + r[k].score, 0) / rows.length;
console.log(`${"ALL".padEnd(10)} ${pct(all("rules"))}${ai ? `   ${pct(all("viaAi"))}` : ""}   (${rows.length} resumes)`);
if (details)
  for (const r of rows) for (const [k, s] of Object.entries({ rules: r.rules, ...(ai ? { [ai]: r.viaAi } : {}) }))
    if (s.score < 1) console.log(`\n${r.c.id} [${k}] ${pct(s.score)} ${JSON.stringify(s.checks)}\n  missed: ${s.misses.slice(0, 6).join(" | ")}${s.extra.length ? `\n  extra: ${s.extra.slice(0, 4).join(" | ")}` : ""}`);
