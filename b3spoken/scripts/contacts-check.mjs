// Live look at recruiter contacts for a few real employers (information only; never fails the build).
import { findContacts } from '../src/helper/contacts.mjs';
const jobs = [
  { company: 'Shopify', url: 'https://www.shopify.com/careers', description: '' },
  { company: 'Hootsuite', url: 'https://careers.hootsuite.com/', description: '' },
  { company: 'Coast Capital Savings', url: 'https://careers.coastcapitalsavings.com/', description: '' },
  { company: 'City of Vancouver', url: 'https://jobs.vancouver.ca/', description: '' },
];
for (const j of jobs) {
  const r = await findContacts(j, { log: () => {} }).catch(e => ({ error: e.message }));
  console.log(`${j.company}: domain ${r.domain || '-'}; ${r.error || r.contacts.map(c => `${c.email} (${c.source})`).join(', ') || 'no published hiring emails'}`);
}
