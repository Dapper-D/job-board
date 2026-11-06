// Scores each job against the person's resume and answers. Works with no AI and runs on their computer.
// Score 0-100 with plain reasons. Hard stops (pay below their floor, sponsorship refused when they need it,
// citizenship or clearance they don't have, an industry they want to avoid) make a job "Skip", and Skip jobs
// are never shown.
import { norm } from '../resume/library.mjs';
import { yearly } from '../profile.mjs';

// Skills and tools we look for in postings (plus everything in the person's own skills list).
export const VOCAB = `python java javascript typescript c# c++ golang rust ruby php kotlin swift scala sql nosql bash powershell
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
accounting bookkeeping quickbooks reconciliation payroll gaap ifrs`.split(/\s+/).filter(Boolean);
const MULTI = ['github actions', 'ci/cd', 'machine learning', 'prompt engineering', 'incident response', 'active directory', 'zero trust', 'iso 27001', 'soc 2', 'power bi', 'help desk', 'office 365', 'microsoft 365', 'project management', 'customer service', 'social media', 'unit testing', 'automated testing'];
const TERMS = [...new Set([...MULTI, ...VOCAB.filter(v => !MULTI.some(m => m.split(' ').includes(v)))])];

const re = t => new RegExp(`(^|[^a-z0-9+#.])${t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}($|[^a-z0-9+#])`);
const RE = new Map();
const has = (textNorm, t) => { let r = RE.get(t); if (!r) RE.set(t, (r = re(t))); return r.test(textNorm); };

export function termsIn(textNorm, extra = []) {
  return [...new Set([...TERMS, ...extra.map(norm).filter(x => x.length > 1)])].filter(t => has(textNorm, t));
}

// "$90,000 - $110,000", "$45/hr", "35–45 per hour", "120k". Returns { min, max, unit } in dollars per year or null.
export function parsePay(text) {
  const s = String(text || '').replace(/,/g, '');
  const m = s.match(/\$\s?(\d+(?:\.\d+)?)\s?(k)?\s*(?:-|–|—|to)\s*\$?\s?(\d+(?:\.\d+)?)\s?(k)?\s*(?:(?:per|an|a|\/)\s*(hour|hr|year|yr|annum|annually)|(hourly|annually|per annum))?/i)
    || s.match(/\$\s?(\d+(?:\.\d+)?)\s?(k)?()()\s*(?:(?:per|an|a|\/)\s*(hour|hr|year|yr|annum)|(hourly|annually))/i);
  if (!m) return null;
  let a = Number(m[1]) * (m[2] ? 1000 : 1), b = m[3] ? Number(m[3]) * (m[4] || m[2] ? 1000 : 1) : a;
  if (b < a) [a, b] = [b, a];
  const unitWord = (m[5] || m[6] || '').toLowerCase();
  const hourly = /^h/.test(unitWord) || (!unitWord && b < 300);
  if (!hourly && b < 1000) return null; // a stray number, not pay
  const f = hourly ? 2080 : 1;
  return { min: Math.round(a * f), max: Math.round(b * f), unit: hourly ? 'hour' : 'year' };
}

// Years of work experience from the library's experience dates.
export function yearsOfExperience(lib, now = new Date()) {
  const M = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const when = s => { const m = String(s).toLowerCase().match(/(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2})/); return m ? new Date(Number(m[2]), m[1] ? M[m[1]] : 0) : null; };
  let months = 0;
  for (const e of lib?.entries || []) {
    if (e.kind !== 'experience' || !e.dates) continue;
    const [a, b] = String(e.dates).split(/\s*(?:–|—|-|to)\s*/);
    const start = when(a), end = /present|current|now/i.test(b || '') ? now : when(b) || start;
    if (start && end && end >= start) months += (end - start) / (30.44 * 864e5) + 1;
  }
  return Math.round((months / 12) * 10) / 10;
}

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|architect|vp)\b/i;
const NO_SPONSOR = /\b(no|not|unable to|cannot|can't|will not|won't)\s+(provide\s+|offer\s+)?(visa\s+)?sponsor|without (the need for )?(visa )?sponsorship|sponsorship is not (available|provided)/i;
const CITIZEN_ONLY = /\b(canadian citizenship (is )?required|must be a canadian citizen|citizens only)\b/i;
const CLEARANCE = /\b(secret|top secret|enhanced reliability)\s+(security\s+)?clearance\b|\bclearance (is )?required\b/i;
const YEARS_REQ = /(\d{1,2})\s*\+?\s*(?:-\s*\d+\s*)?years?(?:\s+of)?(?:\s+\w+){0,4}\s+experience/i;

// ctx: { resumeNorm, skills (strings), years, roles (search roles), profile }
export function makeContext(lib, resumeText, profile, roles) {
  return { resumeNorm: norm(resumeText), skills: (lib?.skills || []).flatMap(s => s.items), years: yearsOfExperience(lib), roles: roles || [], profile: profile || {} };
}

export function scoreJob(job, ctx) {
  const p = ctx.profile;
  const text = norm(`${job.title} ${job.department || ''} ${job.description || ''}`);
  const reasons = [], stops = [];
  // Hard stops
  const pay = parsePay(job.salary) || parsePay(job.description);
  const floor = yearly(p.payFloor, p.payFloorUnit), goal = yearly(p.payGoal, p.payGoalUnit);
  if (pay && floor && pay.max < floor) stops.push(`Pay tops out at $${pay.max.toLocaleString()} a year, below your lowest ($${floor.toLocaleString()})`);
  if (p.workAuth === 'needs-sponsorship' && NO_SPONSOR.test(job.description || '')) stops.push('Says it won’t sponsor a work permit');
  if (p.workAuth && p.workAuth !== 'citizen' && (CITIZEN_ONLY.test(job.description || '') || /\bsecret\b.*clearance|clearance.*\bsecret\b/i.test(job.description || ''))) stops.push('Needs Canadian citizenship or a security clearance');
  for (const ind of p.avoidIndustries || []) if (ind && new RegExp(`\\b${norm(ind).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(norm(`${job.company} ${job.title} ${job.description || ''}`))) stops.push(`Industry you want to avoid: ${ind}`);
  // Skills
  const wanted = termsIn(text, ctx.skills);
  // "API" and "APIs" are the same skill.
  const onResume = t => has(ctx.resumeNorm, t) || has(ctx.resumeNorm, `${t}s`) || (t.endsWith('s') && has(ctx.resumeNorm, t.slice(0, -1)));
  const have = wanted.filter(onResume);
  const missing = wanted.filter(t => !onResume(t));
  // One matching word out of one isn't a strong signal, so a posting has to name at least 4 skills to score full marks.
  const skillFit = wanted.length ? have.length / Math.max(wanted.length, 4) : 0.1;
  // Skill names as the person or the posting writes them.
  const pretty = t => ctx.skills.find(x => norm(x) === t) || (String(job.description || '').match(new RegExp(`(?<![A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![A-Za-z0-9])`, 'i')) || [t])[0];
  if (have.length) reasons.push(`You have ${have.slice(0, 6).map(pretty).join(', ')}`);
  if (missing.length) reasons.push(`Not on your resume: ${missing.slice(0, 5).map(pretty).join(', ')}`);
  // Title vs the roles they're searching for
  const titleN = norm(job.title);
  const titleWords = new Set(titleN.split(' '));
  const titleFit = Math.max(0, ...ctx.roles.map(r => { const w = norm(r).split(' ').filter(x => x.length > 1 && !['and', 'the', 'of'].includes(x)); return w.length ? (w.filter(x => titleWords.has(x) || titleWords.has(x.replace(/s$/, ''))).length / w.length) ** 2 : 0; }));
  if (titleFit >= 0.99) reasons.push('Title matches a role you picked');
  // Seniority and years
  let seniority = 1;
  const req = (job.description || '').match(YEARS_REQ);
  const yearsReq = req ? Number(req[1]) : null;
  if (yearsReq != null && yearsReq <= 20) {
    if (ctx.years + 1 < yearsReq) { seniority -= Math.min(0.6, (yearsReq - ctx.years) * 0.12); reasons.push(`Asks for ${yearsReq}+ years; your resume shows about ${ctx.years}`); }
  }
  const tooSenior = SENIOR.test(job.title) && ctx.years < 3;
  if (SENIOR.test(job.title) && ctx.years < 5) { seniority -= tooSenior ? 0.7 : 0.35; reasons.push('Senior-level title'); }
  if (/\b(junior|jr\.?|entry[- ]level|new grad|graduate|intern|co-?op|associate)\b/i.test(job.title)) { seniority = Math.min(1, seniority + 0.1); reasons.push('Entry-level or junior'); }
  // Pay
  let payFit = 0.5;
  if (pay) {
    if (goal && pay.max >= goal) { payFit = 1; reasons.push(`Pay reaches your goal (up to $${pay.max.toLocaleString()} a year)`); }
    else if (floor && pay.max >= floor) { payFit = 0.7; reasons.push(`Pay meets your floor (up to $${pay.max.toLocaleString()} a year)`); }
  }
  const score = Math.round(100 * Math.max(0, Math.min(1, 0.45 * skillFit + 0.3 * titleFit + 0.15 * Math.max(0, seniority) + 0.1 * payFit)));
  let label = stops.length ? 'Skip' : score >= 70 ? 'Strong' : score >= 50 ? 'Good' : score >= 30 ? 'Stretch' : 'Skip';
  if (tooSenior && (label === 'Strong' || label === 'Good')) label = 'Stretch'; // a senior title is a stretch with under 3 years
  if (!stops.length && label === 'Skip') stops.push('Too far from your resume and roles');
  return { score: stops.length ? Math.min(score, 29) : score, label, reasons, stops, have, missing, pay };
}
