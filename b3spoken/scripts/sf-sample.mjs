// Prints what a few SuccessFactors sites send back, to see where they put the job location.
import { request } from '../src/scan/http.mjs';
const hosts = process.argv.slice(2);
for (const h of hosts) {
  const allow = [h, '*.' + h.split('.').slice(-2).join('.')];
  console.log(`\n===== ${h}`);
  try {
    const r = await request(`https://${h}/tile-search-results/?q=&sortColumn=referencedate&sortDirection=desc&startrow=0`, { allow, parse: 'text', accept: 'text/html' });
    const tile = (r.text.match(/<li class="job-tile[\s\S]*?<\/li>/) || [''])[0];
    console.log('TILE', r.status, r.text.length, tile.replace(/\s+/g, ' ').slice(0, 2500));
  } catch (e) { console.log('TILE ERR', e.message); }
  try {
    const r = await request(`https://${h}/services/recruiting/v1/jobs`, { allow, parse: 'json', method: 'POST', json: { keywords: '', locale: 'en_US', location: '', pageNumber: 0, sortBy: 'date' } });
    console.log('CSB', JSON.stringify(r.json?.jobSearchResult?.[0]?.response || r.json).slice(0, 2500));
  } catch (e) { console.log('CSB ERR', e.message); }
  try {
    const r = await request(`https://${h}/search/`, { allow, parse: 'text', accept: 'text/html' });
    const row = (r.text.match(/<tr class="data-row[\s\S]*?<\/tr>/) || [''])[0];
    console.log('SEARCH', r.status, row.replace(/\s+/g, ' ').slice(0, 2500));
  } catch (e) { console.log('SEARCH ERR', e.message); }
}
