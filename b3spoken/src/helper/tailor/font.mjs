// Reads a TrueType font (Carlito: the same widths as Calibri, open licence) and writes a small subset of it
// for embedding in a PDF. No outside libraries.
// - Glyph IDs stay the same in the subset; glyphs the document doesn't use are left empty, so the file stays small.
// - Only the tables a PDF viewer needs are kept (no names, no layout tables).
import { readAsset } from '../assets.mjs';

const u16 = (b, o) => b.readUInt16BE(o), i16 = (b, o) => b.readInt16BE(o), u32 = (b, o) => b.readUInt32BE(o);

export function parseFont(buf) {
  const tables = {};
  const n = u16(buf, 4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tables[buf.toString('latin1', o, o + 4)] = { off: u32(buf, o + 8), len: u32(buf, o + 12) };
  }
  const t = name => { const x = tables[name]; if (!x) throw new Error(`font has no ${name} table`); return buf.subarray(x.off, x.off + x.len); };
  const head = t('head'), hhea = t('hhea'), maxp = t('maxp'), hmtx = t('hmtx'), os2 = tables['OS/2'] ? t('OS/2') : null;
  const unitsPerEm = u16(head, 18), numGlyphs = u16(maxp, 4), numH = u16(hhea, 34), longLoca = i16(head, 50) === 1;
  const adv = new Uint16Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) adv[g] = u16(hmtx, 4 * Math.min(g, numH - 1));
  // Character to glyph: Windows Unicode (format 4) subtable.
  const cmap = t('cmap'), map = new Map();
  for (let i = 0; i < u16(cmap, 2); i++) {
    const pid = u16(cmap, 4 + i * 8), eid = u16(cmap, 6 + i * 8), off = u32(cmap, 8 + i * 8);
    if (!(pid === 3 && eid === 1 && u16(cmap, off) === 4)) continue;
    const segX2 = u16(cmap, off + 6), ends = off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = u16(cmap, ends + s * 2), start = u16(cmap, starts + s * 2), delta = i16(cmap, deltas + s * 2), ro = u16(cmap, ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g;
        if (!ro) g = (c + delta) & 0xffff;
        else { g = u16(cmap, ranges + s * 2 + ro + (c - start) * 2); if (g) g = (g + delta) & 0xffff; }
        if (g) map.set(c, g);
      }
    }
  }
  const loca = t('loca'), at = g => (longLoca ? u32(loca, g * 4) : u16(loca, g * 2) * 2);
  return {
    buf, tables, unitsPerEm, numGlyphs, adv, map, longLoca, glyf: t('glyf'), at,
    bbox: [i16(head, 36), i16(head, 38), i16(head, 40), i16(head, 42)],
    ascent: i16(hhea, 4), descent: i16(hhea, 6), capHeight: os2 && u16(os2, 0) >= 2 ? i16(os2, 88) : i16(hhea, 4),
    glyph(ch) { return map.get(ch.codePointAt(0)) || map.get(0x3f) || 0; }, // missing characters become "?"
    width(gid) { return (adv[gid] * 1000) / unitsPerEm; },
  };
}

// Glyphs inside composite glyphs (accented letters are often built from two glyphs).
function components(font, gid) {
  const s = font.at(gid), e = font.at(gid + 1), g = font.glyf;
  if (e - s < 10 || i16(g, s) >= 0) return [];
  const out = [];
  let p = s + 10, flags;
  do {
    flags = u16(g, p); out.push(u16(g, p + 2)); p += 4;
    p += flags & 1 ? 4 : 2; // arguments
    if (flags & 8) p += 2; else if (flags & 0x40) p += 4; else if (flags & 0x80) p += 8;
  } while (flags & 0x20);
  return out;
}

const pad4 = b => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
function checksum(b) { const p = pad4(b); let s = 0; for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0; return s; }

// A font file holding only the given glyphs (plus glyph 0, which every font must have).
export function subsetFont(font, used) {
  const keep = new Set([0, ...used]);
  for (const g of [...keep]) for (const c of components(font, g)) keep.add(c);
  const parts = [], loca = [];
  let off = 0;
  for (let g = 0; g < font.numGlyphs; g++) {
    loca.push(off);
    if (keep.has(g)) { const d = pad4(Buffer.from(font.glyf.subarray(font.at(g), font.at(g + 1)))); parts.push(d); off += d.length; }
  }
  loca.push(off);
  const glyf = Buffer.concat(parts);
  const locaBuf = Buffer.alloc(loca.length * 4); loca.forEach((v, i) => locaBuf.writeUInt32BE(v, i * 4));
  const raw = name => Buffer.from(font.buf.subarray(font.tables[name].off, font.tables[name].off + font.tables[name].len));
  const head = raw('head'); head.writeInt16BE(1, 50); head.writeUInt32BE(0, 8); // long loca offsets; checksum set below
  const post = Buffer.alloc(32); raw('post').copy(post, 0, 0, 32); post.writeUInt32BE(0x00030000, 0); // no glyph names
  const out = { head, hhea: raw('hhea'), maxp: raw('maxp'), hmtx: raw('hmtx'), loca: locaBuf, glyf, post };
  for (const name of ['cvt ', 'fpgm', 'prep', 'OS/2']) if (font.tables[name]) out[name] = raw(name);
  const names = Object.keys(out).sort();
  const n = names.length, log = Math.floor(Math.log2(n));
  const dir = Buffer.alloc(12 + n * 16);
  dir.writeUInt32BE(0x00010000, 0); dir.writeUInt16BE(n, 4); dir.writeUInt16BE(16 * 2 ** log, 6); dir.writeUInt16BE(log, 8); dir.writeUInt16BE(n * 16 - 16 * 2 ** log, 10);
  let pos = dir.length;
  const bodies = names.map((name, i) => {
    const b = out[name];
    dir.write(name, 12 + i * 16, 4, 'latin1'); dir.writeUInt32BE(checksum(b), 16 + i * 16); dir.writeUInt32BE(pos, 20 + i * 16); dir.writeUInt32BE(b.length, 24 + i * 16);
    const p = pad4(b); pos += p.length; return p;
  });
  const file = Buffer.concat([dir, ...bodies]);
  const headAt = dir.readUInt32BE(12 + names.indexOf('head') * 16 + 8);
  file.writeUInt32BE((0xb1b0afba - checksum(file)) >>> 0, headAt + 8);
  return file;
}

let cache = null;
// The two faces resumes use. Read once from the files that ship with B3spoken.
export function fonts() {
  if (!cache) cache = { regular: parseFont(readAsset('fonts/Carlito-Regular.ttf')), bold: parseFont(readAsset('fonts/Carlito-Bold.ttf')) };
  return cache;
}
