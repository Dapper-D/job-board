# Job sources

Every source B3spoken reads, why it's allowed, and the rules we follow for it. A source is only added after its terms and robots rules are checked. Last checked: 2026-11-05.

## Employer hiring systems (the employer's own postings)

These are the public job feeds employers publish through their hiring software, meant to be read by other sites. A job from one of these is the employer's own posting, so it already counts as checked against the employer.

| Source | What we read | Notes |
| --- | --- | --- |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/<board>/jobs` | Public Job Board API, no key |
| Lever | `api.lever.co/v0/postings/<site>` | Public Postings API, no key |
| Ashby | `api.ashbyhq.com/posting-api/job-board/<board>` | Public Job Posting API, no key |
| Workday | `<tenant>.wd<N>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs` | The public career site's own job list; we use its Canada filter when it has one; 1 second between requests |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/<company>/postings?country=ca` | Public Posting API, no key |
| Workable | `apply.workable.com/api/v1/widget/accounts/<account>` | Public job widget API, no key |
| BambooHR | `<tenant>.bamboohr.com/careers/list` | Public careers list. Adapted from career-ops (MIT) |
| Breezy HR | `<tenant>.breezy.hr/json` | Public job list. Adapted from career-ops (MIT) |
| Pinpoint | `<company>.pinpointhq.com/postings.json` | Public postings. Adapted from career-ops (MIT) |
| Teamtailor | `<company>.teamtailor.com/jobs.rss` | Public job feed. Adapted from career-ops (MIT) |

## Government

| Source | What we read | Notes |
| --- | --- | --- |
| Job Bank (Government of Canada) | `www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed` | Public search feed. robots.txt asks for 5 seconds between requests, which we follow. Job Bank refuses connections from cloud servers, so this runs on each person's own computer with their own search words, newest first, stopping at postings older than 3 days |

## Job sites (remote jobs)

Jobs from these sites name the site and link back to it, as their terms require; the Apply link stays the site's own. The daily scan looks for the same job on the employer's own hiring system: if found, the job keeps `employerUrl` (the employer's posting) and `employerVerified: true`; if not, it is dropped from the pool.

| Source | Terms we follow | Notes |
| --- | --- | --- |
| [Remotive](https://github.com/remotive-com/remote-jobs-api) | Link back to the Remotive job URL and name Remotive as the source; at most 4 requests a day; don't submit their jobs to other job sites; don't use them to collect sign-ups | Jobs arrive 24 hours late. Commercial use goes through their paid API: revisit before any subscription |
| [Remote OK](https://remoteok.com/api) | Link back to the job's Remote OK URL as a normal (followed) link and name Remote OK as the source; don't use their logo | The feed has the newest ~100 jobs |
| [Himalayas](https://himalayas.app/terms) | Clauses 30A and 113 of their terms, and their [API docs](https://github.com/Himalayas-App/remote-jobs-api): use in our own apps is allowed without asking; credit Himalayas with a visible link; every Apply uses the API's `applicationLink`; never pass their jobs on to other job boards or aggregators; cache and drop expired jobs; stay within rate limits | Data refreshes daily, so we read it once a day. Clause 93 forbids selling their data without consent: revisit before any subscription |
| [Jobicy](https://github.com/Jobicy/remote-jobs-api) | Keep Jobicy as the named source and keep the Jobicy job URL; never present listings as our own; poll at most once an hour | We ask only for jobs open to Canada and "anywhere" |

## Checked and not used

| Source | Why not |
| --- | --- |
| LinkedIn, Indeed, Glassdoor | Their terms forbid automated collection. A pasted link from them is matched to the employer's own posting instead |
| We Work Remotely | Its [API terms](https://weworkremotely.com/api-terms-and-guidelines) forbid copying, saving or storing their data, and building anything that competes with them |
| Working Nomads | No official terms or API documentation found |

## The job pool

The daily scan publishes `pool.json.gz` for B3spoken helpers only. Job-site listings in it stay under their sites' terms and may not be passed on to other job boards or aggregators.

## Finding employers

`src/scan/discover.mjs` reads an employer's careers pages only where robots.txt allows, one request at a time per site with a pause between, and looks for links to the hiring systems above. Name guesses are only kept when the hiring system confirms the company name, or the board has jobs in Canada.
