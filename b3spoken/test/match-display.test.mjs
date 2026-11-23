// What the board shows about a match: skill names spelled one way, no doubles, skills found inside longer words,
// and a score that says where its points came from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob, makeContext } from '../src/helper/tailor/match.mjs';
import { cleanProfile } from '../src/helper/profile.mjs';

const resume = 'Cybersecurity student. Built REST APIs in JavaScript and Python. Git/GitHub, Linux, pentesting labs.';
const lib = { skills: [{ items: ['Python', 'JavaScript', 'Git/GitHub', 'Linux', 'Cybersecurity'] }], entries: [] };
const profile = cleanProfile({ targetRoles: ['Security Analyst'], workAuth: 'citizen', done: true, payGoal: 100000, payGoalUnit: 'year' });
const ctx = { ...makeContext(lib, resume, profile, ['Security Analyst']), years: 1.5 };
const job = (description, extra = {}) => ({ id: 'x', title: 'Security Analyst', company: 'Acme', location: 'Vancouver, BC', description, ...extra });
const listed = (m, start) => (m.reasons.find((r) => r.startsWith(start)) || '').slice(start.length).split(', ').filter(Boolean);

test('a skill inside a longer word on the resume counts: "Cybersecurity" covers "security"', () => {
  const m = scoreJob(job('You know security, javascript and testing. Kotlin is a plus.'), ctx);
  assert.ok(!m.missing.includes('security'), m.missing.join());
  assert.ok(!m.missing.includes('testing'), 'pentesting covers testing');
  assert.ok(m.missing.includes('kotlin'));
  // Short words don't count inside longer ones: "sql" is not in "nosql" by this rule.
  const s = scoreJob(job('SQL and Python.'), { ...ctx, resumeNorm: 'nosql python' });
  assert.ok(s.missing.includes('sql'));
});

test('the same skill is listed once, whatever its spelling, plural or case', () => {
  const m = scoreJob(job('Javascript, JAVASCRIPT, API, APIs, apis, git, Node and Node.js.'), ctx);
  const have = listed(m, 'You have ');
  const missing = listed(m, 'Not on your resume: ');
  const all = [...have, ...missing].map((x) => x.toLowerCase().replace(/s$/, '').replace(/\.js$/, ''));
  assert.equal(new Set(all).size, all.length, [...have, '|', ...missing].join(', '));
  assert.ok(have.includes('JavaScript'), have.join());
  assert.ok(!have.includes('Javascript'));
  assert.ok(have.some((x) => /^APIs?$/.test(x)), have.join());
  assert.ok(missing.includes('Node.js'), missing.join());
  assert.deepEqual(m.skills.have.slice(0, have.length), have);
});

test('a skill is never both on the resume and missing', () => {
  const m = scoreJob(job('Security, cybersecurity, git, Git/GitHub, Linux, linux.'), ctx);
  for (const t of m.have) assert.ok(!m.missing.includes(t), t);
  assert.ok(!listed(m, 'Not on your resume: ').length, m.reasons.join(' | '));
});

test('the score comes with where its points came from, and the parts add up', () => {
  const m = scoreJob(job('Python, JavaScript, Linux, Kotlin, security. $90,000 - $110,000 per year.'), ctx);
  assert.deepEqual(m.parts.map((p) => p.key), ['skills', 'title', 'level', 'pay']);
  assert.deepEqual(m.parts.map((p) => p.max), [45, 30, 15, 10]);
  const sum = m.parts.reduce((a, p) => a + p.points, 0);
  assert.ok(Math.abs(sum - m.score) <= 2, `${sum} vs ${m.score}`);
  for (const p of m.parts) assert.ok(p.points >= 0 && p.points <= p.max && p.why, JSON.stringify(p));
  assert.match(m.parts[0].why, /of \d+ skills/);
});
