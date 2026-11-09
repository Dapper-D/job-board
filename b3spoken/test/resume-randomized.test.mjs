// Deterministic, fictional fixtures: no real applicant data or network calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLibrary, checkAiLibrary } from "../src/helper/resume/library.mjs";
import { isMasterDocument } from "../src/helper/resume/master.mjs";
import {
  planResume,
  renderResumeWithReport,
  checkTailored,
  TAILOR_PROMPT,
} from "../src/helper/tailor/tailor.mjs";
import { yearsOfExperience } from "../src/helper/tailor/match.mjs";
import { extractText } from "../src/helper/resume/extract.mjs";

const rng = (seed) => () =>
  ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const job = {
  title: "Junior Software Engineer",
  company: "Example Systems",
  description:
    "Java Python React SQL Node API testing Docker customer support and frontend development",
};
const titles = [
  "Software Developer",
  "Frontend Engineer",
  "Backend Developer",
  "QA Engineer",
  "Customer Support Analyst",
  "Application Engineer",
];
const orgs = [
  "Orion Systems",
  "Beacon Analytics",
  "Cedar Solutions",
  "Pine Labs",
  "Mosaic Software",
];
const projects = [
  "Event Planner",
  "Inventory Tracker",
  "News Digest",
  "Customer Portal",
  "API Monitor",
  "Device Dashboard",
];
const dates = [
  "January 2023–September 2024",
  "October 2025–Present",
  "Mar 2021 - Aug 2021",
  "May 2025–Present",
];
const symbols = ["•", "▪", "\uf0b7", "-"];
function fixture(seed, format) {
  const r = rng(seed);
  const nExp = 2 + Math.floor(r() * 4),
    nProj = 2 + Math.floor(r() * 4);
  const exp = [],
    proj = [];
  for (let i = 0; i < nExp; i++) {
    const title = pick(r, titles),
      org = pick(r, orgs),
      date = pick(r, dates);
    exp.push({
      title,
      org,
      date,
      name: `${title} — ${org}`,
      bullets: [
        `Built Java and Python tools to automate daily analysis for internal project teams number ${i}.`,
        `Implemented REST APIs and SQL queries with automated testing for customer applications number ${i}.`,
      ],
    });
  }
  for (let i = 0; i < nProj; i++) {
    const name = `${pick(r, projects)} ${i + 1}: ${pick(r, ["Web Application", "Dashboard", "API Service"])}`;
    proj.push({
      name,
      url: `github.com/example/test-${seed}-${i}`,
      bullets: [
        `Built a React and Node application with API integration for workflows number ${i}.`,
        `Added JavaScript integration tests and deployed a responsive interface for users number ${i}.`,
      ],
    });
  }
  const lines = [
    "TEST CANDIDATE",
    "Vancouver BC | test@example.test | github.com/example",
    "",
  ];
  if (format === "standard") {
    lines.push(
      pick(r, ["PROFESSIONAL SUMMARY", "SUMMARY"]),
      "Software developer building Java, React and SQL services.",
      "",
      "SKILLS",
      "Languages: Java, Python, JavaScript, SQL",
      "Frameworks: React, Node, Express",
      "",
      pick(r, ["KEY PROJECTS", "PERSONAL PROJECTS", "PROJECTS"]),
    );
    for (const p of proj) {
      lines.push(
        `${pick(r, symbols)} ${p.name}`,
        `GitHub: ${p.url} | Java, React, Node`,
      );
      for (const [index, bullet] of p.bullets.entries()) {
        if (index === 1 && r() < 0.35)
          lines.push(
            `${pick(r, symbols)} ${bullet.slice(0, 42)}`,
            bullet.slice(42),
          );
        else lines.push(`${pick(r, symbols)} ${bullet}`);
      }
    }
    lines.push(
      "",
      pick(r, ["PROFESSIONAL EXPERIENCE", "WORK EXPERIENCE", "EXPERIENCE"]),
    );
    for (const e of exp) {
      lines.push(`${e.title}, ${e.org}, Vancouver BC ${e.date}`);
      for (const bullet of e.bullets)
        lines.push(`${pick(r, symbols)} ${bullet}`);
    }
    if (r() < 0.6)
      lines.push(
        "ADDITIONAL EXPERIENCE",
        "Walmart Advanced Software Engineering Job Simulation — Forage, 2026 - Implemented a modified heap",
        "data structure in Java and documented tests",
      );
    lines.push(
      "EDUCATION",
      "Example University, Bachelor of Science in Computer Science Jan 2018 – Aug 2022",
    );
  } else {
    const numbered = r() > 0.5;
    const sec = (id, label) => (numbered ? `${id} | ` : "") + label;
    lines.push(
      "VERIFIED MASTER CAREER SPECIFICATION",
      sec(1, "PROFESSIONAL IDENTITY & POSITIONING"),
      "Software developer building Java, Python and React applications.",
      sec(2, "VERIFIED EMPLOYMENT HISTORY"),
    );
    for (const e of exp) {
      const sep = pick(r, [" | ", " — ", " - "]);
      lines.push(
        `${e.name}${sep}${e.date}`,
        "Context: Vancouver, British Columbia; technical project work.",
      );
      for (const bullet of e.bullets)
        lines.push(`${pick(r, symbols)} ${bullet}`);
    }
    lines.push(
      sec(3, "PROJECTS — IMPLEMENTATION, OWNERSHIP, TECHNICAL EVIDENCE"),
    );
    for (const p of proj) {
      lines.push(
        `${p.name} | React • Node • Java • SQL`,
        `Repository: ${p.url}`,
      );
      for (const bullet of p.bullets)
        lines.push(`${pick(r, symbols)} ${bullet}`);
      lines.push("Claim boundary: Do not invent project outcomes.");
    }
    lines.push(
      sec(4, "SECONDARY PROJECT & REPOSITORY INVENTORY"),
      "Do not include ideas without evidence.",
      sec(5, "TECHNICAL SKILL MATRIX & EVIDENCE"),
      "Languages and programming fundamentals",
      "• Java — Programming and unit tests.",
      "• Python — API development.",
      sec(6, "EDUCATION, TRAINING & RECOGNITION"),
      "Example University — Bachelor of Science, Computer Science",
      "Dates: January 2018–August 2022",
      sec(7, "CONSISTENCY & CLAIMS CONTROL"),
      "Never invent professional employment.",
    );
  }
  return { text: lines.join("\n"), exp, proj };
}

test("120 deterministic synthetic resumes: import, role retention, project links, PDF generation", () => {
  for (let seed = 1; seed <= 120; seed++) {
    const format = seed % 2 ? "standard" : "master";
    const { text, exp, proj } = fixture(seed, format);
    const lib = buildLibrary(text);
    const jobs = lib.entries.filter((e) => e.kind === "experience");
    const projects = lib.entries.filter((e) => e.kind === "projects");
    assert.equal(
      jobs.length,
      exp.length,
      `seed ${seed} ${format} jobs: ${jobs.map((e) => e.heading)}`,
    );
    assert.equal(
      projects.length,
      proj.length,
      `seed ${seed} ${format} projects: ${projects.map((e) => e.heading)}`,
    );
    assert(
      jobs.every((e) => e.heading && e.dates),
      `seed ${seed} dates`,
    );
    assert(
      projects.every((e) => e.details.some((x) => x.includes("github.com"))),
      `seed ${seed} repository`,
    );
    assert(
      !lib.entries.some((e) =>
        /^(?:GitHub:|ADDITIONAL EXPERIENCE$|\\(untitled\\))/.test(e.heading),
      ),
      `seed ${seed} phantom`,
    );
    const plan = planResume(lib, job);
    const rendered = renderResumeWithReport(plan);
    const output = extractText(rendered.pdf, "fictional.pdf").text;
    assert.match(output, /TEST CANDIDATE/);
    assert.equal(
      rendered.included.experience.length >= Math.min(3, exp.length),
      true,
      `seed ${seed} minimum jobs`,
    );
    assert(
      rendered.included.projects.length >= 1,
      `seed ${seed} at least one project`,
    );
    assert(
      projects.some((p) => output.includes(p.heading)),
      `seed ${seed} project heading in output`,
    );
    assert(
      output.includes("github.com/example/test-"),
      `seed ${seed} hyperlink printed`,
    );
    assert.equal(
      rendered.pdf.toString("latin1").includes("/Count 1 "),
      true,
      `seed ${seed} one page`,
    );
  }
});

test("AI selection never silently reintroduces omitted projects, and cannot drop nearly all jobs", () => {
  const sample = buildLibrary(fixture(50000, "master").text);
  const jobs = sample.entries.filter((e) => e.kind === "experience"),
    projects = sample.entries.filter((e) => e.kind === "projects");
  assert(jobs.length >= 4);
  const bad = checkTailored(
    {
      experience: [{ id: jobs[0].id, bullets: [jobs[0].bullets[0].id] }],
      projects: [],
    },
    sample,
    {},
    job,
  );
  assert.match(bad.problem, /fewer than two/);
  const good = checkTailored(
    {
      experience: jobs
        .slice(0, 2)
        .map((e) => ({ id: e.id, bullets: [e.bullets[0].id] })),
      projects: projects
        .slice(0, 2)
        .map((e) => ({ id: e.id, bullets: [e.bullets[0].id] })),
    },
    sample,
    {},
    job,
  );
  assert.equal(good.problem, "");
  const plan = planResume(sample, job, { ai: good.tailored });
  assert.equal(plan.experience.length, 2);
  assert.equal(plan.projects.length, 2);
});

test("AI library tidy keeps project repository fields from the rules parser", () => {
  const text = fixture(251, "standard").text;
  const source = buildLibrary(text);
  const ai = {
    name: source.contact.name,
    entries: source.entries.map((e) => ({
      kind: e.kind,
      heading: e.heading,
      dates: e.dates,
      bullets: e.bullets.map((b) => b.text),
    })),
  };
  const checked = checkAiLibrary(ai, text, "mock");
  assert.equal(
    checked.entries.filter(
      (e) =>
        e.kind === "projects" && e.details.some((d) => /github\.com/.test(d)),
    ).length,
    source.entries.filter((e) => e.kind === "projects").length,
  );
});

test("oversized prompts contain valid JSON, including the final available career entry", () => {
  const lib = buildLibrary(fixture(200, "master").text);
  const first = lib.entries.find((e) => e.kind === "experience");
  first.bullets = Array.from({ length: 100 }, (_, i) => ({
    ...first.bullets[0],
    id: `extra${i}`,
    text: (first.bullets[0].text + " Supporting context. ").repeat(5),
  }));
  const prompt = TAILOR_PROMPT(job, lib);
  const raw = prompt
    .split("RESUME LIBRARY (ids are what you return)\n")[1]
    .split("\n\nJOB\n")[0];
  const parsed = JSON.parse(raw);
  assert.equal(
    parsed.entries.length,
    lib.entries.filter((e) => e.kind === "experience" || e.kind === "projects")
      .length,
  );
  assert.equal(
    parsed.entries.at(-1).heading,
    lib.entries
      .filter((e) => e.kind === "experience" || e.kind === "projects")
      .at(-1).heading,
  );
  assert(raw.length <= 16000);
});

test("date matching: October and simultaneous jobs count distinct tenure", () => {
  const n = new Date(2026, 10, 9);
  const entries = [
    { kind: "experience", dates: "October 2025–Present" },
    { kind: "experience", dates: "May 2025–Present" },
  ];
  assert.equal(yearsOfExperience({ entries }, n), 1.6);
  assert.equal(yearsOfExperience({ entries: [entries[0]] }, n), 1.2);
});

test("ASCII85 plus Flate compressed PDF stream is decoded without external dependencies", async () => {
  const { deflateSync } = await import("node:zlib");
  const { pdfText } = await import("../src/helper/resume/extract.mjs");
  const stream = deflateSync(
    Buffer.from(
      "BT /F1 10 Tf 50 700 Td (Compressed PDF resume text) Tj ET",
      "ascii",
    ),
  );
  const encode85 = (bytes) => {
    let encoded = "";
    for (let i = 0; i < bytes.length; i += 4) {
      const chunk = bytes.subarray(i, i + 4),
        padded = Buffer.alloc(4);
      chunk.copy(padded);
      let val = padded.readUInt32BE(0);
      if (chunk.length === 4 && val === 0) {
        encoded += "z";
        continue;
      }
      const digits = Array(5);
      for (let k = 4; k >= 0; k--) {
        digits[k] = String.fromCharCode(33 + (val % 85));
        val = Math.floor(val / 85);
      }
      encoded += digits
        .slice(0, chunk.length < 4 ? chunk.length + 1 : 5)
        .join("");
    }
    return encoded + "~>";
  };
  const bytes = Buffer.from(encode85(stream), "ascii");
  const pdf = Buffer.concat([
    Buffer.from(
      "%PDF-1.4\n1 0 obj << /Type /Page /Contents 2 0 R >> endobj\n2 0 obj << /Filter [/ASCII85Decode /FlateDecode] /Length " +
        bytes.length +
        " >>\nstream\n",
    ),
    bytes,
    Buffer.from("\nendstream endobj\n%%EOF"),
  ]);
  assert.match(pdfText(pdf), /Compressed PDF resume text/);
});

test("explicitly labelled contact URLs do not become duplicate labels", async () => {
  const { tokens } = await import("../src/helper/tailor/tailor.mjs");
  const line = tokens(
    "GitHub: github.com/example | Portfolio: example.github.io",
    { header: true },
  );
  assert(
    line.some(
      (t) =>
        t.uri === "https://github.com/example" && t.w === "github.com/example",
    ),
  );
  assert(
    line.some(
      (t) =>
        t.uri === "https://example.github.io" && t.w === "example.github.io",
    ),
  );
});

test("saved generated documents preserve a visible, reloadable omission report", async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createApp } = await import("../src/helper/main.mjs");
  const { makeJob } = await import("../src/scan/job.mjs");
  const root = mkdtempSync(join(tmpdir(), "b3spoken-fictional-"));
  try {
    const input = fixture(100000, "master");
    const target = makeJob({
      source: "greenhouse",
      company: "Fictional",
      nativeId: "offline-synthetic",
      title: "Software Engineer",
      url: "https://boards.greenhouse.io/example/jobs/offline",
      description: job.description,
      location: "Vancouver, BC",
      postedAt: new Date().toISOString(),
    });
    writeFileSync(join(root, "pasted.json"), JSON.stringify([target]));
    const app = createApp(root, {
      offline: true,
      log: () => {},
      deps: { detect: async () => ({}) },
    });
    app.uploadResume({ text: input.text });
    app.saveSettings({ ai: "none" });
    app.saveProfile({ targetRoles: ["Software Engineer"], done: true });
    await app.refresh();
    const result = await app.makeDocuments(target.id, { useAi: false });
    assert.deepEqual(app.documents(target.id).omitted, result.omitted);
    assert.equal(app.documentIndex()[target.id].note || "", result.note || "");
    assert(app.documentFile(target.id, "resume").bytes.length > 5000);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
