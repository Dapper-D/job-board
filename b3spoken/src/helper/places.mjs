// Which province (or provinces) a job's location is in.
// Employers often write only the city ("Burnaby, Canada", "Toronto Office", "SAANICH STORE - 7055"), so the
// province has to come from the city's name as well as from province names and codes.
// A job can list several places ("Vancouver / Toronto"): it is in every province one of them is in.

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const NAMES = {
  BC: ['british columbia'], AB: ['alberta'], SK: ['saskatchewan'], MB: ['manitoba'], ON: ['ontario'], QC: ['quebec'],
  NB: ['new brunswick'], NS: ['nova scotia'], PE: ['prince edward island'], NL: ['newfoundland', 'labrador'],
  YT: ['yukon'], NT: ['northwest territories'], NU: ['nunavut'],
};

// Cities and towns, by province. Small towns named like common words or street names (Trail, Hope, Nelson,
// Duncan, Brooks...) are left out. Names shared with a big place elsewhere (Richmond, Victoria, London, Kingston,
// Windsor, Hamilton, Cambridge, Waterloo, Burlington, Delta, Mission, Hope, Surrey, Langley, Halifax...) are fine here
// because each part of the location that names another country or a US state is skipped (see foreign()).
const CITIES = {
  BC: ['vancouver', 'north vancouver', 'west vancouver', 'burnaby', 'surrey', 'richmond', 'coquitlam', 'port coquitlam', 'port moody',
    'tri-cities', 'new westminster', 'delta', 'tsawwassen', 'ladner', 'langley', 'white rock', 'maple ridge', 'pitt meadows', 'abbotsford',
    'mission', 'chilliwack', 'squamish', 'whistler', 'victoria', 'saanich', 'langford', 'colwood', 'esquimalt', 'nanaimo',
    'parksville', 'courtenay', 'comox', 'campbell river', 'port alberni', 'powell river', 'kelowna', 'west kelowna', 'vernon',
    'penticton', 'kamloops', 'salmon arm', 'cranbrook', 'castlegar', 'prince george', 'prince rupert', 'terrace',
    'kitimat', 'quesnel', 'williams lake', 'fort st. john', 'fort st john', 'dawson creek', 'lower mainland', 'fraser valley',
    'metro vancouver', 'greater vancouver', 'vancouver island', 'okanagan'],
  AB: ['calgary', 'edmonton', 'red deer', 'lethbridge', 'medicine hat', 'grande prairie', 'fort mcmurray', 'airdrie', 'st. albert',
    'st albert', 'sherwood park', 'spruce grove', 'leduc', 'okotoks', 'cochrane', 'canmore', 'banff', 'lloydminster', 'rocky view',
    'camrose', 'wetaskiwin', 'fort saskatchewan', 'nisku', 'chestermere', 'strathmore', 'high river'],
  SK: ['regina', 'saskatoon', 'prince albert', 'moose jaw', 'swift current', 'yorkton', 'north battleford', 'estevan', 'weyburn'],
  MB: ['winnipeg', 'brandon', 'steinbach', 'portage la prairie', 'winkler', 'morden'],
  ON: ['toronto', 'north york', 'scarborough', 'etobicoke', 'mississauga', 'brampton', 'markham', 'vaughan', 'richmond hill', 'aurora',
    'newmarket', 'oakville', 'burlington', 'hamilton', 'st. catharines', 'st catharines', 'niagara falls', 'welland',
    'kitchener', 'waterloo', 'cambridge', 'guelph', 'london', 'windsor', 'sarnia', 'woodstock', 'stratford', 'brantford',
    'ottawa', 'kanata', 'nepean', 'kingston', 'belleville', 'peterborough', 'oshawa', 'whitby', 'ajax', 'pickering',
    'barrie', 'orillia', 'collingwood', 'sudbury', 'greater sudbury', 'north bay', 'sault ste. marie', 'sault ste marie',
    'thunder bay', 'timmins', 'parry sound', 'cornwall', 'brockville', 'owen sound', 'listowel', 'caledon',
    'thornhill', 'stouffville', 'uxbridge', 'gta', 'greater toronto area', 'kawartha lakes', 'huntsville', 'bracebridge'],
  QC: ['montreal', 'laval', 'longueuil', 'gatineau', 'quebec city', 'ville de quebec', 'levis', 'sherbrooke', 'trois-rivieres',
    'trois rivieres', 'saguenay', 'chicoutimi', 'drummondville', 'granby', 'saint-hyacinthe', 'st-hyacinthe', 'saint-jerome',
    'st jerome', 'st-jerome', 'saint-jean-sur-richelieu', 'st jean sur richelieu', 'st-jean-sur-richelieu', 'blainville', 'boisbriand',
    'terrebonne', 'repentigny', 'brossard', 'boucherville', 'varennes', 'pointe-claire', 'pointe claire', 'dorval', 'kirkland',
    'saint-laurent', 'st-laurent', 'st. laurent', 'anjou', 'lachine', 'lasalle', 'verdun', 'mirabel', 'rimouski', 'victoriaville',
    'shawinigan', 'joliette', 'rouyn-noranda', 'val-d\'or', 'sept-iles', 'baie-comeau', 'beloeil', 'chambly', 'candiac', 'la prairie',
    'saint-bruno', 'st bruno', 'st-bruno', 'saint-constant', 'st constant', 'vaudreuil', 'sainte-foy', 'sainte foy', 'ste-foy',
    'bromont', 'magog', 'thetford mines', 'saint-georges', 'riviere-du-loup'],
  NB: ['moncton', 'saint john', 'fredericton', 'dieppe', 'miramichi', 'bathurst', 'edmundston'],
  NS: ['halifax', 'dartmouth', 'truro', 'new glasgow', 'kentville', 'yarmouth'],
  PE: ['charlottetown', 'summerside'],
  NL: ["st. john's", "st john's", 'st johns', 'mount pearl', 'corner brook', 'gander', 'grand falls-windsor', 'labrador city'],
  YT: ['whitehorse'], NT: ['yellowknife', 'inuvik'], NU: ['iqaluit'],
};

// Longest names first, so "north vancouver" is read before "vancouver" and "richmond hill" before "richmond".
const PLACES = Object.entries(CITIES).flatMap(([code, list]) => list.map(name => [fold(name), code]))
  .sort((a, b) => b[0].length - a[0].length);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLACE_RES = PLACES.map(([name, code]) => [new RegExp(`(^|[^a-z])${esc(name)}(?![a-z])`, 'g'), code]);

// Province codes as employers write them: "Burnaby, BC", "Toronto (ON)", "Vancouver - BC", "CA-BC", "(CAN) BC SALMON ARM",
// "Montreal QC 630 boul…". Two-letter codes that are also common words or country codes (ON, PE, NS, NT, NU, SK, NL)
// count only after a comma, bracket, dash or "CA-", never after a bare space.
const CODES = Object.keys(NAMES);
const SAFE_BARE = new Set(['BC', 'AB', 'QC', 'MB', 'NB', 'YT']);
const codeRes = CODES.map(c => [new RegExp(`(?:^|[,(/]|\\s-|\\bCA-|\\(CAN\\)|${SAFE_BARE.has(c) ? '\\s' : '(?!)'})\\s*${c === 'PE' ? 'PEI?' : c}\\b(?!-|')`), c]);

// A part of the location that names another country is about that place: "Ontario, CA, United States" is in California,
// "Abbotsford, Victoria, Australia" isn't in BC. A part with a US state ("Kirkland, WA") is read for Canadian province
// names and codes only, never for city names; "Montréal, Québec, CA, H3A 0A8" has CA as the country, and its province.
const US_STATE = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b(?!-)/;
const COUNTRY = /\b(united states|usa|u\.s\.a?|uk|united kingdom|england|scotland|wales|ireland|australia|new zealand|india|germany|france|philippines|south africa|jamaica|guyana|texas|virginia|california|florida|new york|illinois|washington|massachusetts|ohio|michigan|minnesota|wisconsin|georgia)\b/i;
const NAME_RES = Object.entries(NAMES).flatMap(([code, list]) => list.map(n => [new RegExp(`(^|[^a-z])${n}(?![a-z])`), code]));

/** provincesOf("Burnaby, Canada / Toronto Office") -> Set {'BC', 'ON'} */
export function provincesOf(location) {
  const out = new Set();
  for (const part of String(location || '').split(/\s+\/\s+|\s*[;•|]\s*/)) {
    if (!part.trim() || (COUNTRY.test(part) && !/\bcanada\b/i.test(part))) continue;
    const low0 = fold(part);
    const here = new Set();
    for (const [re, c] of codeRes) if (re.test(part)) here.add(c);
    for (const [re, c] of NAME_RES) if (re.test(low0)) here.add(c);
    here.forEach(c => out.add(c));
    if (!here.size && US_STATE.test(part)) continue;
    let low = ` ${low0} `;
    for (const [re, code] of PLACE_RES) {
      re.lastIndex = 0;
      if (re.test(low)) { out.add(code); re.lastIndex = 0; low = low.replace(re, '$1 '); } // used up: "richmond hill" isn't also "richmond"
    }
  }
  return out;
}

// ---- Private build: the address on each resume and cover letter is the job's own city ----
// Areas that aren't one city ("Lower Mainland", "GTA") can't be an address, so they're passed over.
const REGIONS = new Set(['tri-cities', 'lower mainland', 'fraser valley', 'metro vancouver', 'greater vancouver', 'vancouver island',
  'okanagan', 'rocky view', 'gta', 'greater toronto area', 'kawartha lakes']);
const SMALL = new Set(['la', 'le', 'du', 'de', 'des', 'sur']);
const titleCase = name => name.split(' ').map(w => w.split('-').map((x, i) =>
  i && SMALL.has(x) ? x : /^d'/.test(x) ? "d'" + x.slice(2, 3).toUpperCase() + x.slice(3) : x.charAt(0).toUpperCase() + x.slice(1)).join('-'))
  .map((w, i) => (i && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(' ').replace(/^Val-d'/, "Val-d'");
const CITY_RES = PLACES.filter(([name]) => !REGIONS.has(name)).map(([name, code]) => [new RegExp(`(^|[^a-z])${esc(name)}(?![a-z])`), name, code]);

/** jobCity("Burnaby, Canada / Toronto Office") -> "Burnaby, BC": the first city the posting names, with its province.
 *  '' when the posting names no city in Canada ("Remote", "Canada", "British Columbia"). */
export function jobCity(location) {
  for (const part of String(location || '').split(/\s+\/\s+|\s*[;•|]\s*/)) {
    if (!part.trim() || (COUNTRY.test(part) && !/\bcanada\b/i.test(part))) continue;
    const here = provincesOf(part);
    if (!here.size) continue;
    const low = ` ${fold(part)} `;
    // The city that comes first in this part, longest name winning ("North Vancouver" over "Vancouver").
    let best = null;
    for (const [re, name, code] of CITY_RES) {
      const m = re.exec(low);
      if (m && here.has(code) && (!best || m.index < best.at || (m.index === best.at && name.length > best.name.length))) best = { at: m.index, name, code };
    }
    if (best) return `${titleCase(best.name)}, ${best.code}`;
    // A town that isn't in the list, written "Tofino, BC" or "Tofino, British Columbia".
    const town = /^\s*([A-Za-zÀ-ÿ.'’-]+(?: [A-Za-zÀ-ÿ.'’-]+){0,3})\s*,/.exec(part);
    if (town && here.size === 1 && !provincesOf(town[1]).size && !/\b(remote|canada|hybrid|office|store|various|multiple)\b/i.test(town[1]))
      return `${titleCase(town[1].toLowerCase())}, ${[...here][0]}`;
  }
  return '';
}

/** The resume's contact lines with the person's own city replaced by the job's ("Surrey, BC | 604…" -> "Toronto, ON | 604…").
 *  The piece replaced is the one that names a place in Canada and isn't an email, phone number or web address.
 *  With no such piece, the job's city goes first. A job that names no city leaves the lines as they are. */
export function addressFor(lines, job) {
  const city = jobCity(job?.location);
  if (!city || !lines?.length) return lines || [];
  let done = false;
  const out = lines.map(line => line.split(/(\s+[|•·]\s+)/).map(piece => {
    if (done || /^\s+[|•·]\s+$/.test(piece) || /@|https?:|www\.|\.(com|ca|io|dev|net|org)\b|\d{3}[\s.-]?\d{4}/i.test(piece) || !provincesOf(piece).size) return piece;
    done = true;
    return city;
  }).join(''));
  if (!done) out[0] = `${city} | ${out[0]}`;
  return out;
}
