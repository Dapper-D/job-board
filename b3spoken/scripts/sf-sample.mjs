// Temporary: finds where a few employers' job boards really are, and how EY's search pages.
import { request } from '../src/scan/http.mjs';
const show = async (url, allow, re) => {
  try {
    const r = await request(url, { allow, parse: 'text', accept: 'text/html', retries: 0 });
    const hits = [...new Set((r.text.match(re) || []))].slice(0, 15);
    console.log(`== ${url} -> ${r.status} ${r.text.length}\n${hits.join('\n')}`);
  } catch (e) { console.log(`== ${url} ERR ${e.message} ${e.url || ''}`); }
};
const LINKS = /https?:\/\/[^"'\s<>]*(careers|jobs|workday|taleo|successfactors|sapsf|icims|greenhouse|lever|smartrecruiters|phenom|eightfold|oraclecloud|avature|recruit)[^"'\s<>]*/gi;
await show('https://www.pwc.com/ca/en/careers.html', ['www.pwc.com', '*.pwc.com'], LINKS);
await show('https://jobs-ca.pwc.com/ca/en', ['jobs-ca.pwc.com', '*.pwc.com'], LINKS);
await show('https://www.metro.ca/en/careers', ['www.metro.ca', '*.metro.ca'], LINKS);
await show('https://talent.metro.ca/', ['talent.metro.ca', '*.metro.ca'], LINKS);
await show('https://jobs.alberta.ca/', ['jobs.alberta.ca', '*.alberta.ca'], LINKS);
await show('https://www.alberta.ca/alberta-public-service-jobs', ['www.alberta.ca', '*.alberta.ca'], LINKS);
await show('https://careers.ey.com/search/?q=&locationsearch=Canada&startrow=0', ['careers.ey.com'], /<tr class="data-row|of <b>\d+|results? \d+ . \d+ of \d+[^<]*|jobLocation">[^<]*/gi);
await show('https://careers.ey.com/search/?q=&optionsFacetsDD_country=CA&startrow=0', ['careers.ey.com'], /of <b>\d+|results? \d+ . \d+ of \d+[^<]*|optionsFacetsDD_[a-z]+/gi);
await show('https://careers.ey.com/search/?q=&startrow=700', ['careers.ey.com'], /<tr class="data-row|of <b>\d+|results? \d+ . \d+ of \d+[^<]*/gi);
