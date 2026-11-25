// Onboarding: connect an AI, read the resume into the library, answer the questions, pick extra roles.
const token = document.querySelector('meta[name="b3spoken-token"]').content;
const $ = (id) => document.getElementById(id);
const api = async (path, opts = {}) => {
  const r = await fetch(path, {
    ...opts,
    headers: { "x-b3spoken-token": token, "content-type": "application/json" },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
};
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const csv = (s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
let settings, profile, lib;

function show(step) {
  for (const s of document.querySelectorAll(".step"))
    s.hidden = s.id !== `step-${step}`;
  for (const li of $("steps").children)
    li.classList.toggle("on", li.dataset.step === step);
  if (step === "questions") startCareer(); // the AI reads the resume for role ideas while they answer
  if (step === "roles") drawRoles();
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) show(go.dataset.go);
});
// The AIs B3spoken can use, and how each one is named on the resume card.
const AIS = ["codex", "claude"]; // run by B3spoken; Chrome's built-in AI runs in this page instead
const READ_BY = { rules: "B3spoken", codex: "ChatGPT", claude: "Claude", chrome: "Chrome's built-in AI" };
const canRead = (ai) => AIS.includes(ai) || ai === "chrome";
const msg = (box, text) => {
  $(box).hidden = !text;
  $(box).textContent = text || "";
};

// ---- 1. AI ----
const PLANS = {
  codex:
    "Works with any ChatGPT plan, including the free one (the free plan has a small daily limit; when it runs out, B3spoken uses its own reader until it resets). If you don\u2019t want ChatGPT to learn from your resume, open ChatGPT, go to Settings, then Data controls, and turn off \u201cImprove the model for everyone\u201d.",
  claude: "Needs a paid Claude plan (Pro or Max). Claude\u2019s free plan doesn\u2019t include Claude Code, which B3spoken uses.",
};
const SIGNIN_HELP = {
  codex:
    "A window opens and your browser asks you to sign in to ChatGPT. When the browser says you\u2019re signed in, close the window and click Check it works.",
  claude:
    'A window opens. Pick any colour theme with Enter, choose "Claude account with subscription", and sign in in your browser. When it says you\u2019re logged in, close the window and click Check it works.',
};
const aiState = {}; // provider -> message under its buttons

function aiButtons(id, info) {
  const box = el("div", "aiact");
  const btn = (text, fn, cls = "small") => {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", (e) => {
      e.preventDefault();
      fn(b);
    });
    return b;
  };
  const msgLine = el("p", "note", aiState[id] || "");
  if (!info?.installed) {
    box.append(
      btn(
        "Install it for me",
        async (b) => {
          b.disabled = true;
          b.textContent = "Installing\u2026 (1\u20133 minutes)";
          await api("/api/ai/install", {
            method: "POST",
            body: JSON.stringify({ provider: id }),
          });
          for (;;) {
            await new Promise((r) => setTimeout(r, 2500));
            const st = (await api("/api/ai/install"))[id];
            if (st?.state === "done") {
              aiState[id] = "Installed. Next: sign in.";
              break;
            }
            if (st?.state === "failed") {
              aiState[id] =
                `The install didn\u2019t finish: ${(st.log || "").trim().split("\n").pop() || "unknown error"}`;
              break;
            }
          }
          await api("/api/ai/detect", { method: "POST" });
          drawAi();
        },
        "small primary",
      ),
    );
  } else {
    box.append(
      btn("Sign in", async () => {
        try {
          await api("/api/ai/signin", {
            method: "POST",
            body: JSON.stringify({ provider: id }),
          });
          aiState[id] = SIGNIN_HELP[id];
        } catch (e) {
          aiState[id] = e.message;
        }
        drawAi();
      }),
      btn("Check it works", async (b) => {
        b.disabled = true;
        b.textContent = "Checking\u2026";
        const r = await api("/api/ai/test", {
          method: "POST",
          body: JSON.stringify({ provider: id }),
        });
        aiState[id] = r.ok
          ? "Working and signed in."
          : r.error ||
            "It answered, but not as expected. Try signing in again.";
        if (r.ok)
          document.querySelector(`input[name="ai"][value="${id}"]`).checked =
            true;
        drawAi();
      }),
    );
  }
  box.append(msgLine);
  return box;
}

async function drawAi() {
  const s = await api("/api/status");
  const chrome = "LanguageModel" in self;
  const status = (info) =>
    info?.working
      ? `Installed (${info.version}). `
      : info?.installed
        ? "Installed. "
        : "Not installed yet. ";
  const options = [
    ["codex", "ChatGPT (Codex)", `${status(s.ai?.codex)}${PLANS.codex}`, true],
    [
      "claude",
      "Claude (Claude Code)",
      `${status(s.ai?.claude)}${PLANS.claude}`,
      true,
    ],
    [
      "chrome",
      "Chrome built-in AI",
      chrome
        ? "Free and private: it runs on this computer and nothing is sent anywhere. The first time, Chrome downloads its AI (a few GB), which can take a while. It reads your resume a part at a time, so it\u2019s slower than ChatGPT or Claude."
        : "Not available in this browser. It needs desktop Chrome (version 148 or newer) on Windows 10 or 11, a Mac or Linux, with 16 GB of memory and 22 GB of free disk space. Open B3spoken in Chrome to use it.",
      chrome,
    ],
    [
      "none",
      "No AI",
      "Tailoring picks and orders your own bullets by keyword match",
      true,
    ],
  ];
  const current = document.querySelector('input[name="ai"]:checked')?.value;
  const pick =
    current ||
    (settings.ai !== "auto"
      ? settings.ai
      : s.ai?.codex?.working
        ? "codex"
        : s.ai?.claude?.working
          ? "claude"
          : "none");
  $("aiChoices").replaceChildren(
    ...options.map(([id, label, note, ok]) => {
      const l = el("label", `choice${ok ? "" : " off"}`);
      const r = el("input");
      r.type = "radio";
      r.name = "ai";
      r.value = id;
      r.checked = id === pick;
      r.disabled = !ok;
      l.append(r, el("strong", null, label), el("span", "note", note));
      if (id === "codex" || id === "claude")
        l.append(aiButtons(id, s.ai?.[id]));
      return l;
    }),
  );
}
$("aiNext").addEventListener("click", async () => {
  const ai =
    document.querySelector('input[name="ai"]:checked')?.value || "none";
  settings = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ ...settings, ai }),
  });
  $("tidy").hidden = !canRead(ai);
  show("resume");
});

// ---- 2. Resume ----
function drawLibrary() {
  $("libraryBox").hidden = !lib;
  $("resumeNext").disabled = !lib?.entries?.some(
    (e) =>
      !e.flagged &&
      (e.bullets?.some((b) => !b.flagged && b.text) ||
        ["education", "certifications"].includes(e.kind)),
  );
  if (!lib) return;
  const box = $("library");
  box.replaceChildren();
  if (lib.contact?.name)
    box.append(
      el(
        "p",
        "small",
        `${lib.contact.name} · read by ${READ_BY[lib.source] || "B3spoken"}`,
      ),
    );
  for (const e of lib.entries) {
    const card = el("div", "job");
    card.append(el("h2", null, e.heading || "(no heading)"));
    if (e.dates || e.kind)
      card.append(
        el("div", "meta", [e.kind, e.dates].filter(Boolean).join(" · ")),
      );
    for (const detail of e.details || [])
      card.append(el("div", "meta", detail));
    for (const b of e.bullets) {
      const row = el("div", `bullet${b.flagged ? " flagged" : ""}`);
      row.append(el("code", null, b.id), el("span", null, b.text));
      if (b.flagged) {
        row.append(el("span", "badge warn", "check"));
        const ok = el("button", "small", "Looks right");
        ok.type = "button";
        ok.addEventListener("click", async () => {
          Object.assign(
            b,
            await api(`/api/library/bullets/${encodeURIComponent(b.id)}`, {
              method: "PUT",
              body: JSON.stringify({ flagged: false }),
            }),
          );
          drawLibrary();
        });
        const fix = el("button", "small", "Fix the words");
        fix.type = "button";
        fix.addEventListener("click", async () => {
          const t = prompt("Your own words for this line:", b.text);
          if (t != null) {
            Object.assign(
              b,
              await api(`/api/library/bullets/${encodeURIComponent(b.id)}`, {
                method: "PUT",
                body: JSON.stringify({ text: t, flagged: false }),
              }),
            );
            drawLibrary();
          }
        });
        row.append(ok, fix);
      }
      card.append(row);
    }
    box.append(card);
  }
}
// Read it: B3spoken's own reader first (instant), then, with an AI picked in step 1, the AI reads it too and its
// checked version replaces the first one. Anything either reader may have missed is said in plain words.
const showWarnings = (w) => msg("resumeMsg", (w || []).join(" "));
async function readWithAi() {
  if (settings.ai === "chrome") return readWithChrome();
  $("tidy").disabled = $("upload").disabled = true;
  $("tidy").textContent = "Your AI is reading it…";
  try {
    lib = await api("/api/resume/ai", {
      method: "POST",
      body: JSON.stringify({ provider: settings.ai }),
    });
    drawLibrary();
    showWarnings(lib.warnings);
  } catch (e) {
    msg("resumeMsg", `${e.message} The version B3spoken read is kept.`);
  } finally {
    $("tidy").disabled = $("upload").disabled = false;
    $("tidy").textContent = "Read it again with my AI";
  }
}
async function upload(body) {
  msg("resumeMsg", "");
  $("upload").disabled = true;
  try {
    lib = await api("/api/resume", {
      method: "POST",
      body: JSON.stringify(body),
    });
    drawLibrary();
    showWarnings(lib.warnings);
  } catch (e) {
    msg("resumeMsg", e.message);
    return;
  } finally {
    $("upload").disabled = false;
  }
  if (canRead(settings.ai)) await readWithAi();
}

// Chrome's built-in AI is small, so B3spoken splits the resume and Chrome reads one part at a time on this
// computer. The answers go back to B3spoken, which keeps only what is word for word in the resume.
const LANG = { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };
async function readWithChrome() {
  const say = (t) => ($("tidy").textContent = t);
  if (!("LanguageModel" in self))
    return msg("resumeMsg", "Chrome\u2019s built-in AI isn\u2019t available in this browser, so the version B3spoken read is shown. Open B3spoken in desktop Chrome 148 or newer to use it.");
  $("tidy").disabled = $("upload").disabled = true;
  say("Chrome\u2019s AI is getting ready\u2026");
  let base;
  try {
    const avail = await LanguageModel.availability(LANG).catch(() => LanguageModel.availability());
    if (avail === "unavailable")
      throw new Error("This computer can\u2019t run Chrome\u2019s built-in AI (it needs 16 GB of memory and 22 GB of free disk space)");
    const plan = await api("/api/resume/chrome-plan");
    const opts = {
      initialPrompts: [{ role: "system", content: plan.system }],
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => say(`Downloading Chrome\u2019s AI (first time only)\u2026 ${Math.round((e.loaded || 0) * 100)}%`));
      },
    };
    base = await LanguageModel.create({ ...opts, ...LANG }).catch(() => LanguageModel.create(opts));
    const answers = [];
    for (let i = 0; i < plan.prompts.length; i++) {
      say(`Chrome\u2019s AI is reading part ${i + 1} of ${plan.prompts.length}\u2026`);
      const s = await base.clone();
      try {
        answers.push(await s.prompt(plan.prompts[i], { responseConstraint: plan.schema, omitResponseConstraintInput: true }));
      } catch {
        answers.push("");
      } finally {
        s.destroy();
      }
    }
    lib = await api("/api/resume/ai", { method: "POST", body: JSON.stringify({ provider: "chrome", answers }) });
    drawLibrary();
    showWarnings(lib.warnings);
  } catch (e) {
    msg("resumeMsg", `${e.message}. The version B3spoken read is kept.`);
  } finally {
    base?.destroy();
    $("tidy").disabled = $("upload").disabled = false;
    say("Read it again with my AI");
  }
}
$("upload").addEventListener("click", () => {
  const f = $("file").files[0];
  if (!f) return msg("resumeMsg", "Choose a file first.");
  if (f.size > 10 * 1024 * 1024)
    return msg("resumeMsg", "That file is larger than 10 MB.");
  const r = new FileReader();
  r.onload = () =>
    upload({
      filename: f.name,
      dataBase64: String(r.result).split(",")[1] || "",
    });
  r.readAsDataURL(f);
});
$("usePaste").addEventListener("click", () =>
  upload({ text: $("paste").value }),
);
$("tidy").addEventListener("click", readWithAi);
$("resumeNext").addEventListener("click", () => show("questions"));

// ---- 3. Questions ----
const FIELDS = [
  "payFloor",
  "payFloorUnit",
  "payGoal",
  "payGoalUnit",
  "province",
  "cities",
  "remote",
  "workAuth",
  "workAuthLine",
  "startDate",
  "missingSkills",
  "avoidIndustries",
];
function fillQuestions() {
  $("targetRoles").value = (profile.targetRoles || []).join(", ");
  for (const f of FIELDS) {
    const v = profile[f];
    if (f.endsWith("Unit") && profile[f.slice(0, -4)] == null) continue; // keep the page's default unit until an amount is saved
    if (v != null && v !== "") $(f).value = Array.isArray(v) ? v.join(", ") : v;
  }
}
const answers = () => ({
  ...profile,
  targetRoles: csv($("targetRoles").value),
  ...Object.fromEntries(
    FIELDS.map((f) => [
      f,
      ["cities", "missingSkills", "avoidIndustries"].includes(f)
        ? csv($(f).value)
        : $(f).value,
    ]),
  ),
});
let confirmedFar = new Set();
$("questionsNext").addEventListener("click", async () => {
  const a = answers();
  if (!a.targetRoles.length && lib?.roles?.length)
    a.targetRoles = lib.roles.slice(0, 2).map((r) => r.title);
  const far = [];
  for (const t of a.targetRoles) {
    const c = await api("/api/roles/check", {
      method: "POST",
      body: JSON.stringify({ target: t }),
    });
    if (c.far && !confirmedFar.has(t)) far.push(c);
  }
  if (far.length) {
    const box = $("roleWarn");
    box.hidden = false;
    box.replaceChildren();
    for (const c of far) {
      const p = el(
        "p",
        null,
        `“${c.target}” is far from what your resume shows. Closest fits: ${c.closest.join(", ") || "none found"}.`,
      );
      const keep = el("button", "small", `Keep “${c.target}”`);
      keep.type = "button";
      keep.addEventListener("click", () => {
        confirmedFar.add(c.target);
        p.remove();
        if (!box.querySelector("p")) box.hidden = true;
      });
      const use = el("button", "small", "Use the closest fits instead");
      use.type = "button";
      use.addEventListener("click", () => {
        $("targetRoles").value = [
          ...csv($("targetRoles").value).filter((x) => x !== c.target),
          ...c.closest,
        ].join(", ");
        p.remove();
        if (!box.querySelector("p")) box.hidden = true;
      });
      p.append(" ", keep, " ", use);
      box.append(p);
    }
    return;
  }
  profile = await api("/api/profile", {
    method: "PUT",
    body: JSON.stringify(a),
  });
  show("roles");
});

// ---- 4. Roles to search: the AI's career ideas (or quick rule-based roles without an AI) ----
// The AI starts reading the resume for ideas as soon as the questions are done, so they're usually ready here.
let careerAsk = null,
  picker = null;
const aiOn = () => AIS.includes(settings?.ai);
function startCareer() {
  if (aiOn() && !careerAsk)
    careerAsk = api("/api/career", { method: "POST", body: "{}" }).catch(
      (e) => ({ error: e.message }),
    );
}
async function drawRoles() {
  const box = $("roleList");
  const rule = (lib?.roles || [])
    .flatMap((r) => [
      { title: r.title, reason: r.reason || "" },
      ...(r.related || []).map((x) => ({
        title: x,
        reason: `Related to ${r.title}`,
      })),
    ])
    .slice(0, 16);
  const opts = {
    ruleRoles: rule,
    on: profile.extraRoles || [],
    fixed: profile.targetRoles || [],
  };
  let career = await api("/api/career").catch(() => null);
  if (!career?.titles && aiOn()) {
    box.replaceChildren(
      el(
        "p",
        "note",
        "Your AI is reading your resume for role ideas, including better-paid ones and some you may not have considered (about a minute)\u2026",
      ),
    );
    $("finish").disabled = true;
    startCareer();
    const r = await careerAsk;
    careerAsk = null;
    $("finish").disabled = false;
    if (r?.titles) career = r;
    else
      msg(
        "roleMsg",
        `Your AI couldn't suggest roles this time (${r?.error || "no answer"}), so these come from your resume's words. You can try again later from Edit setup.`,
      );
  }
  $("rolesLead").textContent = career?.titles
    ? "Your AI read your resume. Tick the roles you want B3spoken to search for every morning; each is off until you tick it."
    : "Roles your resume supports. Tick the ones you\u2019d take.";
  picker = rolePicker.draw(box, {
    ...opts,
    career: career?.titles ? career : null,
  });
}
$("finish").addEventListener("click", async () => {
  // Roles ticked here, plus earlier extra roles this list didn't offer (so nothing is lost).
  const shown = new Set((picker?.shown() || []).map((t) => t.toLowerCase()));
  const keep = (profile.extraRoles || []).filter(
    (t) => !shown.has(t.toLowerCase()),
  );
  await api("/api/roles", {
    method: "PUT",
    body: JSON.stringify({
      extraRoles: [...(picker?.picked() || []), ...keep],
      seen: picker?.shown() || [],
    }),
  });
  profile = await api("/api/profile", {
    method: "PUT",
    body: JSON.stringify({ ...(await api("/api/profile")), done: true }),
  });
  await api("/api/refresh", { method: "POST" });
  location.href = "/";
});

async function drawKit() {
  const { found } = await api("/api/kit/find");
  $("kitBox").hidden = false;
  if (found.length) {
    $("kitDir").value = found[0];
    $("kitMsg").textContent = `Found your kit at ${found[0]}.`;
  } else
    $("kitMsg").textContent = "Type the folder your kit is in, or skip this.";
  $("kitGo").onclick = async () => {
    $("kitGo").disabled = true;
    $("kitMsg").textContent = "Importing…";
    try {
      const r = await api("/api/kit/import", {
        method: "POST",
        body: JSON.stringify({ dir: $("kitDir").value }),
      });
      $("kitMsg").textContent =
        `Brought over ${r.imported.join(", ")}. Check each step and click Next.`;
      [settings, profile, lib] = await Promise.all([
        api("/api/settings"),
        api("/api/profile"),
        api("/api/library"),
      ]);
      if (!lib?.entries) lib = null;
      await drawAi();
      drawLibrary();
      fillQuestions();
    } catch (e) {
      $("kitMsg").textContent = e.message;
    } finally {
      $("kitGo").disabled = false;
    }
  };
}

(async () => {
  [settings, profile, lib] = await Promise.all([
    api("/api/settings"),
    api("/api/profile"),
    api("/api/library"),
  ]);
  if (!lib?.entries) lib = null;
  await drawAi();
  drawLibrary();
  fillQuestions();
  if (!profile.done) drawKit().catch(() => {});
  $("tidy").hidden = !canRead(settings.ai);
  show("ai");
})().catch((e) => {
  document.querySelector("main").textContent =
    `The helper isn't answering: ${e.message}`;
});
