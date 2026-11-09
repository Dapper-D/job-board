// A small PDF writer for resumes and cover letters.
// - Real, selectable text in the embedded Carlito font (Calibri's widths), with a Unicode map so applicant
//   tracking systems (ATS) read every word. Only the letters the document uses are embedded.
// - Metadata is only the title and the person's name as author: no producer or creator names, no dates,
//   no IDs, no XMP, nothing that names the software used.
// - Letter size, one column, simple drawing (text and thin lines only).

// Windows-1252 bytes for the non-ASCII characters resumes commonly use.
const CP1252 = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, ' ': 0x20 };

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

// Widths come from the embedded font (Carlito, which has Calibri's widths).
export function textWidth(s, size, bold = false) {
  const f = bold ? fonts().bold : fonts().regular;
  let total = 0;
  for (const ch of clean(s)) total += f.width(f.glyph(ch));
  return (total * size) / 1000;
}
// Tabs become spaces and other control characters are dropped.
const clean = s => [...String(s).normalize('NFC').replace(/\t/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '')];

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
import { deflateSync } from 'node:zlib';
import { fonts, subsetFont } from './font.mjs';

const num = n => (Math.round(n * 100) / 100).toString();

// A page is a list of drawing operations; build() turns pages into PDF bytes.
export class Doc {
  constructor({ width = 612, height = 792, title = '', author = '' } = {}) { this.width = width; this.height = height; this.title = title; this.author = author; this.pages = []; this.annots = []; this.used = { F1: new Map(), F2: new Map() }; this.page(); }
  page() { this.ops = []; this.pages.push(this.ops); this.links = []; this.annots.push(this.links); return this; }
  // color: optional [r, g, b] from 0 to 1 (links are drawn in blue); black otherwise.
  text(x, y, s, { size = 10, bold = false, color = null } = {}) {
    const name = bold ? 'F2' : 'F1', f = bold ? fonts().bold : fonts().regular, used = this.used[name];
    const hex = clean(s).map(ch => { const g = f.glyph(ch); if (!used.has(g)) used.set(g, f.map.get(ch.codePointAt(0)) ? ch : '?'); return g.toString(16).padStart(4, '0'); }).join('');
    this.ops.push(`BT ${color ? color.map(num).join(' ') + ' rg' : '0 g'} /${name} ${num(size)} Tf ${num(x)} ${num(y)} Td <${hex}> Tj ET`);
    return this;
  }
  line(x1, y1, x2, y2, w = 0.6, color = null) { this.ops.push(`${color ? color.map(num).join(' ') + ' RG' : '0 G'} ${num(w)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`); return this; }
  // A clickable area on the current page that opens a web or mailto address. No border is drawn.
  link(x1, y1, x2, y2, uri) {
    const u = String(uri || '');
    if (/^(https?:\/\/|mailto:)[\x21-\x7e]+$/i.test(u)) this.links.push({ rect: [x1, y1, x2, y2], uri: u });
    return this;
  }
  build() {
    const objs = [];
    const add = s => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesId = add(null);
    const bin = [];
    const font = (key, f, base) => {
      const used = this.used[key];
      if (!used.size) used.set(f.glyph(' '), ' ');
      const tag = createTag(base, used);
      const file = subsetFont(f, used.keys());
      const ff = add(null); bin.push([ff, `<< /Length1 ${file.length} /Filter /FlateDecode`, deflateSync(file)]);
      const desc = add(`<< /Type /FontDescriptor /FontName /${tag} /Flags 32 /FontBBox [${f.bbox.map(v => Math.round((v * 1000) / f.unitsPerEm)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round((f.ascent * 1000) / f.unitsPerEm)} /Descent ${Math.round((f.descent * 1000) / f.unitsPerEm)} /CapHeight ${Math.round((f.capHeight * 1000) / f.unitsPerEm)} /StemV ${key === 'F2' ? 120 : 80} /FontFile2 ${ff} 0 R >>`);
      const gids = [...used.keys()].sort((a, b) => a - b);
      const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${tag} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /W [${gids.map(g => `${g} [${Math.round(f.width(g))}]`).join(' ')}] /CIDToGIDMap /Identity >>`);
      const tu = add(null); bin.push([tu, '<<', Buffer.from(toUnicode(used), 'latin1')]);
      return add(`<< /Type /Font /Subtype /Type0 /BaseFont /${tag} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`);
    };
    const f1 = font('F1', fonts().regular, 'Carlito'), f2 = font('F2', fonts().bold, 'Carlito-Bold');
    const str = t => `(${esc([...Buffer.from(String(t).replace(/[\u0000-\u001f]/g, ' ').slice(0, 200), 'latin1')])})`;
    const info = this.title || this.author ? add(`<< ${this.title ? `/Title ${str(this.title)} ` : ''}${this.author ? `/Author ${str(this.author)}` : ''} >>`) : 0;
    const kids = [];
    this.pages.forEach((ops, i) => {
      const content = ops.join('\n');
      const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
      const links = (this.annots[i] || []).map(l => add(`<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(num).join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${esc([...l.uri].map(ch => ch.charCodeAt(0)))}) >> >>`));
      const annots = links.length ? ` /Annots [${links.map(k => `${k} 0 R`).join(' ')}]` : '';
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R${annots} >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    for (const [id, dict, data] of bin) objs[id - 1] = { dict, data };
    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let size = chunks[0].length;
    const push = b => { chunks.push(b); size += b.length; };
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(size);
      if (typeof o === 'string') push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1'));
      else { push(Buffer.from(`${i + 1} 0 obj\n${o.dict} /Length ${o.data.length} >>\nstream\n`, 'latin1')); push(o.data); push(Buffer.from('\nendstream\nendobj\n', 'latin1')); }
    });
    const xref = size;
    let out = '';
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.concat([...chunks, Buffer.from(out, 'latin1')]);
  }
}

// A six-letter subset tag (required for embedded subsets), taken from the glyphs used so it is stable.
function createTag(base, used) {
  let h = 0; for (const g of [...used.keys()].sort((a, b) => a - b)) h = (h * 31 + g) >>> 0;
  let tag = ''; for (let i = 0; i < 6; i++) { tag += String.fromCharCode(65 + (h % 26)); h = Math.floor(h / 26); }
  return `${tag}+${base}`;
}
// Maps each glyph back to its letter, so copied or ATS-read text comes out as real words.
function toUnicode(used) {
  const hex = ch => [...Buffer.from(ch, 'utf16le').swap16()].map(b => b.toString(16).padStart(2, '0')).join('');
  const pairs = [...used].map(([g, ch]) => `<${g.toString(16).padStart(4, '0')}> <${hex(ch)}>`);
  let body = '';
  for (let i = 0; i < pairs.length; i += 100) { const part = pairs.slice(i, i + 100); body += `${part.length} beginbfchar\n${part.join('\n')}\nendbfchar\n`; }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${body}endcmap\nCMapName currentdict /CMapType defineresource pop\nend\nend`;
}
