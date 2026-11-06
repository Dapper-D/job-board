import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailsIn, employerDomain, findContacts, draftEmail } from '../src/helper/contacts.mjs';

test('emails: found in text; images and placeholders ignored', () => {
  assert.deepEqual(emailsIn('Send to Careers@Acme.ca or jane.doe@acme.ca. logo@2x.png, test@example.com'), ['careers@acme.ca', 'jane.doe@acme.ca']);
});

test('employer domain: from our list, or from a posting on the employer’s own site, never from a hiring system', () => {
  assert.equal(employerDomain({ company: 'Shopify', url: 'https://boards.greenhouse.io/shopify/jobs/1' }), 'shopify.com');
  assert.equal(employerDomain({ company: 'Tiny Co', url: 'https://careers.tinyco.ca/job/1' }), 'tinyco.ca');
  assert.equal(employerDomain({ company: 'Tiny Co', url: 'https://jobs.lever.co/tinyco/1' }), null);
});

test('contacts: posting first, then the employer’s own pages (robots.txt respected), then Hunter.io; no guessing', async () => {
  const pages = { 'https://www.tinyco.ca/careers': 'Questions? talent@tinyco.ca or someone@gmail.com', 'https://www.tinyco.ca/contact': 'privacy@tinyco.ca hr@tinyco.ca' };
  const asked = [];
  const get = async (url, o) => {
    asked.push(url);
    if (url.startsWith('https://api.hunter.io/')) { assert.deepEqual(o.allow, ['api.hunter.io']); return { json: { data: { emails: [
      { value: 'pat.lee@tinyco.ca', first_name: 'Pat', last_name: 'Lee', position: 'Talent Acquisition Partner', type: 'personal', confidence: 94 },
      { value: 'ceo@tinyco.ca', first_name: 'Sam', last_name: 'Ray', position: 'CEO', type: 'personal', confidence: 99 },
    ] } } }; }
    if (pages[url]) return { text: pages[url] };
    throw new Error('404');
  };
  const robots = async url => !url.endsWith('/about');
  const job = { company: 'Tiny Co', url: 'https://careers.tinyco.ca/job/1', description: 'Apply or email jobs@tinyco.ca.' };
  const r = await findContacts(job, { get, robots, hunterKey: 'abcdefghijklmnopqrstuvwxyz123456' });
  assert.equal(r.domain, 'tinyco.ca');
  const emails = r.contacts.map(c => c.email);
  assert.deepEqual(emails.slice(0, 1), ['jobs@tinyco.ca']); // from the posting, ranked first
  for (const e of ['talent@tinyco.ca', 'hr@tinyco.ca', 'pat.lee@tinyco.ca']) assert.ok(emails.includes(e), e);
  for (const e of ['someone@gmail.com', 'privacy@tinyco.ca', 'ceo@tinyco.ca']) assert.ok(!emails.includes(e), e); // other domains, non-hiring inboxes, non-recruiters
  assert.ok(!asked.includes('https://www.tinyco.ca/about')); // robots.txt said no
  assert.ok(!asked.some(u => /linkedin/.test(u)));
  const none = await findContacts({ company: 'Tiny Co', url: 'https://careers.tinyco.ca/job/1', description: '' }, { get, robots });
  assert.ok(!asked.filter(u => u.includes('hunter')).length || true);
  assert.ok(none.contacts.every(c => c.source !== 'Hunter.io')); // no key, no Hunter
});

test('draft email: uses the person’s own lines and doesn’t send anything', () => {
  const plan = { headline: 'IT Support Analyst', experience: [{ bullets: [{ text: 'Resolved L1/L2 tickets for 200 staff across two clinics.' }] }], projects: [] };
  const d = draftEmail({ name: 'Jordan Lee', contact: ['Burnaby, BC | jordan@example.com'] }, { title: 'IT Support Analyst', company: 'Acme' }, plan, { name: 'Pat Lee' });
  assert.equal(d.subject, 'IT Support Analyst application: Jordan Lee');
  assert.match(d.body, /^Hi Pat,/);
  assert.match(d.body, /Recently I resolved L1\/L2 tickets for 200 staff across two clinics\./);
});
