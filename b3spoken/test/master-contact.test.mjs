// Master-format resumes ("1. IDENTITY", "2. PROFESSIONAL SUMMARY"…): the name and contact details wherever the file
// keeps them, and bullets with or without a space after the dot. Found on a tester's PDF that came out headed "Your Name".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLibrary } from '../src/helper/resume/library.mjs';
import { planResume } from '../src/helper/tailor/tailor.mjs';

const body = (b = '• ') => `2. PROFESSIONAL SUMMARY
Software developer with backend testing experience.
3. VERIFIED EMPLOYMENT HISTORY
Student Assistant | Douglas College | May 2025 - Present
${b}Troubleshot programming errors, Linux exercises, and technical laboratory problems.
${b}Supported approximately 80-120 students each term.
4. PROJECTS
Goalie - Tournament Management System | September 2025 - December 2025
Repository: https://github.com/Jo-e/Goalie
${b}Developed backend tests using JUnit and MockMvc.
`;
const job = { title: 'Software Developer in Test', company: 'Acme', description: 'JUnit, MockMvc, Java, test automation' };

test('name and contact details kept in a numbered identity section are read', () => {
  const lib = buildLibrary(`EXTREMELY DETAILED MASTER SPECIFICATION
Verified career inventory
1. CANDIDATE IDENTITY AND CONTACT
Name: Jo Example
Location: Surrey, BC
Phone: 604-555-0100
Email: jo@example.com
GitHub: github.com/Jo-e
LinkedIn: linkedin.com/in/jo-example
Work authorization: study permit
` + body());
  assert.equal(lib.contact.name, 'Jo Example');
  assert.deepEqual(lib.contact.lines, ['Surrey, BC | 604-555-0100 | jo@example.com | github.com/Jo-e | linkedin.com/in/jo-example']);
  const plan = planResume(lib, job);
  assert.equal(plan.name, 'Jo Example');
  assert.match(plan.contact.join(' | '), /jo@example\.com/);
  assert.ok(lib.entries.some((e) => e.kind === 'experience' && e.bullets.length === 2)); // the rest reads as before
});

test('a "Contact" section with a plain name line and a combined contact line works too', () => {
  const lib = buildLibrary(`MASTER CAREER SPECIFICATION
1. CONTACT INFORMATION
Jo Example
Surrey, BC | 604-555-0100 | jo@example.com
` + body());
  assert.equal(lib.contact.name, 'Jo Example');
  assert.deepEqual(lib.contact.lines, ['Surrey, BC | 604-555-0100 | jo@example.com']);
});

test('on the cover, "Name: Jo Example" is the name without its label, and an email line is never taken for a name', () => {
  const a = buildLibrary(`MASTER CAREER SPECIFICATION\nName: Jo Example\nEmail: jo@example.com | Phone: 604-555-0100\n` + body());
  assert.equal(a.contact.name, 'Jo Example');
  assert.deepEqual(a.contact.lines, ['jo@example.com | 604-555-0100']);
  const b = buildLibrary(`JO EXAMPLE - MASTER CAREER SPECIFICATION\njo@example.com | 604-555-0100\n` + body());
  assert.notEqual(b.contact.name, 'jo@example.com | 604-555-0100');
  assert.deepEqual(b.contact.lines, ['jo@example.com | 604-555-0100']);
  // The plain cover that already worked still does.
  const c = buildLibrary(`JO EXAMPLE\njo@example.com | 604-555-0100 | github.com/Jo-e\nMASTER CAREER SPECIFICATION\n` + body());
  assert.equal(c.contact.name, 'JO EXAMPLE');
  assert.deepEqual(c.contact.lines, ['jo@example.com | 604-555-0100 | github.com/Jo-e']);
});

test('bullets are read with or without a space after the dot, as PDFs give them', () => {
  for (const b of ['• ', '•', '▪', '']) {
    const lib = buildLibrary(`JO EXAMPLE\njo@example.com\nMASTER CAREER SPECIFICATION\n` + body(b));
    const work = lib.entries.find((e) => e.kind === 'experience');
    assert.deepEqual(work.bullets.map((x) => x.text), ['Troubleshot programming errors, Linux exercises, and technical laboratory problems.', 'Supported approximately 80-120 students each term.'], JSON.stringify(b));
    assert.equal(lib.entries.find((e) => e.kind === 'projects').bullets.length, 1);
  }
  // A dash or star is a bullet only with a space after it: "-5 C storage" and "**Bold**" are text.
  const lib = buildLibrary(`JO EXAMPLE\njo@example.com\nMASTER CAREER SPECIFICATION\n` + body('- '));
  assert.equal(lib.entries.find((e) => e.kind === 'experience').bullets.length, 2);
});
