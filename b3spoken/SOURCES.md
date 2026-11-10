# Job sources

Every source B3spoken reads, why it's allowed, and the rules we follow for it. A source is only added after its terms and robots rules are checked. Last checked: 2026-11-09.

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
| Oracle Recruiting Cloud | `<tenant>.fa.<region>.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions` | The public job search behind the careers site. Adapted from career-ops (MIT) |
| Phenom | `POST <employer careers host>/widgets` | The public job search behind Phenom careers sites; found from the page, only on the employer's own domain. Adapted from career-ops (MIT) |
| Eightfold | `<host>/api/apply/v2/jobs` or `/api/pcsx/search` | Their robots.txt allows both. Adapted from career-ops (MIT) |
| iCIMS (Jibe) | `<careers host>/api/jobs` | The public job search behind Jibe careers sites. Adapted from career-ops (MIT) |
| Rippling | `ats.rippling.com/api/v2/board/<slug>/jobs` | Public job board. Adapted from career-ops (MIT) |
| SAP SuccessFactors | `<careers host>/tile-search-results/` or `POST /services/recruiting/v1/jobs` | The public job lists behind SuccessFactors careers sites; found from the page. Adapted from career-ops (MIT) |
| Taleo (Enterprise) | `<tenant>.taleo.net/careersection/rest/jobboard/searchjobs` | The same public search the career section page uses. Adapted from career-ops (MIT) |
| Jobvite | `app.jobvite.com/CompanyJobs/Xml.aspx?c=<id>` | Public job feed. Adapted from career-ops (MIT) |
| Google Careers | `www.google.com/about/careers/applications/jobs/results/?location=Canada` | robots.txt forbids the paged results, so we read only the first page of each search, checking robots.txt every time. Adapted from career-ops (MIT) |
| Apple Jobs | `jobs.apple.com/en-ca/search?location=canada-CANC` | A company's own site: robots.txt checked before every request. Adapted from career-ops (MIT) |
| Microsoft | Eightfold (`apply.careers.microsoft.com`) | Microsoft's careers site runs on Eightfold |
| Amazon Jobs | `www.amazon.jobs/en/search.json` (Canada) | A company's own site, so robots.txt is checked before every run. Adapted from career-ops (MIT) |
| PageUp | `careers.pageuppeople.com/<tenant>/<site>/<lang>/listing/` | The public job listing pages (used by many universities and public bodies); robots.txt checked first, 1 second between pages. Adapted from career-ops (MIT) |
| NEOGOV | `www.governmentjobs.com/careers/<agency>` and `www.schooljobs.com` | Public listing pages of government and school-board employers; robots.txt checked first. Adapted from career-ops (MIT) |
| Cornerstone OnDemand | `<tenant>.csod.com/ux/ats/careersite/<id>/home` and its public search | The public career site and the search it uses; no session cookies are replayed. Adapted from career-ops (MIT) |
| Avature | `<tenant>.avature.net/careers/SearchJobs` or the employer's own Avature host | Public job search pages; robots.txt checked first; branded hosts only when the page itself is an Avature site. Adapted from career-ops (MIT) |
| iCIMS (classic portals) | `careers-<tenant>.icims.com/jobs/search` | Public hosted job search pages; robots.txt checked first. Separate from iCIMS Jibe sites. Adapted from career-ops (MIT) |
| JazzHR | `<company>.applytojob.com/apply` | Public job board page; robots.txt checked first. Adapted from career-ops (MIT) |
| Recruitee | `<company>.recruitee.com/api/offers/` | Public careers API, no key. Adapted from career-ops (MIT) |
| Personio | `<company>.jobs.personio.de/xml` (or `.com`) | Public job feed; the careers page only as a fallback, with robots.txt checked. Adapted from career-ops (MIT) |
| UKG Pro (UltiPro) | `recruiting.ultipro.com/<tenant>/JobBoard/<board>` | The public job board and the search it uses; robots.txt checked first. Adapted from career-ops (MIT) |
| Dayforce | not read | Behind a bot check (Cloudflare). We don't get around bot checks, so Dayforce employers are left out |

## Government

| Source | What we read | Notes |
| --- | --- | --- |
| Job Bank (Government of Canada) | `www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed` | Public search feed. robots.txt asks for 5 seconds between requests, which we follow. Job Bank refuses connections from cloud servers, so this runs on each person's own computer with their own search words, newest first, stopping at postings older than 14 days (the longest board choice) |

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
| Dayforce | Its job sites sit behind a bot check (Cloudflare challenge). We don't get around bot checks |
| Meta | Its careers site has no public job feed, only a private API for its own pages |
| Taleo Business Edition | A different product from Taleo Enterprise; not added yet |
| Careers pages showing a bot check | The rendered discovery pass leaves them alone |

## The job pool

The daily scan publishes `pool.json.gz` for B3spoken helpers only. Job-site listings in it stay under their sites' terms and may not be passed on to other job boards or aggregators.

## Finding employers

`src/scan/discover.mjs` reads an employer's careers pages only where robots.txt allows, one request at a time per site with a pause between, and looks for links to the hiring systems above. Name guesses are only kept when the hiring system confirms the company name, or the board has jobs in Canada.
