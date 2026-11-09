// Gets plain text out of a resume file, on the person's own computer, with no outside libraries.
//   .docx: a zip of XML files; we read word/document.xml (paragraphs, tabs, line breaks).
//   .pdf:  text-based PDFs only (what Word, Google Docs and most resume builders export). We read the page
//          content streams and their text operators. Scanned PDFs (pictures of text) give little or nothing,
//          and the person is asked to upload the Word file or paste the text instead.
//   .txt / pasted text: used as is.
import { inflateRawSync, inflateSync } from "node:zlib";

const MAX_FILE = 10 * 1024 * 1024;

// ---- zip (just enough for .docx) ----
export function unzip(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("damaged zip file");
    const method = buf.readUInt16LE(p + 10),
      csize = buf.readUInt32LE(p + 20),
      usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28),
      xlen = buf.readUInt16LE(p + 30),
      clen = buf.readUInt16LE(p + 32),
      local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name !== wanted) continue;
    if (usize > 50 * 1024 * 1024)
      throw new Error("file inside the zip is too large");
    const start =
      local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) return data;
    if (method === 8)
      return inflateRawSync(data, { maxOutputLength: 50 * 1024 * 1024 });
    throw new Error("unsupported zip compression");
  }
  return null;
}

const xmlText = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&");

export function docxText(buf) {
  const xml = unzip(buf, "word/document.xml");
  if (!xml) throw new Error("this Word file has no document text");
  const paras = [];
  for (const m of xml
    .toString("utf8")
    .matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const p = m[0];
    const isList = /<w:numPr>|<w:pStyle w:val="List/.test(p);
    let line = "";
    for (const t of p.matchAll(
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g,
    ))
      line += t[1] != null ? xmlText(t[1]) : t[0] === "<w:tab/>" ? "\t" : "\n";
    paras.push((isList && line.trim() ? "• " : "") + line);
  }
  return paras.join("\n");
}

// ---- PDF (text-based) ----
function pdfString(s) {
  // literal string body, without the outer parentheses
  return s.replace(
    /\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g,
    (_, e) =>
      ({
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        "(": "(",
        ")": ")",
        "\\": "\\",
      })[e] ?? (/^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ""),
  );
}
function parseCMap(text) {
  const map = new Map();
  const cs = text.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>/);
  const width = cs ? cs[1].length : 4; // hex digits per character code
  const hex = (h) => h.toUpperCase().padStart(width, "0");
  const uni = (h) =>
    String.fromCharCode(
      ...(h.match(/.{1,4}/g) || []).map((x) => parseInt(x, 16)),
    );
  for (const b of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g))
      map.set(hex(m[1]), uni(m[2]));
  for (const b of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of b[1].matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g,
    )) {
      const lo = parseInt(m[1], 16),
        hi = parseInt(m[2], 16);
      const list = m[4]
        ? [...m[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => x[1])
        : null;
      for (let c = lo; c <= hi && c - lo < 5000; c++) {
        const v = list
          ? list[c - lo]
          : (parseInt(m[3], 16) + c - lo).toString(16).padStart(4, "0");
        if (v) map.set(hex(c.toString(16)), uni(v));
      }
    }
  }
  return { map, width };
}
function decodeWith(bytes, cmap) {
  // bytes: a binary string (one char per byte)
  if (!cmap) return bytes;
  const step = cmap.width / 2;
  let out = "";
  for (let i = 0; i + step <= bytes.length; i += step) {
    let h = "";
    for (let k = 0; k < step; k++)
      h += bytes
        .charCodeAt(i + k)
        .toString(16)
        .padStart(2, "0");
    out += cmap.map.get(h.toUpperCase()) ?? "";
  }
  return out;
}
const hexBytes = (h) => {
  h = h.replace(/\s+/g, "");
  if (h.length % 2) h += "0";
  let s = "";
  for (let i = 0; i < h.length; i += 2)
    s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return s;
};

// PDF creators such as ReportLab often wrap Flate-compressed page data in
// ASCII85. Decode the filters in PDF order, with bounded decompression.
function ascii85Decode(data) {
  const s = data.toString("latin1").trim().replace(/^<~/, "");
  const bytes = [];
  let group = [];
  const emit = (digits, take = 4) => {
    let value = 0;
    for (const digit of digits) value = value * 85 + digit;
    if (value > 0xffffffff) throw new Error("invalid ASCII85 group");
    const out = [
      (value >>> 24) & 255,
      (value >>> 16) & 255,
      (value >>> 8) & 255,
      value & 255,
    ];
    bytes.push(...out.slice(0, take));
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "~") break;
    if (/\s/.test(ch)) continue;
    if (ch === "z" && !group.length) {
      bytes.push(0, 0, 0, 0);
      continue;
    }
    const n = ch.charCodeAt(0) - 33;
    if (n < 0 || n > 84) throw new Error("invalid ASCII85 character");
    group.push(n);
    if (group.length === 5) {
      emit(group);
      group = [];
    }
    if (bytes.length > 20 * 1024 * 1024)
      throw new Error("ASCII85 stream too large");
  }
  if (group.length > 1)
    emit([...group, ...Array(5 - group.length).fill(84)], group.length - 1);
  return Buffer.from(bytes);
}

// Every object in the file, including ones packed inside object streams (Word and most exporters use these).
function pdfObjects(buf) {
  const raw = buf.toString("latin1");
  const objs = new Map();
  const inflate = (dict, data) => {
    const spec = (dict.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/) ||
      [])[1];
    if (!spec) return data.toString("latin1");
    const filters = spec.match(/\/[A-Za-z0-9]+/g) || [];
    try {
      for (const filter of filters) {
        if (filter === "/ASCII85Decode") data = ascii85Decode(data);
        else if (filter === "/FlateDecode")
          data = inflateSync(data, { maxOutputLength: 20 * 1024 * 1024 });
        else return null;
      }
      return data.toString("latin1");
    } catch {
      return null;
    }
  };
  for (const m of raw.matchAll(/(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g)) {
    const body = m[3];
    const sm = body.match(/^([\s\S]*?)stream\r?\n/);
    if (sm) {
      const start = m.index + m[0].indexOf(body) + sm[0].length;
      const end = raw.indexOf("endstream", start);
      const len = Number(
        (sm[1].match(/\/Length\s+(\d+)\b(?!\s+\d+\s+R)/) || [])[1],
      );
      const data = buf.subarray(
        start,
        Number.isFinite(len) && len > 0 && start + len <= end
          ? start + len
          : end,
      );
      objs.set(m[1], { dict: sm[1], stream: inflate(sm[1], data) });
    } else objs.set(m[1], { dict: body, stream: null });
  }
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.stream) continue;
    const first = Number((o.dict.match(/\/First\s+(\d+)/) || [])[1]);
    const nums = o.stream.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      const from = first + nums[i + 1],
        to = i + 3 < nums.length ? first + nums[i + 3] : o.stream.length;
      if (!objs.has(String(nums[i])))
        objs.set(String(nums[i]), {
          dict: o.stream.slice(from, to),
          stream: null,
        });
    }
  }
  return objs;
}

export function pdfText(buf) {
  const raw = buf.toString("latin1");
  if (!raw.startsWith("%PDF")) throw new Error("not a PDF file");
  if (/\/Encrypt\b/.test(raw))
    throw new Error("this PDF is password-protected");
  const objs = pdfObjects(buf);
  const ref = (s) => (s.match(/^\s*(\d+)\s+\d+\s+R/) || [])[1];
  // Font resource names (/F1 ...) -> that font's ToUnicode map.
  const fonts = new Map();
  for (const o of objs.values()) {
    for (const fm of o.dict.matchAll(
      /\/Font\s*(<<[\s\S]*?>>|\d+\s+\d+\s+R)/g,
    )) {
      let d = fm[1];
      if (!d.startsWith("<<")) d = objs.get(ref(d))?.dict || "";
      for (const f of d.matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
        const font = objs.get(f[2]);
        const tu =
          font && (font.dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/) || [])[1];
        const cm = tu && objs.get(tu)?.stream;
        if (!fonts.has(f[1])) fonts.set(f[1], cm ? parseCMap(cm) : null);
      }
    }
  }
  // Content streams in page order.
  const contents = [];
  for (const o of objs.values()) {
    if (!/\/Type\s*\/Page\b/.test(o.dict)) continue;
    const c = o.dict.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/);
    if (!c) continue;
    for (const r of c[1].matchAll(/(\d+)\s+\d+\s+R/g)) {
      const s = objs.get(r[1])?.stream;
      if (s) contents.push(s);
    }
  }
  const lines = [];
  for (const s of contents) {
    let line = "",
      font = null,
      y = null,
      x = 0;
    const flush = () => {
      if (line.trim()) lines.push(line.replace(/\s+$/, ""));
      line = "";
    };
    // A new line when the baseline moves; moves along the same line rely on the PDF's own spaces (we don't know glyph widths).
    const moveTo = (nx, ny) => {
      if (y === null || Math.abs(ny - y) > 1) flush();
      x = nx;
      y = ny;
    };
    const re =
      /\/([^\s/<>\[\]()]+)\s+[\d.]+\s+Tf|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]|(?:-?[\d.]+\s+){4}(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|T\*|\[((?:\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|-?[\d.]+|\s)*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]*)>\s*Tj|\bBT\b/g;
    for (const t of s.matchAll(re)) {
      if (t[1]) {
        font = fonts.get(t[1]) || null;
        continue;
      }
      if (t[2] != null) {
        moveTo(x + Number(t[2]), (y ?? 0) + Number(t[3]));
        continue;
      }
      if (t[4] != null) {
        moveTo(Number(t[4]), Number(t[5]));
        continue;
      }
      if (t[0] === "T*") {
        flush();
        continue;
      }
      if (t[0] === "BT") {
        x = 0;
        continue;
      }
      if (t[7] != null) {
        line += decodeWith(pdfString(t[7]), font);
        continue;
      }
      if (t[8] != null) {
        line += decodeWith(hexBytes(t[8]), font);
        continue;
      }
      for (const part of t[6].matchAll(
        /\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]*)>|(-?[\d.]+)/g,
      )) {
        if (part[1] != null) line += decodeWith(pdfString(part[1]), font);
        else if (part[2] != null) line += decodeWith(hexBytes(part[2]), font);
        else if (Number(part[3]) < -200 && !/\s$/.test(line)) line += " ";
      }
    }
    flush();
  }
  // A bullet drawn on its own joins the line after it.
  return lines
    .join("\n")
    .replace(/\uf0b7|\u2022/g, "\u2022")
    .replace(/^([\u2022\u25aa\u25e6*-])\s*\n/gm, "$1 ");
}

export function extractText(buf, filename = "") {
  if (buf.length > MAX_FILE) throw new Error("the file is larger than 10 MB");
  const ext = String(filename).toLowerCase().split(".").pop();
  let text;
  if (ext === "docx" || buf.subarray(0, 2).toString() === "PK")
    text = docxText(buf);
  else if (ext === "pdf" || buf.subarray(0, 4).toString() === "%PDF")
    text = pdfText(buf);
  else if (ext === "doc")
    throw new Error(
      "old .doc files can’t be read; save it as .docx or PDF, or paste the text",
    );
  else text = buf.toString("utf8");
  text = text
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const words = (text.match(/[A-Za-z]{2,}/g) || []).length;
  return { text, words, readable: words >= 80 };
}
