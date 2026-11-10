// The board page. Talks only to the helper on this computer; every call carries this run's token.
const token = document.querySelector('meta[name="b3spoken-token"]').content;
const $ = (id) => document.getElementById(id);
const api = async (path, opts = {}) => {
  const r = await fetch(path, {
    ...opts,
    headers: {
      "x-b3spoken-token": token,
      "content-type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok)
    throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const safeLink = (u) => {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) ? x.href : null;
  } catch {
    return null;
  }
};
const ago = (iso) => {
  const t = Date.parse(iso);
  if (!t) return "";
  const d = Math.floor((Date.now() - t) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
};

let offset = 0,
  timer,
  view = "",
  docs = {};
const STATUS = [
  ["", "Not tracked"],
  ["saved", "Saved"],
  ["applied", "Applied"],
  ["interview", "Interview"],
  ["offer", "Offer"],
  ["rejected", "Rejected"],
  ["not-interested", "Not interested"],
];
const today = () => new Date().toISOString().slice(0, 10);

function trackerControls(j) {
  const box = el("div", "track");
  const t = j.track || {};
  const sel = el("select");
  sel.setAttribute("aria-label", "Status");
  for (const [v, label] of STATUS) {
    const o = el("option", null, label);
    o.value = v;
    o.selected = (t.status || "") === v;
    sel.append(o);
  }
  const date = el("input");
  date.type = "date";
  date.value = t.followUp || "";
  date.setAttribute("aria-label", "Follow up on");
  const notes = el("textarea");
  notes.rows = 2;
  notes.placeholder = "Notes";
  notes.value = t.notes || "";
  notes.setAttribute("aria-label", "Notes");
  const due = el("span", "badge warn", "Follow-up due");
  due.hidden = !(
    t.followUp &&
    t.followUp <= today() &&
    !["rejected", "not-interested", "offer"].includes(t.status)
  );
  const save = async () => {
    const r = await api(`/api/tracker/${encodeURIComponent(j.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        status: sel.value,
        followUp: date.value,
        notes: notes.value,
      }),
    });
    j.track = r;
    date.value = r.followUp || "";
    drawStatusBadge(box.closest("li.job"), r.status);
    if (!inView(r)) {
      const li = box.closest("li.job");
      li?.classList.add("leaving");
      li?.append(el("p", "tip", `Moved to ${tabName(r.status)}.`));
      setTimeout(() => li?.remove(), 1500);
    }
    loadCounts();
    due.hidden = !(
      r.followUp &&
      r.followUp <= today() &&
      !["rejected", "not-interested", "offer"].includes(r.status)
    );
    loadDue();
  };
  sel.addEventListener("change", save);
  date.addEventListener("change", save);
  notes.addEventListener("change", save);
  const lab = (text, c) => {
    const l = el("label", "mini");
    l.append(el("span", null, text), c);
    return l;
  };
  const more = el("details", "notes");
  more.open = !!t.notes;
  more.append(el("summary", null, "Notes"), notes);
  box.append(lab("Status", sel), lab("Follow up on", date), due, more);
  return box;
}
async function loadDue() {
  const t = await api("/api/tracker");
  docs = t.documents || {};
  $("dueCount").textContent = t.due ? `(${t.due})` : "";
}

// Which tab a job belongs in, and the tab names.
const tabName = (s) =>
  (STATUS.find(([v]) => v === s)?.[1] || "To apply")
    .replace("Not tracked", "To apply")
    .replace("Saved", "To apply");
function inView(t = {}) {
  if (view === "tracked") return !!(t.status || t.notes);
  if (view === "due")
    return !!(
      t.followUp &&
      t.followUp <= today() &&
      !["rejected", "not-interested", "offer"].includes(t.status)
    );
  if (view) return t.status === view;
  return !t.status || t.status === "saved";
}
function drawStatusBadge(li, status) {
  if (!li) return;
  li.querySelector(".badge.stage")?.remove();
  if (status)
    li.querySelector(".top")?.append(
      el(
        "span",
        "badge stage",
        STATUS.find(([v]) => v === status)?.[1] || status,
      ),
    );
}
async function loadCounts() {
  try {
    const r = await api(`/api/jobs?${query("", 0, 1)}`);
    showCounts(r.counts, r.total);
    // The count above the list follows too (a job moved to another tab leaves this one).
    const n = view ? r.counts?.[view] ?? 0 : r.total;
    $("count").textContent = `${n.toLocaleString()} ${n === 1 ? "job" : "jobs"}`;
  } catch {}
}
function showCounts(c = {}, toApply = null) {
  for (const s of document.querySelectorAll(".tabs .n")) {
    const k = s.dataset.count;
    if (k) s.textContent = c[k] ? `(${c[k]})` : "";
    else if (toApply != null) s.textContent = `(${toApply})`;
  }
}
// The list query: the filters on screen, for one tab.
let aiOn = false;
const query = (v, off, limit) =>
  new URLSearchParams({
    q: $("q").value,
    province: $("province").value,
    remote: $("remote").value,
    maxAgeDays: $("age").value,
    minLabel: $("minLabel").value,
    sort: $("sort").value,
    view: v,
    offset: off,
    limit,
  });

function card(j) {
  const li = el("li", "job");
  const top = el("div", "top");
  top.append(el("h2", null, j.title));
  if (j.review)
    top.append(
      el(
        "span",
        `score ${j.match?.label.toLowerCase() || "good"}`,
        `${j.review.call} · tech ${j.review.techScore}/10 · fit ${j.review.fitScore}/10`,
      ),
    );
  else if (j.match)
    top.append(
      el(
        "span",
        `score ${j.match.label.toLowerCase()}`,
        `${j.match.label} · ${j.match.score}`,
      ),
    );
  li.append(top);
  const meta = el("div", "meta");
  meta.append(el("span", null, j.company), el("span", null, j.location || ""));
  if (j.remote) meta.append(el("span", null, "Remote"));
  if (j.postedAt) meta.append(el("span", null, ago(j.postedAt)));
  else if (j.firstSeen) meta.append(el("span", null, `first seen ${ago(j.firstSeen)}`));
  if (j.salary) meta.append(el("span", null, j.salary));
  li.append(meta);
  if (j.aiTrap) {
    const t = el(
      "p",
      "trap",
      `AI trap in this posting: “${j.aiTrap.instruction}” B3spoken won’t follow it${j.aiTrap.phrases.length ? `, and nothing it writes will use “${j.aiTrap.phrases.join("”, “")}”` : ""}. If you write anything yourself, don’t follow it either.`,
    );
    li.append(t);
  }
  const sc = j.match?.scam;
  if (sc?.stop?.length)
    li.append(
      el(
        "p",
        "trap",
        `Possible scam: this posting ${sc.stop.join("; it ")}. Real employers don't ask for this. Don't send money or banking details.`,
      ),
    );
  else if (sc?.warn?.length)
    li.append(
      el(
        "p",
        "problems",
        `Be careful: this posting ${sc.warn.join("; it ")}. Check the job on the employer's own careers page before you reply.`,
      ),
    );
  // The AI review comes with the card (like the Job Hunt Kit): its summary and how each requirement matches.
  if (j.review) {
    const r = j.review,
      sum = el("div", "aisum");
    if (r.summary) sum.append(el("p", null, r.summary));
    const by = (m) =>
      r.requirements.filter((q) => q.match === m).map((q) => q.requirement);
    const cut = (t) => (t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t);
    for (const m of ["Strong", "Partial", "Gap"])
      if (by(m).length) {
        const line = el("p", "reasons");
        line.append(
          el("strong", `m-${m.toLowerCase()}`, `${m}: `),
          el(
            "span",
            null,
            by(m).slice(0, 3).map(cut).join(" · ") +
              (by(m).length > 3 ? ` (+${by(m).length - 3} more)` : ""),
          ),
        );
        sum.append(line);
      }
    if (r.leadWith.length)
      sum.append(el("p", "reasons", `Lead with: ${r.leadWith.join(", ")}`));
    li.append(sum);
  } else if (j.match?.reasons?.length)
    li.append(el("p", "reasons", j.match.reasons.join(" · ")));
  else if (j.snippet)
    li.append(
      el("p", "snippet", j.snippet + (j.snippet.length >= 280 ? "…" : "")),
    );
  const row = el("div", "row");
  const href = safeLink(j.applyUrl || j.url);
  if (href) {
    const a = el("a", "apply", "Apply");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    row.append(a);
  }
  if (j.source === "jobbank")
    row.append(el("span", "badge ok", "Job Bank (Government of Canada)"));
  else if (j.employerVerified !== false)
    row.append(el("span", "badge ok", "On the employer’s own site"));
  else if (j.employerUrl)
    row.append(el("span", "badge ok", "Confirmed on the employer’s site"));
  if (j.via) row.append(el("span", "badge", `via ${j.via.name || j.via}`));
  if (j.aiTrap) row.append(el("span", "badge bad", "AI trap"));
  const make = el("button", "small", "Make my resume and cover letter");
  make.type = "button";
  const files = el("span", "files");
  make.addEventListener("click", async () => {
    make.disabled = true;
    make.textContent = "Writing…";
    try {
      const d = await api(`/api/jobs/${encodeURIComponent(j.id)}/documents`, {
        method: "POST",
      });
      showFiles(files, j.id, d);
      make.textContent = "Make them again";
    } catch (e) {
      make.textContent = e.message;
    } finally {
      make.disabled = false;
    }
  });
  const prepBtn = el("button", "small", "Interview prep");
  prepBtn.type = "button";
  const prepBox = el("div", "prep");
  prepBox.hidden = true;
  prepBtn.addEventListener("click", async () => {
    if (!prepBox.hidden) {
      prepBox.hidden = true;
      return;
    }
    prepBtn.disabled = true;
    prepBtn.textContent = "Preparing…";
    try {
      drawPrep(
        prepBox,
        await api(`/api/jobs/${encodeURIComponent(j.id)}/prep`, {
          method: "POST",
        }),
      );
      prepBox.hidden = false;
    } catch (e) {
      prepBox.hidden = false;
      prepBox.replaceChildren(el("p", "problems", e.message));
    } finally {
      prepBtn.disabled = false;
      prepBtn.textContent = "Interview prep";
    }
  });
  const conBtn = el("button", "small", "Recruiter contacts");
  conBtn.type = "button";
  const conBox = el("div", "prep");
  conBox.hidden = true;
  const loadContacts = async (again = false) => {
    conBtn.disabled = true;
    conBtn.textContent = "Looking…";
    try {
      drawContacts(
        conBox,
        j,
        await api(`/api/jobs/${encodeURIComponent(j.id)}/contacts`, {
          method: "POST",
          body: JSON.stringify({ refresh: again }),
        }),
        loadContacts,
      );
      conBox.hidden = false;
    } catch (e) {
      conBox.hidden = false;
      conBox.replaceChildren(el("p", "problems", e.message));
    } finally {
      conBtn.disabled = false;
      conBtn.textContent = "Recruiter contacts";
    }
  };
  conBtn.addEventListener("click", () => {
    if (!conBox.hidden) {
      conBox.hidden = true;
      return;
    }
    loadContacts();
  });
  const revBtn = el(
    "button",
    "small",
    j.review ? "Full AI review" : "Get an AI review now",
  );
  revBtn.type = "button";
  const revBox = el("div", "prep");
  revBox.hidden = true;
  const showReview = (r) => {
    j.review = r;
    drawReview(revBox, r);
    revBox.hidden = false;
    revBtn.textContent = "Full AI review";
  };
  revBtn.addEventListener("click", async () => {
    if (!revBox.hidden) {
      revBox.hidden = true;
      return;
    }
    if (j.review) return showReview(j.review);
    revBtn.disabled = true;
    revBtn.textContent = "Reviewing… (about a minute)";
    try {
      showReview(
        await api(`/api/jobs/${encodeURIComponent(j.id)}/review`, {
          method: "POST",
          body: "{}",
        }),
      );
    } catch (e) {
      revBox.hidden = false;
      revBox.replaceChildren(el("p", "problems", e.message));
      revBtn.textContent = "Get an AI review now";
    } finally {
      revBtn.disabled = false;
    }
  });
  const helpBtn = el("button", "small", "Writing help");
  helpBtn.type = "button";
  const helpBox = el("div", "prep drafts");
  helpBox.hidden = true;
  helpBtn.addEventListener("click", async () => {
    if (!helpBox.hidden) {
      helpBox.hidden = true;
      return;
    }
    helpBox.hidden = false;
    await drawDrafts(helpBox, j);
  });
  // Application answers: written with the AI review (Apply and Stretch jobs), ready to copy into the form.
  const ansBtn = el("button", "small", "Application answers");
  ansBtn.type = "button";
  const ansBox = el("div", "prep");
  ansBox.hidden = true;
  ansBtn.addEventListener("click", async () => {
    if (!ansBox.hidden) {
      ansBox.hidden = true;
      return;
    }
    ansBox.hidden = false;
    if (j.review?.answers?.length || j.review?.call === "Skip")
      return drawAnswers(ansBox, j.review);
    ansBtn.disabled = true;
    ansBtn.textContent = "Writing answers… (about a minute)";
    try {
      const r = await api(`/api/jobs/${encodeURIComponent(j.id)}/review`, {
        method: "POST",
        body: JSON.stringify({ again: !!j.review }),
      });
      j.review = r;
      drawAnswers(ansBox, r);
    } catch (e) {
      ansBox.replaceChildren(el("p", "problems", e.message));
    } finally {
      ansBtn.disabled = false;
      ansBtn.textContent = "Application answers";
    }
  });
  row.append(make, files, revBtn, ansBtn, prepBtn, conBtn, helpBtn);
  if (docs[j.id]) {
    showFiles(files, j.id, { files: docs[j.id], note: docs[j.id].note });
    make.textContent = "Make them again";
  }
  if (j.moreLocations)
    row.append(el("span", "badge", `+${j.moreLocations} more locations`));
  li.append(row, revBox, ansBox, prepBox, conBox, helpBox, trackerControls(j));
  drawStatusBadge(li, j.track?.status);
  return li;
}

// Downloads a PDF through the helper (the token can't go on a plain link), then saves it with its own name.
async function download(jobId, kind, name) {
  const r = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/documents/${kind}`,
    { headers: { "x-b3spoken-token": token } },
  );
  if (!r.ok) return;
  const url = URL.createObjectURL(await r.blob());
  const a = el("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function showFiles(box, jobId, d) {
  box.replaceChildren();
  if (d.note) box.append(el("span", "problems", d.note));
  for (const [kind, label] of [
    ["resume", "Resume PDF"],
    ["letter", "Cover letter PDF"],
  ]) {
    const b = el("button", "small link", label);
    b.type = "button";
    b.addEventListener("click", () => download(jobId, kind, d.files[kind]));
    box.append(b);
  }
}

function drawContacts(box, j, r, again) {
  box.replaceChildren();
  box.append(el("h3", null, "Who to contact"));
  if (!r.contacts.length)
    box.append(
      el(
        "p",
        "tip",
        r.domain
          ? `No hiring emails are published in the posting or on ${r.domain}.${r.hunter ? "" : " Adding a Hunter.io key (below) can find more."}`
          : "No hiring emails are published in the posting, and B3spoken doesn’t know this employer’s website.",
      ),
    );
  const ul = el("ul", "lines");
  for (const c of r.contacts) {
    const li = el("li");
    if (c.email)
      li.append(
        el("strong", null, c.email),
        el(
          "em",
          null,
          ` ${[c.name, c.position].filter(Boolean).join(", ")} (from ${c.source}${c.confidence ? `, ${c.confidence}% sure` : ""})`,
        ),
      );
    else
      li.append(
        el("strong", null, c.name),
        el(
          "em",
          null,
          ` ${c.position || ""} (named in ${c.source}; no email given, so look them up on the company's own site or write to the hiring inbox)`,
        ),
      );
    ul.append(li);
  }
  box.append(ul);
  box.append(el("h3", null, "Draft email (you review and send it)"));
  const subj = el("input");
  subj.value = r.draft.subject;
  subj.setAttribute("aria-label", "Subject");
  const body = el("textarea");
  body.rows = 9;
  body.value = r.draft.body;
  body.setAttribute("aria-label", "Email");
  box.append(subj, body);
  const row = el("div", "row");
  const copy = el("button", "small", "Copy email");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(
        `Subject: ${subj.value}\n\n${body.value}`,
      );
      copy.textContent = "Copied";
    } catch {
      body.select();
    }
  });
  row.append(copy);
  const to = r.contacts.find((c) => c.email);
  if (to) {
    const a = el("a", "small link", "Open in my email app");
    const set = () => {
      a.href = `mailto:${encodeURIComponent(to.email)}?subject=${encodeURIComponent(subj.value)}&body=${encodeURIComponent(body.value)}`;
    };
    set();
    subj.addEventListener("input", set);
    body.addEventListener("input", set);
    row.append(a);
  }
  const redo = el("button", "small", "Look again");
  redo.type = "button";
  redo.addEventListener("click", () => again(true));
  row.append(redo);
  box.append(row);
  const hk = el("details");
  hk.append(
    el(
      "summary",
      null,
      r.hunter
        ? "Hunter.io key saved"
        : "Find more with your own Hunter.io key",
    ),
  );
  const key = el("input");
  key.type = "password";
  key.placeholder = "Hunter.io API key (free account at hunter.io)";
  key.setAttribute("aria-label", "Hunter.io API key");
  const save = el("button", "small", r.hunter ? "Replace key" : "Save key");
  save.type = "button";
  save.addEventListener("click", async () => {
    try {
      await api("/api/hunter-key", {
        method: "PUT",
        body: JSON.stringify({ key: key.value }),
      });
      again(true);
    } catch (e) {
      save.textContent = e.message;
    }
  });
  hk.append(key, save);
  box.append(hk);
}

// Writing help: the person's own AI drafts these from their real resume, their answers and the posting.
const TOOLS = [
  {
    kind: "linkedin",
    label: "LinkedIn note",
    inputs: [
      ["name", "text", "Their name (optional)"],
      [
        "role",
        "select",
        [
          "Recruiter",
          "Hiring manager",
          "Engineer on the team",
          "Alum of my school at the company",
        ],
      ],
    ],
  },
  {
    kind: "debrief",
    label: "Interview debrief",
    when: (s) => ["interview", "offer", "rejected"].includes(s),
    inputs: [
      [
        "notes",
        "textarea",
        "How did it go? Questions they asked, what went well, what didn’t, who you met.",
      ],
    ],
  },
  {
    kind: "negotiate",
    label: "Negotiation plan",
    when: (s) => ["interview", "offer"].includes(s),
    inputs: [
      ["offer", "text", "Offer, e.g. $95,000 base + 10% bonus"],
      ["other", "text", "Anything else (competing offer, start date)"],
    ],
  },
  {
    kind: "offer",
    label: "Offer letter review",
    when: (s) => s === "offer",
    inputs: [["text", "textarea", "Paste the offer letter text here."]],
  },
];
async function drawDrafts(box, j) {
  box.replaceChildren(el("h3", null, "Writing help (uses your AI)"));
  const saved = await api(`/api/jobs/${encodeURIComponent(j.id)}/drafts`).catch(
    () => ({}),
  );
  const status = j.track?.status || "";
  const shown = TOOLS.filter((t) => !t.when || t.when(status));
  const hidden = TOOLS.filter((t) => t.when && !t.when(status));
  if (hidden.length)
    box.append(
      el(
        "p",
        "tip",
        `More appear as you move this job along: ${hidden.map((t) => t.label).join(", ")} (set the status to Interview or Offer).`,
      ),
    );
  const bar = el("div", "toolbar"),
    area = el("div");
  box.append(bar, area);
  const open = (t) => {
    for (const b of bar.children)
      b.classList.toggle("on", b.dataset.kind === t.kind);
    area.replaceChildren();
    const values = {},
      inputs = el("div", "inputs");
    for (const [name, type, ph] of t.inputs) {
      let inp;
      if (type === "select") {
        inp = el("select");
        for (const o of ph) inp.append(el("option", null, o));
        values[name] = ph[0];
        inp.addEventListener("change", () => {
          values[name] = inp.value;
        });
        inp.setAttribute("aria-label", name);
      } else {
        inp = el(type === "textarea" ? "textarea" : "input");
        if (type !== "textarea") inp.type = "text";
        inp.placeholder = ph;
        inp.setAttribute("aria-label", ph);
        inp.addEventListener("input", () => {
          values[name] = inp.value;
        });
      }
      inputs.append(inp);
    }
    const go = el(
      "button",
      "small primary",
      saved[t.kind] ? "Write a new version" : "Write it",
    );
    go.type = "button";
    const out = el("div");
    const show = (d) => {
      out.replaceChildren(
        el("p", "tip", `${d.title} · saved ${ago(d.at)}`),
        el("p", "out", d.text),
      );
      const copy = el("button", "small", "Copy");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(d.text);
          copy.textContent = "Copied";
        } catch {
          copy.textContent = "Select the text and copy it";
        }
      });
      out.append(copy);
    };
    go.addEventListener("click", async () => {
      go.disabled = true;
      go.textContent = "Writing… (can take a minute)";
      try {
        const d = await api(`/api/jobs/${encodeURIComponent(j.id)}/draft`, {
          method: "POST",
          body: JSON.stringify({ kind: t.kind, values }),
        });
        saved[t.kind] = d;
        show(d);
      } catch (e) {
        out.replaceChildren(el("p", "problems", e.message));
      } finally {
        go.disabled = false;
        go.textContent = "Write a new version";
      }
    });
    inputs.append(go);
    area.append(
      inputs,
      el(
        "p",
        "tip",
        "Uses your AI plan’s allowance. Check it before you send it: it should only use what’s on your resume.",
      ),
      out,
    );
    if (saved[t.kind]) show(saved[t.kind]);
  };
  for (const t of shown) {
    const b = el("button", "small", t.label);
    b.type = "button";
    b.dataset.kind = t.kind;
    b.addEventListener("click", () => open(t));
    bar.append(b);
  }
  if (shown[0]) open(shown[0]);
}

function drawReview(box, r) {
  box.replaceChildren(
    el(
      "h3",
      null,
      `AI review: ${r.call} · technical match ${r.techScore}/10 · overall fit ${r.fitScore}/10`,
    ),
  );
  if (r.summary) box.append(el("p", null, r.summary));
  if (r.requirements.length) {
    const ul = el("ul", "lines");
    for (const q of r.requirements) {
      const li = el("li");
      li.append(
        el("strong", null, `${q.match}: `),
        el(
          "span",
          null,
          `${q.requirement}${q.required ? "" : " (nice to have)"}`,
        ),
        el("em", null, q.evidence ? ` (${q.evidence})` : ""),
      );
      ul.append(li);
    }
    box.append(el("h3", null, "What they ask for, and your evidence"), ul);
  }
  if (r.gaps.length) {
    const ul = el("ul", "lines");
    r.gaps.forEach((g) => ul.append(el("li", null, g)));
    box.append(el("h3", null, "Gaps to be ready for"), ul);
  }
  if (r.leadWith.length)
    box.append(el("p", null, `Lead with: ${r.leadWith.join(", ")}`));
  if (r.eligibility)
    box.append(el("p", "tip", `Eligibility: ${r.eligibility}`));
  box.append(
    el(
      "p",
      "tip",
      `Reviewed by your AI ${ago(r.at)}. A judgement from your resume, not a promise.`,
    ),
  );
}

function drawAnswers(box, r) {
  if (r?.call === "Skip")
    return box.replaceChildren(
      el(
        "p",
        "tip",
        "Your AI said to skip this job, so it didn\u2019t write application answers.",
      ),
    );
  if (!r?.answers?.length)
    return box.replaceChildren(
      el(
        "p",
        "tip",
        'No answers came back for this job. Try "Get an AI review now" again later.',
      ),
    );
  box.replaceChildren(
    el("h3", null, "Answers to the questions applications usually ask"),
    el(
      "p",
      "tip",
      "From your resume only. Fill in anything in [square brackets] yourself before you paste it.",
    ),
  );
  const ol = el("ol", "qs answers");
  for (const x of r.answers) {
    const li = el("li");
    const copy = el("button", "small", "Copy");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(x.a);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Select and copy it";
      }
      setTimeout(() => {
        copy.textContent = "Copy";
      }, 2000);
    });
    const head = el("div", "ans-head");
    head.append(el("strong", null, x.q), copy);
    const a = el("p", "ans");
    for (const part of x.a.split(/(\[[^\]]+\])/))
      a.append(
        /^\[.*\]$/.test(part)
          ? el("mark", null, part)
          : document.createTextNode(part),
      );
    li.append(head, a);
    ol.append(li);
  }
  box.append(ol);
}

function drawPrep(box, p) {
  box.replaceChildren();
  let group = null,
    list = null;
  for (const it of p.items) {
    if (it.group !== group) {
      group = it.group;
      box.append(el("h3", null, group));
      list = el("ol", "qs");
      box.append(list);
    }
    const li = el("li");
    li.append(el("strong", null, it.question));
    if (it.lines.length) {
      const ul = el("ul", "lines");
      for (const l of it.lines) {
        const x = el("li");
        x.append(el("span", null, l.text), el("em", null, ` (${l.from})`));
        ul.append(x);
      }
      li.append(ul);
    }
    if (it.tip) li.append(el("p", "tip", it.tip));
    list.append(li);
  }
  box.append(el("h3", null, "Questions to ask them"));
  const ul = el("ul", "lines");
  for (const q of p.ask) ul.append(el("li", null, q));
  box.append(ul);
}

async function load(reset = true) {
  if (reset) {
    offset = 0;
    $("list").replaceChildren();
  }
  const r = await api(`/api/jobs?${query(view, offset, 50)}`);
  r.jobs.forEach((j) => $("list").append(card(j)));
  offset += r.jobs.length;
  $("count").textContent =
    `${r.total.toLocaleString()} ${r.total === 1 ? "job" : "jobs"}`;
  if (view) loadCounts();
  else showCounts(r.counts, r.total);
  $("more").hidden = offset >= r.total;
}

async function status() {
  const s = await api("/api/status");
  const parts = [];
  if (s.pool)
    parts.push(
      `Job pool: ${s.pool.count.toLocaleString()} jobs, ${ago(s.pool.generatedAt)}`,
    );
  if (s.jobBank) parts.push(`Job Bank: ${s.jobBank.count.toLocaleString()}`);
  const chosen = s.settings?.ai;
  const ai =
    chosen === "none"
      ? { label: "none (rule-based)" }
      : chosen === "chrome"
        ? { label: "Chrome built-in AI" }
        : s.ai && (s.ai[chosen] || Object.values(s.ai).find((a) => a.working));
  parts.push(ai ? `AI: ${ai.label}` : "AI: none found yet");
  aiOn = ["codex", "claude"].includes(s.settings?.ai);
  if (
    s.preparing?.running &&
    s.preparing.reviews &&
    s.preparing.reviews.done < s.preparing.reviews.total
  )
    parts.push(
      `AI reviewing new jobs ${s.preparing.reviews.done}/${s.preparing.reviews.total}`,
    );
  else if (s.preparing?.running)
    parts.push(`Making documents ${s.preparing.done}/${s.preparing.total}`);
  else if (s.preparing?.total)
    parts.push(`Documents ready for ${s.preparing.total} new matches`);
  $("status").textContent = s.refreshing ? "Updating jobs…" : parts.join(" · ");
  if (s.newIdeas && !s.refreshing) {
    const b = el(
      "button",
      "link ideas-note",
      `${s.newIdeas} new role idea${s.newIdeas === 1 ? "" : "s"} from your resume`,
    );
    b.type = "button";
    b.addEventListener("click", openRoles);
    $("status").append(" · ", b);
  }
  if (s.version) $("version").textContent = s.version;
  if (s.update?.available) {
    $("update").hidden = false;
    $("updateText").textContent =
      `B3spoken ${s.update.version} is available (you have ${s.version}). Your setup, tracker and documents are kept.`;
  }
  showProblems(s.problems);
  return s;
}

// Problems from the last refresh. A Job Bank problem gets a button that checks Job Bank from this computer.
let shownProblems = "";
function showProblems(list) {
  const key = list.join(" ");
  if (key === shownProblems) return; // don't redraw (and lose a check result) every few seconds
  shownProblems = key;
  const box = $("problems");
  box.hidden = !list.length;
  box.replaceChildren(el("span", null, key));
  if (!list.some((p) => /Job Bank/.test(p))) return;
  const btn = el("button", "small", "Check Job Bank now");
  btn.type = "button";
  const out = el("div");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Checking… (about 10 seconds)";
    try {
      const r = await api("/api/jobbank/check", { method: "POST" });
      const ul = el("ul", "lines");
      for (const l of r.lines)
        ul.append(el("li", null, `${l.ok ? "PASS" : "FAIL"}: ${l.text}`));
      out.replaceChildren(
        ul,
        el(
          "p",
          null,
          r.advice + (r.refreshing ? " Getting Job Bank jobs now…" : ""),
        ),
      );
      if (r.refreshing) poll();
    } catch (e) {
      out.replaceChildren(el("p", null, e.message));
    } finally {
      btn.disabled = false;
      btn.textContent = "Check Job Bank again";
    }
  });
  box.append(" ", btn, out);
}

// Health check: what works, what needs attention, and what to do about it.
async function health() {
  const box = $("health");
  if (!box.hidden && box.dataset.done) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.dataset.done = "";
  box.replaceChildren(el("p", null, "Checking…"));
  try {
    const r = await api("/api/health");
    const ul = el("ul");
    for (const i of r.items) {
      const li = el("li");
      li.append(
        el("span", `st ${i.status}`, i.status),
        el("span", null, `${i.name}: ${i.text}`),
      );
      if (i.fix && i.status !== "PASS") li.append(el("span", "fix", i.fix));
      ul.append(li);
    }
    const close = el("button", "small", "Close");
    close.type = "button";
    close.addEventListener("click", () => {
      box.hidden = true;
    });
    const auto = el("label", "mini");
    const cb = el("input");
    cb.type = "checkbox";
    const s = await api("/api/settings");
    cb.checked = s.autostart !== false;
    cb.addEventListener("change", async () => {
      try {
        await api("/api/autostart", {
          method: "PUT",
          body: JSON.stringify({ on: cb.checked }),
        });
        health();
        health();
      } catch (e) {
        cb.checked = !cb.checked;
        alert(e.message);
      }
    });
    auto.append(
      cb,
      el(
        "span",
        null,
        " Start B3spoken when I sign in to this computer (it runs in the background, so new jobs and documents are ready each morning)",
      ),
    );
    const per = el("label", "mini");
    const n = el("input");
    n.type = "number";
    n.min = "0";
    n.max = "200";
    n.value = String(s.reviewsPerDay ?? 30);
    n.style.width = "5em";
    n.addEventListener("change", async () => {
      try {
        await api("/api/settings", {
          method: "PUT",
          body: JSON.stringify({ reviewsPerDay: Number(n.value) }),
        });
      } catch (e) {
        alert(e.message);
      }
    });
    per.append(
      el(
        "span",
        null,
        "New jobs your AI reviews each day, best first (each job once; 0 turns it off): ",
      ),
      n,
    );
    box.replaceChildren(
      el(
        "h3",
        null,
        r.worst === "PASS"
          ? "Everything works"
          : r.worst === "WARN"
            ? "Working, with things to look at"
            : "Something needs fixing",
      ),
      ul,
      auto,
      per,
      close,
    );
    box.dataset.done = "1";
  } catch (e) {
    box.replaceChildren(
      el("p", "problems", `The health check didn't run: ${e.message}`),
    );
  }
}

// New role ideas (the AI re-checks the resume each week): a note in the status line opens a pop-up with switches.
// Saving updates the searches straight away, so there's no need to go back through setup.
let rolesOpen = false;
async function openRoles() {
  const box = $("rolesBox");
  if (rolesOpen) return;
  rolesOpen = true;
  try {
    const [c, prof] = await Promise.all([
      api("/api/career"),
      api("/api/profile"),
    ]);
    if (!c?.titles) {
      rolesOpen = false;
      return;
    }
    const searching = new Set((c.searching || []).map((x) => x.toLowerCase())),
      asked = c.answered || {};
    const fresh = [...c.titles, ...c.unexpected, ...c.higherPay]
      .map((t) => t.title)
      .filter(
        (t) => !searching.has(t.toLowerCase()) && !asked[t.toLowerCase()],
      );
    const pick = rolePicker.draw($("rolesPick"), {
      career: c,
      on: prof.extraRoles || [],
      fixed: prof.targetRoles || [],
      only: fresh,
    });
    $("rolesSave").onclick = async () => {
      $("rolesSave").disabled = true;
      try {
        await api("/api/roles", {
          method: "PUT",
          body: JSON.stringify({
            extraRoles: pick.picked(),
            seen: pick.shown(),
          }),
        });
        box.close();
        await status();
        load();
      } catch (e) {
        alert(e.message);
      } finally {
        $("rolesSave").disabled = false;
      }
    };
    $("rolesLater").onclick = () => box.close();
    box.onclose = () => {
      rolesOpen = false;
    };
    box.showModal();
  } catch {
    rolesOpen = false;
  }
}

async function update() {
  $("updateGo").disabled = true;
  $("updateGo").textContent = "Downloading and checking…";
  try {
    const r = await api("/api/update/install", { method: "POST" });
    $("updateText").textContent = r.manual
      ? "Downloaded and checked. Open the release page to install it on this computer."
      : `Installing ${r.version}. B3spoken will close and open again by itself in about a minute; then refresh this page.`;
    $("updateGo").hidden = true;
  } catch (e) {
    $("updateText").textContent = e.message;
    $("updateGo").disabled = false;
    $("updateGo").textContent = "Try again";
  }
}

// Keeps the status line (and document progress) current.
setInterval(() => status().catch(() => {}), 5000);

async function poll() {
  const s = await status().catch(() => null);
  if (s && !s.refreshing) {
    await load();
    return;
  }
  setTimeout(poll, 2000);
}

async function init() {
  const prof = await api("/api/profile");
  if (!prof.done) {
    location.href = "/setup";
    return;
  }
  const s = await api("/api/settings");
  $("kw").value = s.keywords.join(", ");
  $("province").value = s.province;
  $("remote").value = s.remote;
  for (const id of ["q"])
    $(id).addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => load(), 250);
    });
  for (const id of ["province", "remote", "age", "minLabel", "sort"])
    $(id).addEventListener("change", () => load());
  $("more").addEventListener("click", () => load(false));
  $("updateGo").addEventListener("click", update);
  $("healthGo").addEventListener("click", health);
  $("checkUpdate").addEventListener("click", async () => {
    const b = $("checkUpdate");
    b.disabled = true;
    b.textContent = "Checking…";
    try {
      const u = await api("/api/update?force=1");
      if (u?.available) {
        await status();
        b.textContent = `Version ${u.version} is ready`;
      } else
        b.textContent = u?.error
          ? "Couldn’t check (try later)"
          : "You have the newest version";
    } catch {
      b.textContent = "Couldn’t check (try later)";
    } finally {
      setTimeout(() => {
        b.disabled = false;
        b.textContent = "Check for updates";
      }, 6000);
    }
  });
  for (const b of document.querySelectorAll(".tabs button"))
    b.addEventListener("click", () => {
      view = b.dataset.view;
      for (const x of document.querySelectorAll(".tabs button"))
        x.classList.toggle("on", x === b);
      document.querySelector(".filters").hidden = !!view;
      load();
    });
  $("pasteGo").addEventListener("click", async () => {
    const url = $("pasteUrl").value.trim();
    if (!url) return;
    $("pasteGo").disabled = true;
    $("pasteGo").textContent = "Checking…";
    $("pasteMsg").hidden = true;
    try {
      const r = await api("/api/paste", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      $("pasted").prepend(card(r.job));
      $("pasteUrl").value = "";
    } catch (e) {
      $("pasteMsg").hidden = false;
      $("pasteMsg").textContent = e.message;
    } finally {
      $("pasteGo").disabled = false;
      $("pasteGo").textContent = "Check link";
    }
  });
  await loadDue();
  $("refresh").addEventListener("click", async () => {
    await api("/api/refresh", { method: "POST" });
    poll();
  });
  $("saveKw").addEventListener("click", async () => {
    const cur = await api("/api/settings");
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        ...cur,
        keywords: $("kw").value.split(","),
        province: $("province").value,
        remote: $("remote").value,
      }),
    });
    await api("/api/refresh", { method: "POST" });
    poll();
  });
  poll();
}
init().catch((e) => {
  $("status").textContent = `The helper isn't answering: ${e.message}`;
});
