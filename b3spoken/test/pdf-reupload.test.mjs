// People upload the PDF B3spoken made for them, or a two-column template PDF: both must read back as the same resume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText } from '../src/helper/resume/extract.mjs';
import { buildLibrary } from '../src/helper/resume/library.mjs';
import { planResume, renderResume } from '../src/helper/tailor/tailor.mjs';
import { Doc } from '../src/helper/tailor/pdf.mjs';

const RESUME = `Jo Lee
Surrey, BC | 604-555-0100 | jo@example.com | github.com/jolee
SUMMARY
Developer building web apps and data pipelines with Python and TypeScript for small teams and clients.
SKILLS
Languages: Python, TypeScript, SQL
EXPERIENCE
Software Developer, Northwind Logistics, Jan 2023 – Present
- Built a daily job-search pipeline that pulls postings from the Greenhouse, Lever and Ashby APIs and remote-job feeds, runs on GitHub Actions and publishes to GitHub Pages every morning.
- Wrote REST APIs in Flask used by three internal teams.
PROJECTS
Under50 - Restaurant Finder (github.com/jolee/under50 | Next.js, React, TypeScript, Chakra UI, PostgreSQL, Prisma, Vercel, Google Maps)
- Designed the PostgreSQL schema and Prisma data layer; deployed on Vercel.
EDUCATION
BCIT - Diploma in Computer Systems, 2022`;

test('a resume PDF made by B3spoken reads back as the same entries and bullets', () => {
  const lib = buildLibrary(RESUME);
  const pdf = renderResume(planResume(lib, { title: 'Software Developer', company: 'Acme', description: 'Python, Flask, PostgreSQL' }));
  const back = buildLibrary(extractText(pdf, 'r.pdf').text);
  assert.match(back.contact.lines[0], /^Surrey, BC \| 604-555-0100 \| jo@example\.com \| /); // one line, not split at the link
  const shape = l => l.entries.map(e => [e.kind, e.bullets.length]);
  assert.deepEqual(shape(back), shape(lib));
  const p = back.entries.find(e => e.kind === 'projects');
  assert.match(p.heading, /^Under50 - Restaurant Finder \(github\.com\/jolee\/under50 \| .*Google Maps\)$/); // a wrapped heading is one project
  const e = back.entries.find(x => x.kind === 'experience');
  assert.equal(e.bullets.length, 2); // a wrapped bullet stays one bullet
  assert.match(e.bullets.map(b => b.text).join(' '), /Greenhouse, Lever and Ashby APIs/);
});

test('a two-column PDF is read one column at a time', () => {
  const d = new Doc();
  let y = 720;
  d.text(72, y, 'Ana Souza', { size: 16, bold: true }); y -= 18;
  d.text(72, y, 'Vancouver, BC | ana@example.com'); y -= 28;
  const left = ['SKILLS', 'React', 'TypeScript', 'Node.js', 'EDUCATION', 'UBC, BSc Computer Science, 2023'];
  const right = ['EXPERIENCE', 'Frontend Developer, Thinkific, 2023 - Present', '• Built React components for the course editor used by 5,000 creators.', '• Cut bundle size 20% by code-splitting routes.', 'PROJECTS', 'Budget App', '• Built a budgeting app with Next.js and Supabase.'];
  for (let i = 0; i < right.length; i++, y -= 14) { if (left[i]) d.text(72, y, left[i]); d.text(240, y, right[i]); }
  const r = extractText(d.build(), 'two.pdf');
  assert.ok(r.readable); // short, but real text: not "a scanned picture"
  const lib = buildLibrary(r.text);
  assert.deepEqual(lib.entries.map(e => [e.kind, e.bullets.length]), [['education', 0], ['experience', 2], ['projects', 1]]);
  assert.deepEqual(lib.skills.flatMap(s => s.items), ['React', 'TypeScript', 'Node.js']);
});
