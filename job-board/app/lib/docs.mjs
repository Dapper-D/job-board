// Writes a job's tailored resume and cover letter as PDFs, using the same builder the board uses.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, KIT } from './paths.mjs';

const require = createRequire(import.meta.url);
let printer = null;
function getPrinter() {
  if (printer) return printer;
  const Printer = require('pdfmake');
  const F = n => join(APP, 'fonts', 'Carlito-' + n + '.ttf');
  printer = new Printer({ Carlito: { normal: F('Regular'), bold: F('Bold'), italics: F('Italic'), bolditalics: F('BoldItalic') } });
  return printer;
}
async function builder() {
  if (!globalThis.TailorPDF) await import('../public/tailorpdf.js');
  return globalThis.TailorPDF;
}
// pdfmake changes the definition it is given, so each use gets its own copy.
const copy = def => structuredClone(def);
const pages = async def => getPrinter().createPdfKitDocument(copy(def))._pdfMakePages.length;
const toBuffer = def => new Promise((resolve, reject) => {
  const doc = getPrinter().createPdfKitDocument(copy(def));
  const chunks = [];
  doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
  doc.end();
});

export const DOCS_DIR = join(KIT, 'documents');

// Returns { resume, cover } file paths (cover null when there's no letter), or { skipped: reason }.
export async function makeDocs(lib, job, { outDir = DOCS_DIR } = {}) {
  const tl = job.tailor;
  if (!lib || !tl) return { skipped: 'no tailoring for this job' };
  if (tl.noAI) return { skipped: 'the employer asks applicants not to use AI' };
  const T = await builder();
  const written = T.writtenText(tl);
  const trap = ((job.legit && job.legit.trapPhrases) || []).map(x => String(x).toLowerCase().trim()).filter(x => x.length > 2).find(x => written.includes(x));
  if (trap) return { skipped: 'the tailored text contains this posting\'s AI-trap phrase "' + trap + '"' };
  const r = await T.build(lib, job, tl, pages);
  const dir = join(outDir, r.names.resume.replace(/^.* - Resume - /, '').replace(/\.pdf$/, ''));
  mkdirSync(dir, { recursive: true });
  const out = { resume: join(dir, r.names.resume), cover: null };
  writeFileSync(out.resume, await toBuffer(r.resume));
  if (r.cover) { out.cover = join(dir, r.names.cover); writeFileSync(out.cover, await toBuffer(r.cover)); }
  out.pages = await pages(r.resume);
  return out;
}
