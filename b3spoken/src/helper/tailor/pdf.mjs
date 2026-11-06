// A small PDF writer for resumes and cover letters.
// - Real text in the standard Helvetica fonts, so applicant tracking systems (ATS) can read every word.
// - No metadata at all: no Info dictionary, no XMP, no producer or creator names, no dates, no IDs.
// - Letter size, one column, simple drawing (text and thin lines only).

// Widths per 1000 units for characters 32..126 (Adobe's standard metrics).
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
// Windows-1252 bytes for the non-ASCII characters resumes commonly use.
const CP1252 = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, ' ': 0x20 };
const EXTRA_W = { 0x80: 556, 0x82: 222, 0x84: 333, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000 };

export function toWinAnsi(s) {
  const out = [];
  for (const ch of String(s).normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c <= 126) out.push(c);
    else if (CP1252[ch] != null) out.push(CP1252[ch]);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else if (ch === '\t') out.push(32);
    else { const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); const p = plain.codePointAt(0); out.push(p >= 32 && p <= 126 ? p : 63); }
  }
  return out;
}

export function textWidth(s, size, bold = false) {
  const w = bold ? W_BOLD : W_REG;
  let total = 0;
  for (const c of toWinAnsi(s)) total += c >= 32 && c <= 126 ? w[c - 32] : EXTRA_W[c] ?? 556;
  return (total * size) / 1000;
}

export function wrap(text, size, width, bold = false) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next, size, bold) <= width || !line) line = next; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

const esc = bytes => bytes.map(b => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('');
const num = n => (Math.round(n * 100) / 100).toString();

// A page is a list of drawing operations; build() turns pages into PDF bytes.
export class Doc {
  constructor({ width = 612, height = 792 } = {}) { this.width = width; this.height = height; this.pages = []; this.page(); }
  page() { this.ops = []; this.pages.push(this.ops); return this; }
  text(x, y, s, { size = 10, bold = false } = {}) { this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(y)} Td (${esc(toWinAnsi(s))}) Tj ET`); return this; }
  line(x1, y1, x2, y2, w = 0.6) { this.ops.push(`${num(w)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`); return this; }
  build() {
    const objs = [];
    const add = s => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const ops of this.pages) {
      const content = ops.join('\n');
      const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}
