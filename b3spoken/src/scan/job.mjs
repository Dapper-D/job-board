// One shape for every job, whatever source it came from, plus the text and place helpers sources share.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', ccedil: 'ç', ocirc: 'ô', icirc: 'î', ucirc: 'û', Eacute: 'É' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

// HTML to readable plain text: block tags become line breaks, list items become bullets.
export function htmlToText(html) {
  let s = String(html ?? '');
  if (/&lt;\s*\/?\s*[a-z]/i.test(s) && !/<[a-z]/i.test(s)) s = decodeEntities(s); // HTML that arrived escaped
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>|<\/(p|div|ul|ol|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').replace(/\n\n•/g, '\n•').trim();
}

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');
// A posting date more than two days ahead is a closing date or a misread format, not when it was posted.
const FUTURE_SLACK_MS = 2 * 24 * 3600 * 1000;
const iso = v => {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + FUTURE_SLACK_MS) return null;
  return d.toISOString();
};

const money = n => {
  const x = Number(String(n ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(x) && x > 0 ? x.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
};
// Salary as readable text. Some systems send an object (Greenhouse: {min_value, max_value, unit}) rather than text.
export function salaryText(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(salaryText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const lo = money(v.min_value ?? v.min ?? v.minimum ?? v.from), hi = money(v.max_value ?? v.max ?? v.maximum ?? v.to);
    const cur = String(v.unit ?? v.currency ?? v.currency_code ?? '').trim();
    if (lo || hi) return `${cur} ${lo}${lo && hi ? ' – ' : ''}${hi}`.trim();
    const t = v.value ?? v.text ?? v.label;
    return t !== undefined && t !== null && typeof t !== 'object' ? String(t) : '';
  }
  const s = String(v);
  return /^\[object \w+\]$/.test(s) ? '' : s;
}

// When no salary field is sent, many Canadian postings state the range in the text (pay transparency).
const AMT = String.raw`(?:CA?\$|US\$|\$)\s?\d[\d,]*(?:\.\d+)?\s?[kK]?`;
const PAY_RANGE = new RegExp(String.raw`(?:pay|salary|compensation|wage)[^\n]{0,80}\n?[^\n]{0,40}?(${AMT}\s*(?:[-–—]|to)\s*${AMT}(?:\s*(?:CAD|USD|per (?:year|hour|annum)|\/\s?(?:yr|year|hr|hour)|annually|hourly))?)`, 'i');
export function salaryFromText(text) {
  const m = String(text || '').match(PAY_RANGE);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/** Build a normalized job. Returns null when the essentials (title, a real https link) are missing. */
export function makeJob({ source, company, nativeId, title, url, applyUrl, location, remote, postedAt, description, salary, department, employment, via, canada }) {
  title = decodeEntities(String(title ?? '')).replace(/\s+/g, ' ').trim();
  if (!title) return null;
  let link;
  try { link = new URL(url); } catch { return null; }
  if (link.protocol !== 'https:') return null;
  const loc = decodeEntities(String(location ?? '')).replace(/\s+/g, ' ').trim();
  const isRemote = remote === true || /\bremote\b/i.test(loc);
  return {
    id: `${source}:${String(company || '').toLowerCase()}:${nativeId ?? link.pathname}`,
    source,
    company: String(company ?? '').trim(),
    title,
    url: link.href,
    applyUrl: applyUrl || link.href,
    location: loc,
    remote: isRemote,
    canada: canada ?? isCanada(loc, isRemote),
    postedAt: iso(postedAt),
    department: department ? String(department).trim() : '',
    employment: employment ? String(employment).trim() : '',
    salary: (salaryText(salary) || salaryFromText(description)).replace(/\s+/g, ' ').trim(),
    description: clip(description || '', 20000),
    // Jobs from job sites (not the employer's own hiring system) name the site and must link back to it,
    // and still need matching to the employer's own posting before they reach anyone's board.
    ...(via ? { via, employerVerified: false } : { employerVerified: true }),
  };
}

// ---- Is this job in Canada (or open to people in Canada)? ----
const PROVINCES = ['british columbia', 'alberta', 'saskatchewan', 'manitoba', 'ontario', 'quebec', 'québec', 'new brunswick', 'nova scotia', 'prince edward island', 'newfoundland', 'labrador', 'yukon', 'northwest territories', 'nunavut'];
// SK, PE and NL are left out: they are also country codes (Slovakia, Peru, Netherlands).
const CODES = ['BC', 'AB', 'MB', 'ON', 'QC', 'NB', 'NS', 'PEI', 'YT', 'NT', 'NU'];
// Only cities whose names aren't shared with big places elsewhere (no Victoria, Richmond, Cambridge, London...).
const CITIES = ['vancouver', 'burnaby', 'coquitlam', 'new westminster', 'north vancouver', 'abbotsford', 'kelowna', 'nanaimo', 'kamloops', 'prince george', 'calgary', 'edmonton', 'red deer', 'lethbridge', 'regina', 'saskatoon', 'winnipeg', 'toronto', 'mississauga', 'brampton', 'markham', 'vaughan', 'oakville', 'kitchener', 'guelph', 'ottawa', 'kanata', 'barrie', 'oshawa', 'sudbury', 'thunder bay', 'montreal', 'montréal', 'laval', 'gatineau', 'quebec city', 'québec city', 'sherbrooke', 'halifax', 'moncton', 'fredericton', "st. john's", 'charlottetown', 'whitehorse', 'yellowknife', 'iqaluit'];
export const NOT_CANADA = /\b(uk|united kingdom|england|usa|united states|u\.s\.|india|germany|europe|emea|apac|latam|wa|washington)\b/i;

export function isCanada(location, remote = false) {
  const loc = String(location || '');
  if (!loc) return false;
  const low = loc.toLowerCase();
  if (/\bcanada\b|\bcanadian\b|\bcan\b(?= *$)/i.test(loc)) return true;
  if (PROVINCES.some(p => low.includes(p))) return true;
  if (CODES.some(c => new RegExp(`(,|\\(|\\s-)\\s*${c}\\b(?!-)`).test(loc))) return true;
  if (CITIES.some(c => new RegExp(`(^|[^a-z])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(low)) && !NOT_CANADA.test(loc)) return true;
  if (remote && /\b(north america|americas|anywhere|worldwide|global)\b/i.test(loc)) return true;
  return false;
}

// ---- Keys for spotting the same job twice ----
export const companyKey = c => String(c || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(inc|ltd|llc|corp|corporation|co|gmbh|limited|plc)\b\.?/g, '').replace(/[^a-z0-9]/g, '');

// "Senior Data Analyst - Toronto, ON (Hybrid)" and "Senior Data Analyst" are the same job title.
export function titleKey(t) {
  let s = String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const parts = s.split(/\s+[-–—|]\s+/);
  if (parts.length > 1 && parts.slice(1).every(p => isCanada(p, true) || /\b(remote|hybrid|on[- ]?site|in[- ]office|full[- ]?time|part[- ]?time|contract|temporary|permanent)\b/i.test(p))) s = parts[0];
  return s.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(remote|hybrid|on[- ]?site|contract|full[- ]?time|part[- ]?time|canada|usa|us|north america)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// The same posting reached by two links (tracking parameters, trailing slashes, upper/lower case).
export function urlKey(u) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase(); } catch { return String(u || ''); }
}
