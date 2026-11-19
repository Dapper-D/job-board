// Resume layouts people really use, for the test set. Each function writes one made-up person (personas.mjs) as
// the text B3spoken gets after reading their file. The facts stay the same in every layout; only the shape changes.
const range = (e, dash = " – ") => (e.to ? `${e.from}${dash}${e.to}` : e.from);
const by = (p, kind) => p.entries.filter((e) => e.kind === kind);
const SECTION = {
  experience: "EXPERIENCE", projects: "PROJECTS", education: "EDUCATION", certifications: "CERTIFICATIONS", volunteer: "VOLUNTEER",
};
const ORDER = ["experience", "projects", "volunteer", "certifications", "education"];
const MONTHS = { Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June", Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December" };
const longMonth = (d) => d.replace(/^([A-Z][a-z]{2})\b/, (m) => MONTHS[m] || m);
const wrap = (text, width, indent = "  ") => {
  const out = []; let line = "";
  for (const w of text.split(" ")) {
    if (line && (line + " " + w).length > width) { out.push(line); line = indent + w; } else line = line ? `${line} ${w}` : w;
  }
  return [...out, line];
};

export const LAYOUTS = {
  // Name, one contact line, CAPS headings, "Title, Employer  dates", dash bullets.
  classic(p) {
    const L = [p.name, [p.city, p.phone, p.email, ...p.links].join(" | "), "", "SUMMARY", p.summary, "", "SKILLS"];
    for (const [label, items] of p.skills) L.push(`${label}: ${items.join(", ")}`);
    for (const kind of ORDER) {
      const es = by(p, kind); if (!es.length) continue;
      L.push("", SECTION[kind]);
      for (const e of es) {
        if (kind === "projects") L.push(`${e.title} | ${e.tech} | ${e.url}`);
        else L.push(`${e.title}${e.org ? `, ${e.org}` : ""}    ${range(e)}`);
        for (const b of e.bullets) L.push(`- ${b}`);
      }
    }
    return L.join("\n");
  },
  // Everything on the heading line, split with pipes; round bullets.
  pipes(p) {
    const L = [p.name.toUpperCase(), `${p.email} | ${p.phone} | ${p.city}`, p.links.join(" | "), "", "PROFESSIONAL SUMMARY", p.summary, "", "TECHNICAL SKILLS"];
    for (const [label, items] of p.skills) L.push(`${label} | ${items.join(" · ")}`);
    for (const kind of ORDER) {
      const es = by(p, kind); if (!es.length) continue;
      L.push("", kind === "experience" ? "PROFESSIONAL EXPERIENCE" : SECTION[kind]);
      for (const e of es) {
        L.push(kind === "projects" ? `${e.title} | ${e.url}` : [e.title, e.org, e.place, range(e, " - ")].filter(Boolean).join(" | "));
        if (kind === "projects") L.push(e.tech);
        for (const b of e.bullets) L.push(`• ${b}`);
      }
    }
    return L.join("\n");
  },
  // Employer on its own line, then the title, then dates and place; bullets touching their dots (as PDFs give them).
  stacked(p) {
    const L = [p.name, p.city, p.phone, p.email, ...p.links, "", "Profile", p.summary, "", "Skills"];
    for (const [, items] of p.skills) L.push(items.join(", "));
    const head = { experience: "Work History", projects: "Selected Projects", education: "Education", certifications: "Certifications", volunteer: "Volunteering" };
    for (const kind of ORDER) {
      const es = by(p, kind); if (!es.length) continue;
      L.push("", head[kind]);
      for (const e of es) {
        if (kind === "projects") { L.push(e.title, `${e.tech} — ${e.url}`); }
        else if (e.org) { L.push(e.org, e.title, [range(e), e.place].filter(Boolean).join(" | ")); }
        else L.push(e.title, range(e));
        for (const b of e.bullets) L.push(`•${b}`);
      }
    }
    return L.join("\n");
  },
  // "CURRICULUM VITAE" above the name, labelled contact lines, headings with colons, dates first, star bullets.
  labelled(p) {
    const L = ["CURRICULUM VITAE", p.name, `Email: ${p.email}`, `Phone: ${p.phone}`, `Location: ${p.city}`];
    for (const l of p.links) L.push(`${/linkedin/.test(l) ? "LinkedIn" : /github/.test(l) ? "GitHub" : "Website"}: ${l}`);
    L.push("", "OBJECTIVE:", p.summary, "", "CORE COMPETENCIES:");
    for (const [, items] of p.skills) for (const i of items) L.push(`* ${i}`);
    const head = { experience: "EMPLOYMENT HISTORY:", projects: "PROJECTS:", education: "EDUCATION:", certifications: "CERTIFICATIONS:", volunteer: "VOLUNTEER EXPERIENCE:" };
    for (const kind of ORDER) {
      const es = by(p, kind); if (!es.length) continue;
      L.push("", head[kind]);
      for (const e of es) {
        if (kind === "projects") L.push(`${e.title} (${e.tech}) - ${e.url}`);
        else L.push(`${range(e, " - ")}  ${e.title}${e.org ? ` at ${e.org}` : ""}`);
        for (const b of e.bullets) L.push(`* ${b}`);
      }
    }
    return L.join("\n");
  },
  // Each achievement on its own line with no bullet marker at all (pasted from a website or an email).
  plain(p) {
    const L = [p.name, `${p.city} · ${p.email} · ${p.phone}`, "", "About Me", p.summary, "", "Skills"];
    for (const [label, items] of p.skills) L.push(`${label}: ${items.join(", ")}`);
    for (const kind of ORDER) {
      const es = by(p, kind); if (!es.length) continue;
      L.push("", { experience: "Experience", projects: "Projects", education: "Education", certifications: "Certifications", volunteer: "Volunteer" }[kind]);
      for (const e of es) {
        L.push(kind === "projects" ? `${e.title} — ${e.tech}` : `${e.title} — ${e.org || ""}`.replace(/ — $/, ""));
        if (kind !== "projects") L.push(range(e));
        else L.push(e.url);
        for (const b of e.bullets) L.push(b);
        L.push("");
      }
    }
    return L.join("\n");
  },
  // Markdown, as people paste from a notes app or GitHub.
  markdown(p) {
    const L = [`# ${p.name}`, "", `${p.city} · ${p.phone} · ${p.email} · ${p.links.join(" · ")}`, "", "## Summary", "", p.summary, "", "## Skills", ""];
    for (const [label, items] of p.skills) L.push(`- **${label}:** ${items.join(", ")}`);
    for (const kind of ORDER) {
      const es = by(p, kind); if (!es.length) continue;
      L.push("", `## ${{ experience: "Experience", projects: "Projects", education: "Education", certifications: "Certifications", volunteer: "Volunteer" }[kind]}`, "");
      for (const e of es) {
        L.push(kind === "projects" ? `### ${e.title}` : `### ${e.title}${e.org ? ` — ${e.org}` : ""}`);
        L.push(kind === "projects" ? `*${e.tech} · ${e.url}*` : `*${range(e)}${e.place ? ` · ${e.place}` : ""}*`);
        L.push("");
        for (const b of e.bullets) L.push(`- ${b}`);
        L.push("");
      }
    }
    return L.join("\n");
  },
  // LinkedIn's "Save to PDF" profile: a contact column first, then name, headline, the experience as
  // employer / title / dates (with duration) / place, and achievements with no bullet markers.
  linkedin(p) {
    const L = ["Contact", p.email, ...p.links.map((l) => /linkedin/.test(l) ? `www.${l} (LinkedIn)` : `${l} (Portfolio)`), "", "Top Skills"];
    for (const i of p.skills.flatMap(([, items]) => items).slice(0, 3)) L.push(i);
    L.push("", p.name, p.summary.split(" who ")[0], p.city, "", "Summary", p.summary, "");
    const exp = p.entries.filter((e) => e.kind === "experience" || e.kind === "volunteer");
    if (exp.length) L.push("Experience");
    for (const e of exp) {
      L.push(e.org, e.title, `${longMonth(e.from)} - ${longMonth(e.to)} (1 year)`, e.place || "");
      for (const b of e.bullets) L.push(b);
      L.push("");
    }
    const edu = p.entries.filter((e) => e.kind === "education" || e.kind === "certifications");
    if (edu.length) L.push("Education");
    for (const e of edu) L.push(e.org || e.title, `${e.title} · (${range(e, " - ")})`, "");
    return L.join("\n");
  },
  // Long achievements wrapped onto a second, indented line (how Word and most PDFs come out).
  wrapped(p) {
    const L = [p.name, [p.city, p.email, p.phone].join(" | "), p.links.join(" | "), "", "SUMMARY", ...wrap(p.summary, 60, ""), "", "SKILLS"];
    for (const [label, items] of p.skills) L.push(`${label}: ${items.join(", ")}`);
    for (const kind of ORDER) {
      const es = by(p, kind); if (!es.length) continue;
      L.push("", SECTION[kind]);
      for (const e of es) {
        L.push(kind === "projects" ? `${e.title} (${e.url})` : `${e.title} — ${e.org || ""}`.replace(/ — $/, ""), kind === "projects" ? e.tech : `${range(e)}${e.place ? `, ${e.place}` : ""}`);
        for (const b of e.bullets) { const [first, ...rest] = wrap(b, 48, "  "); L.push(`• ${first}`, ...rest); }
      }
    }
    return L.join("\n");
  },
  // French section headings (a bilingual résumé from Québec), content in English.
  french(p) {
    const L = [p.name, `${p.city} | ${p.phone} | ${p.email}`, ...p.links, "", "PROFIL", p.summary, "", "COMPÉTENCES"];
    for (const [label, items] of p.skills) L.push(`${label} : ${items.join(", ")}`);
    const head = { experience: "EXPÉRIENCE PROFESSIONNELLE", projects: "PROJETS", education: "FORMATION", certifications: "CERTIFICATIONS", volunteer: "BÉNÉVOLAT" };
    for (const kind of ORDER) {
      const es = by(p, kind); if (!es.length) continue;
      L.push("", head[kind]);
      for (const e of es) {
        L.push(kind === "projects" ? `${e.title} | ${e.tech} | ${e.url}` : `${e.title}, ${e.org || ""}`.replace(/, $/, "") + `\t${range(e)}`);
        for (const b of e.bullets) L.push(`▪ ${b}`);
      }
    }
    return L.join("\n");
  },
  // A long "master" career inventory with numbered sections and notes for whoever tailors it.
  master(p) {
    const L = ["MASTER CAREER SPECIFICATION", p.name.toUpperCase(), `${p.city} | ${p.phone} | ${p.email}`, p.links.join(" | "), "Master source for tailoring role-specific résumés.", "", "1 | PROFESSIONAL IDENTITY & POSITIONING", p.summary, "Professional positioning: Do not claim senior titles.", ""];
    let n = 2;
    const head = { experience: "VERIFIED EMPLOYMENT HISTORY", projects: "PROJECTS", volunteer: "VOLUNTEER", certifications: "CERTIFICATIONS", education: "EDUCATION" };
    for (const kind of ORDER) {
      const es = by(p, kind); if (!es.length) continue;
      L.push(`${n++} | ${head[kind]}`);
      for (const e of es) {
        L.push(kind === "projects" ? `${e.title} — ${e.tech}` : `${e.title}${e.org ? ` — ${e.org}` : ""} | ${range(e, "–")}`);
        if (kind === "projects") L.push(`Repository: ${e.url}`);
        else if (e.place) L.push(`Context: ${e.place}.`);
        for (const b of e.bullets) L.push(`•${b}`);
        L.push("");
      }
    }
    L.push(`${n} | TECHNICAL SKILL MATRIX`);
    for (const [label, items] of p.skills) L.push(`${label}: ${items.join(", ")}`);
    return L.join("\n");
  },
};
