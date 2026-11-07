# Handoff: picking up Oladapo's job search work

Read this first, then `README.md` on this branch (the B3spoken plan and its build status table). This file is for a new Claude session taking over from the previous one. Oladapo Omoworare (GitHub `Dapper-D`) is the owner and only maintainer.

## Who Oladapo is and what he wants

- Computer Science graduate (Babcock University, Nigeria, 2022), Post-Baccalaureate Diploma in Cybersecurity at Douglas College (expected Dec 2026). Lives in Surrey, BC. On a study permit until December, then a PGWP from January 2027.
- Looking for software, security, IT and AI-adjacent roles. Pay goal **C$100k a year**; floor **C$35 an hour**. On-site or hybrid in **BC**; remote anywhere in **Canada**.
- Favourite projects for resumes: F26_4495_S1_SinYiH (AI threat detection, in progress), Automatic Vulnerability Tool, Under50, Text-to-Image Generator, and this job board. Pick whichever fit the job.
- He is not a developer by trade on this project: explain things in plain words, give exact clicks and commands, and keep messages short. He often works while away and asks for detailed notes at the end of each step.

## His standing rules (never break these)

1. **Never lie.** Resumes and cover letters use only lines from his real resume. Rearrange bullets to show transferable skills; never invent skills, numbers or experience. Say plainly when he lacks a skill.
2. **ATS-safe documents with no metadata** that shows AI was used (no producer/creator fields, no XMP).
3. **Only verified jobs.** If a source can't be verified, leave the job out. Cross-check job-site listings against the employer's own careers site.
4. **Legal scanning only.** Respect robots.txt, never get around bot checks (Cloudflare etc.), never spoof a browser user agent, **never scrape LinkedIn, Indeed or Glassdoor**, honour each job site's terms (attribution, their own Apply links), and don't pass the job pool on to other job boards or aggregators.
5. **Security.** The private release signing key never passes through Claude. It lives only in the GitHub `release` environment secret `RELEASE_SIGNING_KEY` and in his password manager. Claude must never approve Release deployments. Never commit keys, `.env` or `config.json`.
6. **Don't change `main` (the Job Hunt Kit) unless he asks.** New work goes on the `b3spoken` branch. The one exception he approved: `.github/workflows/b3spoken-daily.yml` on main (it checks out the `b3spoken` branch and runs every morning).
7. Commits end with the attribution lines the session gives you; PR bodies end with the Claude Code line.

## The two projects in this repo

### 1. Job Hunt Kit (`main` branch)
The original personal job board: runs on his own computer, scans with career-ops, scores jobs with his AI (Codex, Claude Code or Gemini CLI), makes tailored PDFs, tracks applications, updates itself with signed releases. Setup and use are in `README.md` on `main` (`setup.ps1` on Windows, `bash setup.sh` on Mac/Linux). His local copy is at `C:\Users\olada\Desktop\job board`. Releases are tagged `v*` and published by `.github/workflows/release.yml` after he approves the `release` environment.

To help him set it up again on a new computer: follow `main`'s README Setup section with him step by step. His kit data (config.json, data/, resume library, tracker) stays in his local kit folder; B3spoken can import it (see below).

### 2. B3spoken (`b3spoken` branch, folder `b3spoken/`)
The product that replaces the kit: a desktop helper that opens a job board on localhost, free for now (a paid subscription for the shared scan may come later; what's free vs paid is still to be decided). Zero dependencies, Node 22, `cd b3spoken && npm test` (69 tests). Key parts:
- `src/scan/`: scanners for 21 hiring systems plus Remotive, Remote OK, Jobicy, Himalayas and Job Bank (Job Bank runs on the person's computer, last 3 days). Employer list in `catalog/employers.json` (~315), seeds in `catalog/seeds.json`. Sources and their terms in `SOURCES.md`.
- Daily pool: `.github/workflows/b3spoken-daily.yml` (on main, 10:23 UTC) builds `pool.json.gz` and publishes it to the `job-pool` pre-release.
- `src/helper/`: the app (server on 127.0.0.1 with a per-run token, setup, scoring, tailored one-page PDFs with no metadata, cover letters, interview prep, recruiter contacts, tracker, paste-a-link, documents prepared in advance, one-click Claude Code/Codex install and sign-in, signed self-updates, import from the old kit).
- Source install: root `setup.ps1` / `setup.sh` (B3spoken, not the kit: Node 22 check, shortcut, start), `uninstall.ps1` / `uninstall.sh`. Releases include a signed `B3spoken-source-X.tar.gz`; source installs update themselves from it. A tester once ran the kit's `setup.ps1` and got the old board: that's why this branch's setup scripts were replaced.
- Builds: Windows installer (`scripts/build-exe.mjs`, `installer/b3spoken.iss`), Mac zip, Linux tar.gz. Workflows: `b3spoken.yml` (tests on 3 systems + live check), `b3spoken-windows.yml`, `b3spoken-mac-linux.yml`, `b3spoken-discover*.yml`, `b3spoken-release.yml`.
- **Releases:** tag `b3spoken-vX.Y.Z` (must equal `b3spoken/package.json` version and `src/helper/version.mjs`). Only Oladapo can push these tags (ruleset). The run builds and tests everything, then waits for **his** approval on the `release` environment before signing and publishing. He pushes tags from `C:\Users\olada\b3-release`: `git fetch origin`, `git tag b3spoken-vX.Y.Z origin/b3spoken`, `git push origin b3spoken-vX.Y.Z`. Always remind him to fetch first.
- Published so far: 0.1.0, 0.1.1, 0.1.2. **0.1.3 is ready but not yet tagged**; it's the first with the update button, so it's the last one he installs by hand.

## Where things stand (as of 2026-11-07)

Waiting on Oladapo:
- Tag and approve **b3spoken-v0.1.3**, install it over 0.1.2 (his setup is kept), then test with his real resume: Claude Code/Codex sign-in buttons, Job Bank from his home connection, scores, PDFs.
- Decide: Google Drive sync and phone view (needs a Google Cloud sign-in app in his name), Windows code signing (paid certificate) and Mac notarization (Apple developer account), and which friends test first.
- Earlier to-dos: check domains for the product name (reminder set for Nov 12 on the old account), Gmail sign-in idea (reminder Dec 3).

Not done yet: Metro (classic hosted sapsf.com site), Microsoft rate limits, Dayforce and Meta are left out on purpose (bot check / no public feed), Chrome built-in AI isn't used for tailoring yet, recruiter contacts mostly need his own Hunter.io key.

## Things that stayed on the old Claude account

These don't move with the repo; ask him to bring them over if he wants them:
- The claude.ai Project "Random askss": his resume and cover-letter templates and every tailored version (Affirm, Apple, EA, Fortinet, GitLab, Cohere, etc.), the scoring instructions, and the project instructions above. Re-upload them to a new project.
- The Claude artifact job board and its daily scheduled refresh, and the "B3spoken: plan" doc.
- Scheduled reminders (Nov 12 website/domain decision, Dec 3 Gmail sign-in idea).
- GitHub: connect the new account to GitHub so it can reach `Dapper-D/job-board`.

## How to start

1. Attach the repo, check out `b3spoken`, read this file and `README.md`, run `cd b3spoken && npm test`.
2. Ask him where he is: has he tagged 0.1.3 and tried it? Fix what he reports first.
3. Keep the same style: say what you're about to do, do it, then leave a short note of what worked, what didn't, and what's next.
