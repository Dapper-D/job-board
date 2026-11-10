// Career ideas from the person's own AI, read from their resume: their strongest skills (with the resume line that
// proves each), job titles they qualify for now, titles they may not have thought of, industries where their
// background is valued, and better-paid paths with what's missing to reach them.
// Every title is then checked against the real job pool: how many current postings match it and what they pay,
// so suggestions come with real numbers rather than guesses.
import { parsePay, SENIOR } from './match.mjs';

const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const LEVELS = ['Entry', 'Junior', 'Intermediate', 'Senior', 'Lead'];
// Work years from the resume's dates decide which levels make sense (anyone can use this, from new grads to managers).
export const levelsFor = years => (years >= 8 ? LEVELS.slice(2) : years >= 5 ? LEVELS.slice(1, 4) : years >= 2 ? LEVELS.slice(0, 3) : LEVELS.slice(0, 2));

export const CAREER_PROMPT = (resume, profile = {}, years = 0) => `You are a careful career adviser. Reply with only JSON.
Read the RESUME and suggest where this person can realistically get hired in Canada${profile.remote ? ' or remotely' : ''}.

RULES
- Use only what the RESUME shows. Never assume skills, years or credentials it doesn't show.
- Skills the person says they don't have: ${(profile.missingSkills || []).join(', ') || '(none listed)'}.
- Roles they already picked: ${[...(profile.targetRoles || []), ...(profile.extraRoles || [])].join(', ') || '(none)'}.
- Pay goal: ${profile.payGoal ? `${profile.payGoal} per ${profile.payGoalUnit}` : 'not given'}.
- Projects and internships are not years of professional employment. The resume's dates show about ${years} years of work, so suggest ${levelsFor(years).join(', ').toLowerCase()} level roles.
- Any field: suggest titles from whatever field the resume shows (healthcare, trades, finance, tech and so on), plus nearby fields where the same skills transfer.
- Titles must be real, common job titles that employers post (searchable words, no slashes or "or").
- Don't state salaries; real pay is looked up separately.

RESUME
<<<RESUME
${String(resume || '').slice(0, 12000)}
RESUME>>>

Return:
{"strengths": [{"skill": "...", "evidence": "the resume line, job or project that shows it"}],
 "titles": [{"title": "...", "level": ${levelsFor(years).map(l => `"${l}"`).join(' | ')}, "why": "one line tied to the resume"}],
 "unexpected": [{"title": "...", "why": "why this background fits a role they may not have considered"}],
 "industries": [{"name": "...", "why": "one line"}],
 "higherPay": [{"title": "...", "why": "why it pays more", "gap": "what's missing from the resume to get there, honestly"}]}
- strengths: 4-6, strongest first. titles: 5-8 they qualify for now. unexpected: 3-5 not already in their picked roles.
- industries: 3-5. higherPay: 2-4 reachable within a year or two.`;

// Checks the AI's answer; returns clean ideas or null.
export function cleanCareer(raw, years = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const list = (v, n, f) => (Array.isArray(v) ? v : []).map(f).filter(x => Object.values(x)[0]).slice(0, n);
  const title = t => str(t, 70).replace(/\s*[/|].*$/, '');
  const out = {
    strengths: list(raw.strengths, 6, s => ({ skill: str(s?.skill, 80), evidence: str(s?.evidence, 200) })),
    titles: list(raw.titles, 8, t => ({ title: title(t?.title), level: levelsFor(years).find(l => l.toLowerCase() === String(t?.level || '').toLowerCase()) || levelsFor(years)[0], why: str(t?.why, 200) })),
    unexpected: list(raw.unexpected, 5, t => ({ title: title(t?.title), why: str(t?.why, 220) })),
    industries: list(raw.industries, 5, i => ({ name: str(i?.name, 60), why: str(i?.why, 200) })),
    higherPay: list(raw.higherPay, 4, t => ({ title: title(t?.title), why: str(t?.why, 200), gap: str(t?.gap, 220) })),
  };
  return out.titles.length || out.unexpected.length ? out : null;
}

const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').split(' ').filter(w => w.length > 1 && !['and', 'the', 'of', 'for', 'in', 'i', 'ii', 'iii', 'jr', 'junior', 'entry', 'level', 'intermediate'].includes(w));

// How many current postings match a title (every word of it appears in the job title) and what those that state pay offer.
// Senior, lead and manager postings are left out for people with under 5 years, so the numbers fit their level.
export function marketFor(title, jobs, years = 0) {
  const want = words(title).map(w => w.replace(/s$/, ''));
  if (!want.length) return { count: 0 };
  const hits = jobs.filter(j => { if (years < 5 && SENIOR.test(j.title || '') && !SENIOR.test(title)) return false; const have = new Set(words(j.title).map(w => w.replace(/s$/, ''))); return want.every(w => have.has(w)); });
  const pays = hits.map(j => parsePay(j.salary || '', { salaryField: true }) || parsePay(String(j.description || '').slice(0, 4000))).filter(Boolean).map(p => Math.round((p.min + p.max) / 2)).sort((a, b) => a - b);
  const mid = pays.length ? pays[Math.floor(pays.length / 2)] : null;
  return { count: hits.length, paid: pays.length, median: mid, top: pays.length ? pays[pays.length - 1] : null, ids: hits.slice(0, 50).map(j => j.id) };
}

// Adds real job counts and pay to every suggested title.
export function withMarket(ideas, jobs, years = 0) {
  const add = t => ({ ...t, market: marketFor(t.title, jobs, years) });
  return { ...ideas, titles: ideas.titles.map(add), unexpected: ideas.unexpected.map(add), higherPay: ideas.higherPay.map(add) };
}
