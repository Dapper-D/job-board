import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractText } from '../src/helper/resume/extract.mjs';
import { buildLibrary, requireResumeContent } from '../src/helper/resume/library.mjs';
import { planResume, renderResume } from '../src/helper/tailor/tailor.mjs';
import { makeJob } from '../src/scan/job.mjs';
import { createApp } from '../src/helper/main.mjs';

const master = `MASTER CAREER SPECIFICATION • NOVEMBER 2026
JORDAN LEE
VERIFIED MASTER CAREER & RESUME SPECIFICATION
Toronto, ON | 555-555-0123 | jordan@example.test
LinkedIn: linkedin.com/in/example | GitHub: github.com/example
Master source for tailoring resumes.
1 | PROFESSIONAL IDENTITY & POSITIONING
Software developer building Java and Python applications with relational databases.
Target job families: Junior Software Developer; Backend Developer.
Professional positioning: Do not invent employment.
2 | VERIFIED EMPLOYMENT HISTORY
Software Developer — Example Company | January 2023–
September 2024
Context: Toronto, ON; application development.
• Built a Java API integrating SQL queries with user-facing workflows and automated tests.
• Wrote unit tests covering valid input,
invalid input and database errors.
Technical evidence: source repository.
Claim boundary: Do not claim ownership of all company systems.
MASTER CAREER SPECIFICATION • NOVEMBER 2026
3 | PROJECTS — IMPLEMENTATION, OWNERSHIP, TECHNICAL EVIDENCE
News Digest — News Application | React • TypeScript • Node.js
Express • Vitest
Repository:
github.com/example/news | Live: https://example.test
Status / ownership: Completed prototype.
• Built a React frontend and Node.js API for reading external news with automated tests.
• Added an in-memory cache with expiration to avoid repeated upstream requests.
4 | SECONDARY PROJECT & REPOSITORY INVENTORY
• Unverified idea. Do not claim it is completed.
5 | TECHNICAL SKILL MATRIX & EVIDENCE
Languages and programming fundamentals
• Java — Backend API implementation.
• Python — Data processing exercises.
Frameworks, platform tooling, data and integration
• Frameworks: React, Node.js, Express; prototype development.
Engineering process, customer support and quality practices
• Documentation and collaboration across several application development projects.
6 | EDUCATION, TRAINING & RECOGNITION
Example University — Bachelor of Science, Computer Science
Dates: September 2018–August 2022
7 | REUSABLE ROLE-SPECIFIC RESUME STRATEGY
Lead with made-up impressive achievements.
8 | CONSISTENCY & CLAIMS CONTROL
Do not fabricate any achievements or credentials.`;

function pdfWithIndirectStreams() {
  const stream = value => deflateSync(Buffer.from(`BT /F1 10 Tf 50 700 Td (${value}) Tj ET`));
  const a=stream('FIRST PAGE'),b=stream('LAST PAGE');
  return Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page /Contents 2 0 R >> endobj\n2 0 obj << /Length 12 0 R /Filter /FlateDecode >> stream\n'),a,Buffer.from('\nendstream endobj\n3 0 obj << /Type /Page /Contents 4 0 R >> endobj\n4 0 obj << /Length 13 0 R /Filter /FlateDecode >> stream\n'),b,Buffer.from(`\nendstream endobj\n12 0 obj ${a.length} endobj\n13 0 obj ${b.length} endobj\n%%EOF`)]);
}

test('PDF extraction reads every stream with two-digit indirect length references',()=>{
  const r=extractText(pdfWithIndirectStreams(),'master.pdf');
  assert.match(r.text,/FIRST PAGE/);assert.match(r.text,/LAST PAGE/);
});

test('numbered master sections become content, with wrapped bullets, dates and projects preserved',()=>{
  const lib=buildLibrary(master);
  assert.equal(lib.contact.name,'JORDAN LEE');assert.equal(lib.contact.lines.length,2);
  assert.equal(lib.entries.filter(e=>e.kind==='experience').length,1);
  assert.equal(lib.entries.filter(e=>e.kind==='projects').length,1);
  const e=lib.entries[0];assert.equal(e.dates,'January 2023–September 2024');
  assert.equal(e.bullets[1].text,'Wrote unit tests covering valid input, invalid input and database errors.');
  assert.match(lib.entries[1].details.join(' '),/github.com\/example\/news/);
  assert(lib.skills.some(g=>g.items.includes('Java')));
  const plan=planResume(lib,{title:'Junior Software Developer',description:'Java React APIs automated tests'});
  const text=extractText(renderResume(plan),'resume.pdf').text;
  assert.match(text,/Built a Java API/);assert.match(text,/Wrote unit tests/);assert.match(text,/News Digest/);assert.match(text,/Example University/);
  assert.doesNotMatch(text,/Master source|Target job families|made-up|Claim boundary|MASTER CAREER SPECIFICATION/);
});

test('empty parsed imports preserve the previous library and blank PDF generation is blocked',()=>{
  const dir=mkdtempSync(join(tmpdir(),'resume-import-'));
  try{
    const app=createApp(dir,{offline:true,log:()=>{},deps:{detect:async()=>({})}});
    app.uploadResume({text:master});
    const before=readFileSync(join(dir,'library.json'),'utf8');
    assert.throws(()=>app.uploadResume({text:('A descriptive source document with no recognized sections and no structured resume entries. ').repeat(20)}),/No usable/);
    assert.equal(readFileSync(join(dir,'library.json'),'utf8'),before);
    assert.throws(()=>requireResumeContent({entries:[]}),/No usable/);
    assert.throws(()=>planResume({entries:[],skills:[],contact:{}},{title:'Developer'}),/No usable/);
    const bad=buildLibrary(master);bad.entries.forEach(e=>e.flagged=true);
    assert.throws(()=>planResume(bad,{title:'Developer'}),/No usable/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('large source banks fit inside page bounds rather than merely declaring one page',()=>{
  const lib=buildLibrary(master);
  for(let i=0;i<12;i++)lib.entries.push({...structuredClone(lib.entries[0]),id:'extra'+i,heading:'Additional Developer Role '+i});
  const pdf=renderResume(planResume(lib,{title:'Junior Software Developer',description:'Java APIs testing'}));
  assert.match(pdf.toString('latin1'),/\/Count 1 /);
  const y=[...pdf.toString('latin1').matchAll(/(-?[\d.]+) (-?[\d.]+) Td/g)].map(m=>Number(m[2]));
  assert(y.length>10);assert(Math.min(...y)>=50,'no text below bottom margin');
});


test('app produces a populated PDF and rejects stale files after equal-length bullet edits', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'resume-docs-'));
  try {
    const job=makeJob({source:'greenhouse',company:'Example',nativeId:'123',title:'Software Developer',url:'https://boards.greenhouse.io/example/jobs/123',description:'Java APIs React testing',location:'Toronto, ON',postedAt:new Date().toISOString()});
    writeFileSync(join(dir,'pasted.json'),JSON.stringify([job]));
    const app=createApp(dir,{offline:true,log:()=>{},deps:{detect:async()=>({})}});
    const lib=app.uploadResume({text:master});
    app.saveSettings({ai:'none'});
    app.saveProfile({targetRoles:['Software Developer'],done:true});
    await app.refresh();await app.makeDocuments(job.id,{useAi:false});
    assert.match(extractText(app.documentFile(job.id,'resume').bytes,'resume.pdf').text,/Built a Java API/);
    app.updateBullet(lib.entries[0].bullets[0].id,{text:lib.entries[0].bullets[0].text.replace('Built','Wrote')});
    assert.equal(Object.keys(app.documentIndex()).length,0);
    assert.throws(()=>app.documentFile(job.id,'resume'),/library changed/);
    await app.makeDocuments(job.id,{useAi:false});
    assert.match(extractText(app.documentFile(job.id,'resume').bytes,'resume.pdf').text,/Wrote a Java API/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
