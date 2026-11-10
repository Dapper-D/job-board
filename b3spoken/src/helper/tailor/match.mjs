// Scores each job against the person's resume and answers. Works with no AI and runs on their computer.
// Score 0-100 with plain reasons. Hard stops (pay below their floor, sponsorship refused when they need it,
// citizenship or clearance they don't have, an industry they want to avoid) make a job "Skip", and Skip jobs
// are never shown.
import { norm } from "../resume/library.mjs";
import { yearly } from "../profile.mjs";
import { scamSigns } from "./scam.mjs";

// Skills and tools we look for in postings (plus everything in the person's own skills list).
export const VOCAB =
  `python java javascript typescript c# c++ golang rust ruby php kotlin swift scala sql nosql bash powershell
react angular vue next.js node node.js express django flask fastapi spring .net rails graphql restful api apis grpc html css tailwind
postgresql mysql mongodb redis elasticsearch kafka rabbitmq spark airflow dbt snowflake bigquery databricks pandas numpy
aws azure gcp cloud docker kubernetes terraform ansible jenkins github actions gitlab ci/cd linux unix git jira
pytest jest selenium playwright cypress unit testing automated testing qa
machine learning llm openai anthropic gemini prompt engineering nlp pytorch tensorflow
security cybersecurity siem splunk sentinel soc incident response vulnerability nessus openvas nmap metasploit burp firewall iam
active directory entra okta zero trust iso 27001 soc 2 nist pci risk compliance audit governance
networking tcp/ip dns dhcp vpn cisco routing switching
excel power bi tableau looker dashboards analytics statistics
help desk troubleshooting tickets itil servicenow windows macos office 365 microsoft 365
agile scrum stakeholders documentation project management
customer service sales crm salesforce hubspot marketing seo content social media
accounting bookkeeping quickbooks reconciliation payroll gaap ifrs`
    .split(/\s+/)
    .filter(Boolean);
const MULTI = [
  "github actions",
  "ci/cd",
  "machine learning",
  "prompt engineering",
  "incident response",
  "active directory",
  "zero trust",
  "iso 27001",
  "soc 2",
  "power bi",
  "help desk",
  "office 365",
  "microsoft 365",
  "project management",
  "customer service",
  "social media",
  "unit testing",
  "automated testing",
];
const TERMS = [
  ...new Set([
    ...MULTI,
    ...VOCAB.filter((v) => !MULTI.some((m) => m.split(" ").includes(v))),
  ]),
];

const re = (t) =>
  new RegExp(
    `(^|[^a-z0-9+#.])${t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}($|[^a-z0-9+#])`,
  );
const RE = new Map();
const has = (textNorm, t) => {
  let r = RE.get(t);
  if (!r) RE.set(t, (r = re(t)));
  return r.test(textNorm);
};

export function termsIn(textNorm, extra = []) {
  return [
    ...new Set([...TERMS, ...extra.map(norm).filter((x) => x.length > 1)]),
  ].filter((t) => has(textNorm, t));
}

// "$90,000 - $110,000", "$45/hr", "35–45 per hour", "120k". Returns { min, max, unit } in dollars per year or null.
// Pay, turned into a yearly range in Canadian dollars ({ min, max, unit }; currency: 'USD' when it was converted).
// Reads "$90,000 - $110,000 per year", "CA$95K–120K", "CA$152K – CA$190K • Offers Equity", "CAD 135300 – 169100 per-year-salary",
// "USD 120000 – 140000 yearly", "$35/hr", "$28 - $32 hourly", "$800 – $1,200 per week", "$6,000 a month".
// A single amount with no unit ("$220K • Offers Equity") counts only in a job's salary field (salaryField: true), never in
// the description, where "$500 signing bonus" would be read as pay. Placeholder ranges ("$1 – $999,999") are ignored.
// US dollars are converted at a fixed, rounded rate: close enough for a pay floor, never shown as the job's own pay.
export const USD_TO_CAD = 1.37;
const CUR = String.raw`(?:(CA|C|CAD|US|USD|AU|A)\s?\$|\$|(CAD|USD)\s+)`;
const NUM = String.raw`(\d+(?:\.\d+)?)\s?(k|K)?(?!\s?(?:million|billion|mm?\b|bn?\b))`;
const UNIT = String.raw`(?:\s*(?:CAD|USD))?\s*(?:(?:per|an|a|\/|-)\s*|per-)?(hour|hr|year|yr|annum|month|mo|week|wk|hourly|annually|annual|yearly|monthly|weekly|(?:per-)?hour-wage|(?:per-)?year-salary)?`;
const PAY_RE = new RegExp(`${CUR}\\s?${NUM}(?:\\s*(?:-|–|—|to)\\s*${CUR}?\\s?${NUM})?(?:\\s*(CAD|USD))?${UNIT}`, 'gi');
export function parsePay(text, { salaryField = false } = {}) {
  // "77,800" and "1,200" lose their thousands commas; "60,000,00" and "140,00" (a cents slip) lose the ",00".
  const s = String(text || '').replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d),\d{1,2}(?!\d)/g, '$1').replace(/(\d),(?!\d)/g, '$1');
  for (const m of s.matchAll(PAY_RE)) {
    const [, cur1, cur2, n1, k1, cur3, cur4, n2, k2, cur5, unitRaw] = m;
    const usd = /^US/i.test(cur1 || cur2 || cur3 || cur4 || cur5 || '');
    let a = Number(n1) * (k1 ? 1000 : 1), b = n2 ? Number(n2) * (k2 || (k1 && Number(n2) < 1000) ? 1000 : 1) : a;
    const u = String(unitRaw || '').toLowerCase();
    if (!n2 && !u && !(salaryField && (k1 || a >= 1000))) continue; // a lone amount: pay only when it's the salary field
    if (n2 && b < a) { if (b * 1000 >= a && b < 1000) b *= 1000; else b = a; } // "$70,473 - $88," (cut off): just the first
    if (n2 && a < 1000 && b >= 10000 && !u) a = a * 1000 <= b ? a * 1000 : b; // "$195 – $415,000"
    const unit = /^(h|per-hour|hour)/.test(u) ? 'hour' : /^mo/.test(u) ? 'month' : /^(w)/.test(u) ? 'week' : u ? 'year' : b < 300 ? 'hour' : 'year';
    const f = { hour: 2080, week: 52, month: 12, year: 1 }[unit];
    let min = a * f, max = b * f;
    if (usd) { min *= USD_TO_CAD; max *= USD_TO_CAD; }
    if (min < 15000 || max > 1500000 || max / Math.max(min, 1) > 4) continue; // a placeholder or a stray number, not pay
    return { min: Math.round(min), max: Math.round(max), unit: unit === 'hour' ? 'hour' : 'year', ...(usd ? { currency: 'USD' } : {}) };
  }
  return null;
}

// Years of work experience from the library's experience dates.
export function yearsOfExperience(lib, now = new Date()) {
  const M = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const when = (s) => {
    const m = String(s)
      .toLowerCase()
      .match(
        /(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2})/,
      );
    return m ? new Date(Number(m[2]), m[1] ? M[m[1]] : 0, 1) : null;
  };
  // A separator must be a dash or the whole word "to", not the "to" in October.
  // Count distinct calendar months so simultaneous jobs do not inflate tenure.
  const months = new Set();
  const thisMonth = now.getFullYear() * 12 + now.getMonth();
  for (const e of lib?.entries || []) {
    if (e.kind !== "experience" || !e.dates) continue;
    const [a, b] = String(e.dates).split(/\s*(?:[–—-]|\bto\b)\s*/i);
    const start = when(a),
      end = /present|current|now/i.test(b || "") ? now : when(b) || start;
    if (!start || !end || end < start) continue;
    const from = start.getFullYear() * 12 + start.getMonth();
    const until = Math.min(thisMonth, end.getFullYear() * 12 + end.getMonth());
    for (let month = from; month <= until; month++) months.add(month);
  }
  return Math.round((months.size / 12) * 10) / 10;
}

// Job families, judged from job titles. A job outside every family the person's roles belong to is a different field
// (for example a mechanical engineer or a lab technician that happens to mention Python), and never shows.
const FAMILIES = {
  software:
    /\b(software|developer|programmer|full[- ]?stack|front[- ]?end|back[- ]?end|web|mobile|ios|android|sdet|qa|quality assurance|test automation|(software|web|application|applications|platform|solutions|systems|data|ml|ai|devops|qa|test|integration|automation|cloud|security|support|backend|frontend) engineer(ing)?)\b/,
  security:
    /\b(security|cyber|cybersecurity|soc (analyst|specialist|operator|tier)|siem|vulnerability|penetration|pen ?test(er)?|incident response|threat|iam|identity and access|access management|grc|(it|security|cyber|information|technology|data) (governance|compliance|risk)|privacy engineer|infosec)\b/,
  it: /\b(it|help ?desk|service ?desk|desktop support|technical support|tech support|support (analyst|specialist|technician|engineer)|systems? (administrator|analyst|specialist)|sysadmin|network (administrator|analyst|engineer|technician)|infrastructure|endpoint|it (analyst|specialist|technician|coordinator))\b/,
  ai: /\b(ai|machine learning|ml|llm|artificial intelligence|nlp|prompt|data scien(ce|tist)|genai|generative)\b/,
  data: /\b(data (analyst|engineer|specialist)|analytics|business intelligence|bi (analyst|developer)|database|dba|reporting analyst)\b/,
  cloud:
    /\b(cloud|devops|sre|site reliability|platform engineer|aws|azure|gcp)\b/,
  business:
    /\b(business (systems )?analyst|product analyst|systems analyst|technical analyst|solutions (analyst|consultant)|implementation (specialist|consultant)|product (manager|owner)|project (manager|coordinator)|program (manager|coordinator)|scrum master)\b/,
  // Fields outside tech, so the same check works for anyone's resume.
  healthcare:
    /\b(nurse|nursing|rn|lpn|physician|doctor|pharmac(y|ist)|dental|dentist|hygienist|therapist|physiotherap(y|ist)|care aide|health care|healthcare|clinical|medical|patient|paramedic|caregiver|personal support worker|psw|radiolog|sonograph|optometr|veterinar)\w*\b/,
  finance:
    /\b(accountant|accounting|bookkeep(er|ing)|payroll|audit(or)?|tax|financial (analyst|advisor|planner)|finance|controller|accounts (payable|receivable)|credit analyst|underwrit(er|ing)|actuar(y|ial)|investment|banking|bank teller|teller|treasury)\b/,
  sales:
    /\b(sales|account (executive|manager)|business development|bdr|sdr|retail (associate|sales)|cashier|store (associate|manager)|merchandis(er|ing))\b/,
  marketing:
    /\b(marketing|seo|content (writer|strategist|creator|marketing)|copywriter|social media|brand|communications|public relations|pr (specialist|coordinator)|growth)\b/,
  people:
    /\b(human resources|hr|recruit(er|ing|ment)|talent acquisition|people (partner|operations)|benefits|compensation)\b/,
  customer:
    /\b(customer (service|support|success|care|experience)|call cent(er|re)|client (service|support)s?|contact cent(er|re))\b/,
  design:
    /\b(designer|design|ux|ui|graphic|illustrat(or|ion)|animator|video editor|photographer|art director)\b/,
  operations:
    /\b(warehouse|logistics|supply chain|procurement|purchasing|inventory|shipping|receiving|forklift|driver|delivery|dispatch(er)?|fleet|operations (associate|coordinator|manager|specialist)|buyer)\b/,
  legal:
    /\b(lawyer|legal|paralegal|counsel|attorney|law clerk|compliance (officer|advisor|specialist|analyst)|regulatory)\b/,
  education:
    /\b(teacher|lecturer|professor|instructor|tutor|educator|faculty|early childhood|ece|education assistant|teaching)\b/,
  trades:
    /\b(electrician|plumber|carpenter|welder|mechanic|technician|millwright|hvac|machinist|labourer|laborer|construction|apprentice|journeyman|installer|maintenance)\b/,
  engineering:
    /\b((mechanical|electrical|civil|chemical|structural|manufacturing|process|industrial|hardware|mechatronics|environmental|geotechnical|mining|aerospace) engineer(ing)?|drafter|cad)\b/,
  science:
    /\b(scientist|laborator(y|ies)|lab (technician|assistant)|research (assistant|associate)|chemist|biolog(y|ist)|microbiolog)\w*\b/,
  hospitality:
    /\b(chef|cook|kitchen|server|bartender|barista|host(ess)?|housekeep(er|ing)|hotel|restaurant|food service|dishwasher|front desk)\b/,
  admin:
    /\b(administrative|admin assistant|office (manager|assistant|administrator)|receptionist|executive assistant|data entry|clerk|coordinator)\b/,
};
// A teaching post names a subject ("Lecturer, Cybersecurity") but the job is teaching.
// "Technician", "installer" or "maintenance" alone make a title a trade ("Parts Technician"), but beside another
// field's words they only describe the level ("Help Desk Technician" is IT, not a trade).
// A store's "Customer Service Desk" is customer service, not an IT service desk.
const GENERIC_TRADE = /\b(technician|installer|maintenance|apprentice)\b/g;
export const familiesOf = (text) => {
  const t = norm(text).replace(/\bcustomer service desk\b/g, "customer service");
  if (FAMILIES.education.test(t)) return ["education"];
  const out = Object.keys(FAMILIES).filter((f) => FAMILIES[f].test(t));
  return out.length > 1 && out.includes("trades") && !FAMILIES.trades.test(t.replace(GENERIC_TRADE, " "))
    ? out.filter((f) => f !== "trades")
    : out;
};

const QA_WORDS = /\b(qa|quality assurance)\b/g;
const QA_ONLY = /\b(qa|quality assurance)\b/;
const SOFTWARE_TITLE = /\b(software|developer|programmer|sdet|test automation|automation|web|mobile|application|game|engineer)\b/;
const SOFTWARE_QA = /\b(software|test automation|automated tests?|test cases|test plans|selenium|cypress|playwright|jest|pytest|api testing|regression testing|bug tracking|jira|agile|ci\/cd)\b/;
const HIGH_LEVEL = /\b(staff|principal|distinguished|fellow|director|head of|vp|vice president|chief|senior manager)\b/i;
const STUDENT_ONLY = /\b(intern(ship)?|co-?op|new grad(uate)?|student|summer analyst)\b/i;
export const SENIOR =
  /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|architect|vp|vice president|chief|expert|distinguished|fellow)\b/i;
const NO_SPONSOR =
  /\b(no|not|unable to|cannot|can't|will not|won't)\s+(provide\s+|offer\s+)?(visa\s+)?sponsor|without (the need for )?(visa )?sponsorship|sponsorship is not (available|provided)/i;
const CITIZEN_ONLY =
  /\b(canadian citizenship (is )?required|must be a canadian citizen|citizens only)\b/i;
const CLEARANCE =
  /\b(secret|top secret|enhanced reliability)\s+(security\s+)?clearance\b|\bclearance (is )?required\b/i;
const YEARS_REQ =
  /(\d{1,2})\s*\+?\s*(?:-\s*\d+\s*)?years?(?:\s+of)?(?:\s+\w+){0,4}\s+experience/i;

// French: a posting written in French, or one that says French is required, needs French on the resume.
// (norm() has already taken the accents off: "français" is "francais".)
const FR_WORDS = /\b(le|la|les|des|du|et|pour|avec|vous|nous|une|dans|sur|est|votre|notre|poste|equipe|entreprise|emploi)\b/g;
const EN_WORDS = /\b(the|and|for|with|you|we|our|your|to|of|in|is|are|team|role|will)\b/g;
const FR_REQUIRED = /\b(french (is )?(required|essential|mandatory)|(fluent|fluency|proficien\w*) in (both )?(english and )?french|bilingual(ism)? \(?(english|french)[ /]+(english|french)\)?( is)? (required|essential|mandatory)|(must|required to) (be able to )?(speak|write|communicate) (in )?(english and )?french|bilinguisme (est )?(requis|obligatoire|essentiel)|francais (est )?(requis|obligatoire|essentiel)|maitrise du francais)\b/;
const FR_OPTIONAL = /\b(asset|assets|preferred|nice to have|a plus|bonus|not required|not mandatory|an advantage|desirable|atout|souhaitable)\b/;
export function asksForFrench(job) {
  const t = norm(`${job.title} ${String(job.description || "").slice(0, 3000)}`);
  const fr = (t.match(FR_WORDS) || []).length, en = (t.match(EN_WORDS) || []).length;
  // "Proficiency in French is an asset but not required" doesn't ask for French.
  const req = [...t.matchAll(new RegExp(FR_REQUIRED.source, "g"))].some((m) => !FR_OPTIONAL.test(t.slice(m.index, m.index + m[0].length + 70)));
  return req || (fr >= 15 && fr > en * 1.5) || /\b\w+\.e?uses?\b|\((trice|ere|euse)\)|\bdeveloppeur|\bconseiller|\bteletravail\b/.test(String(job.title || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
}
const KNOWS_FRENCH = /\b(french|francais|bilingual|bilingue)\b/;

// ctx: { resumeNorm, skills (strings), years, roles (search roles), profile }
export function makeContext(lib, resumeText, profile, roles) {
  return {
    resumeNorm: norm(resumeText),
    skills: (lib?.skills || []).flatMap((s) => s.items),
    years: yearsOfExperience(lib),
    roles: roles || [],
    profile: profile || {},
  };
}

export function scoreJob(job, ctx) {
  const p = ctx.profile;
  const text = norm(
    `${job.title} ${job.department || ""} ${job.description || ""}`,
  );
  const reasons = [],
    stops = [];
  // Hard stops
  const pay = parsePay(job.salary, { salaryField: true }) || parsePay(job.description);
  const floor = yearly(p.payFloor, p.payFloorUnit),
    goal = yearly(p.payGoal, p.payGoalUnit);
  if (pay && floor && pay.max < floor)
    stops.push(
      `Pay tops out at $${pay.max.toLocaleString()} a year, below your lowest ($${floor.toLocaleString()})`,
    );
  if (
    p.workAuth === "needs-sponsorship" &&
    NO_SPONSOR.test(job.description || "")
  )
    stops.push("Says it won’t sponsor a work permit");
  if (
    p.workAuth &&
    p.workAuth !== "citizen" &&
    (CITIZEN_ONLY.test(job.description || "") ||
      /\bsecret\b.*clearance|clearance.*\bsecret\b/i.test(
        job.description || "",
      ))
  )
    stops.push("Needs Canadian citizenship or a security clearance");
  for (const ind of p.avoidIndustries || [])
    if (
      ind &&
      new RegExp(`\\b${norm(ind).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(
        norm(`${job.company} ${job.title} ${job.description || ""}`),
      )
    )
      stops.push(`Industry you want to avoid: ${ind}`);
  if (!KNOWS_FRENCH.test(ctx.resumeNorm) && asksForFrench(job))
    stops.push("Asks for French; your resume doesn’t mention it");
  // Skills
  const wanted = termsIn(text, ctx.skills);
  // "API" and "APIs" are the same skill.
  const onResume = (t) =>
    has(ctx.resumeNorm, t) ||
    has(ctx.resumeNorm, `${t}s`) ||
    (t.endsWith("s") && has(ctx.resumeNorm, t.slice(0, -1)));
  const have = wanted.filter(onResume);
  const missing = wanted.filter((t) => !onResume(t));
  // One matching word out of one isn't a strong signal, so a posting has to name at least 4 skills to score full marks.
  const skillFit = wanted.length
    ? have.length / Math.max(wanted.length, 4)
    : 0.1;
  // Skill names as the person or the posting writes them.
  const pretty = (t) =>
    ctx.skills.find((x) => norm(x) === t) ||
    (String(job.description || "").match(
      new RegExp(
        `(?<![A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![A-Za-z0-9])`,
        "i",
      ),
    ) || [t])[0];
  if (have.length)
    reasons.push(`You have ${have.slice(0, 6).map(pretty).join(", ")}`);
  if (missing.length)
    reasons.push(
      `Not on your resume: ${missing.slice(0, 5).map(pretty).join(", ")}`,
    );
  // Title vs the roles they're searching for
  const titleN = norm(job.title);
  const titleWords = new Set(titleN.split(" "));
  // Field: the job's title has to belong to one of the families the person's roles are in (or closely match a role).
  const mine = [...new Set(ctx.roles.flatMap(familiesOf))];
  const titleFit = Math.max(
    0,
    ...ctx.roles.map((r) => {
      const w = norm(r)
        .split(" ")
        .filter((x) => x.length > 1 && !["and", "the", "of"].includes(x));
      return w.length
        ? (w.filter(
            (x) => titleWords.has(x) || titleWords.has(x.replace(/s$/, "")),
          ).length /
            w.length) **
            2
        : 0;
    }),
  );
  if (titleFit >= 0.99) reasons.push("Title matches a role you picked");
  let fields = familiesOf(`${job.title} ${job.department || ""}`);
  // "Quality Assurance" is software testing only when the posting is about software; in a lab, a plant or a
  // blood bank it's quality control of products, a different field.
  if (fields.includes("software") && QA_ONLY.test(norm(job.title)) && !SOFTWARE_TITLE.test(norm(job.title).replace(QA_WORDS, " ")) && !SOFTWARE_QA.test(text))
    fields = fields.filter((f) => f !== "software");
  // Roles that fit no known field (an unusual job title) fall back to sharing a word with the job's title.
  if (
    titleFit < 0.3 &&
    (mine.length ? !fields.some((f) => mine.includes(f)) : titleFit === 0)
  )
    stops.push("A different field from the roles you picked");
  // Seniority and years
  let seniority = 1;
  const req = (job.description || "").match(YEARS_REQ);
  const yearsReq = req ? Number(req[1]) : null;
  if (yearsReq != null && yearsReq <= 20) {
    if (ctx.years + 1 < yearsReq) {
      seniority -= Math.min(0.6, (yearsReq - ctx.years) * 0.12);
      reasons.push(
        `Asks for ${yearsReq}+ years; your resume shows about ${ctx.years}`,
      );
    }
  }
  const tooSenior = SENIOR.test(job.title) && ctx.years < 3;
  if (SENIOR.test(job.title) && ctx.years < 5) {
    seniority -= tooSenior ? 0.7 : 0.35;
    reasons.push("Senior-level title");
  }
  if (
    /\b(junior|jr\.?|entry[- ]level|new grad|graduate|intern|co-?op|associate)\b/i.test(
      job.title,
    )
  ) {
    seniority = Math.min(1, seniority + 0.1);
    reasons.push("Entry-level or junior");
  }
  // Pay
  let payFit = 0.5;
  if (pay) {
    if (goal && pay.max >= goal) {
      payFit = 1;
      reasons.push(
        `Pay reaches your goal (up to $${pay.max.toLocaleString()} a year)`,
      );
    } else if (floor && pay.max >= floor) {
      payFit = 0.7;
      reasons.push(
        `Pay meets your floor (up to $${pay.max.toLocaleString()} a year)`,
      );
    }
  }
  const score = Math.round(
    100 *
      Math.max(
        0,
        Math.min(
          1,
          0.45 * skillFit +
            0.3 * titleFit +
            0.15 * Math.max(0, seniority) +
            0.1 * payFit,
        ),
      ),
  );
  let label = stops.length
    ? "Skip"
    : score >= 70
      ? "Strong"
      : score >= 50
        ? "Good"
        : score >= 30
          ? "Stretch"
          : "Skip";
  // Senior, lead, staff or manager titles are hidden for people with under 3 years on their resume (they can still paste or track one).
  if (tooSenior) {
    label = "Skip";
    stops.push("Senior-level title; your resume shows under 3 years");
  }
  // Staff, principal, director and higher titles need years of work most resumes under 7 years don't show.
  if (!tooSenior && HIGH_LEVEL.test(job.title) && ctx.years < 7) {
    label = "Skip";
    stops.push(`${HIGH_LEVEL.exec(job.title)[0].replace(/^./, (c) => c.toUpperCase())}-level title; your resume shows about ${ctx.years} years`);
  }
  // Internships, co-ops and new-grad programs are for students and graduates, not people with years of work.
  if (STUDENT_ONLY.test(job.title) && ctx.years >= 4) {
    label = "Skip";
    stops.push(`Internship, co-op or new-grad role; your resume shows about ${ctx.years} years of work`);
  }
  // Scam warning signs: asking for money, banking details and the like hide the job; softer signs show a warning.
  const scam = scamSigns(`${job.title} ${job.description || ""}`);
  if (scam.stop.length) {
    label = "Skip";
    stops.push(`Scam warning signs: it ${scam.stop.join("; it ")}`);
  }
  if (!stops.length && label === "Skip")
    stops.push("Too far from your resume and roles");
  return {
    score: stops.length ? Math.min(score, 29) : score,
    label,
    reasons,
    stops,
    have,
    missing,
    pay,
    ...(scam.stop.length || scam.warn.length
      ? { scam: { stop: scam.stop, warn: scam.warn } }
      : {}),
  };
}
