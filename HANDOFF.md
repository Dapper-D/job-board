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
The product that replaces the kit: a desktop helper that opens a job board on localhost, free for now (a paid subscription for the shared scan may come later; what's free vs paid is still to be decided). Zero dependencies, Node 22, `cd b3spoken && npm test` (70 tests). Key parts:
- `src/scan/`: scanners for 21 hiring systems plus Remotive, Remote OK, Jobicy, Himalayas and Job Bank (Job Bank runs on the person's computer, last 3 days). Employer list in `catalog/employers.json` (~315), seeds in `catalog/seeds.json`. Sources and their terms in `SOURCES.md`.
- Daily pool: `.github/workflows/b3spoken-daily.yml` (on main, 10:23 UTC) builds `pool.json.gz` and publishes it to the `job-pool` pre-release.
- `src/helper/`: the app (server on 127.0.0.1 with a per-run token, setup, scoring, tailored one-page PDFs with no metadata, cover letters, interview prep, recruiter contacts, tracker, paste-a-link, documents prepared in advance, one-click Claude Code/Codex install and sign-in, signed self-updates, import from the old kit).
- Source install: root `setup.ps1` / `setup.sh` (B3spoken, not the kit: Node 22 check, shortcut, start), `uninstall.ps1` / `uninstall.sh`. Releases include a signed `B3spoken-source-X.tar.gz`; source installs update themselves from it. A tester once ran the kit's `setup.ps1` and got the old board: that's why this branch's setup scripts were replaced.
- Builds: Windows installer (`scripts/build-exe.mjs`, `installer/b3spoken.iss`), Mac zip, Linux tar.gz. Workflows: `b3spoken.yml` (tests on 3 systems + live check), `b3spoken-windows.yml`, `b3spoken-mac-linux.yml`, `b3spoken-discover*.yml`, `b3spoken-release.yml`.
- **Releases:** tag `b3spoken-vX.Y.Z` (must equal `b3spoken/package.json` version and `src/helper/version.mjs`). Only Oladapo can push these tags (ruleset). The run builds and tests everything, then waits for **his** approval on the `release` environment before signing and publishing. He pushes tags from `C:\Users\olada\b3-release`: `git fetch origin`, `git tag b3spoken-vX.Y.Z origin/b3spoken`, `git push origin b3spoken-vX.Y.Z`. Always remind him to fetch first.
- Published so far: 0.1.0, 0.1.1, 0.1.2. **0.1.3 is ready but not yet tagged**; it's the first with the update button, so it's the last one he installs by hand.

## Update (2026-11-07, afternoon Pacific)

- 0.1.3 is tagged, but it was cut before the AI-tailoring commit (ee6a46a), so installed copies still only reorder lines.
- **0.1.4 is ready on `b3spoken` and not yet tagged.** It carries:
  - AI tailoring
  - the resume-import fix: numbered master resumes, full multi-page PDFs, no empty libraries or header-only PDFs, a strict one-page fit, and cache fingerprints
  - work history listed newest first
- AI tailoring was tested end to end with Claude Code and his real resume (Affirm SWE I): the AI's draft passed the honesty check, and the resume and letter each came out on one page.
- To release, he runs `git fetch origin` and `git tag b3spoken-v0.1.4 origin/b3spoken`, pushes the tag, then approves the release environment. 0.1.3 installs then update themselves.

Also done, in 0.1.4:
- Carlito is embedded as a subset (about 50 KB per PDF). PDF details carry only the title and the person's name as author.
- Project addresses in headings are clickable.
- AI traps are flagged on the board and blocked in every AI draft. As he asked, "don't use AI" requests are ignored.
- Writing help: LinkedIn note, interview debrief, negotiation plan and offer review (`src/helper/tailor/drafts.mjs`, `POST /api/jobs/<id>/draft`).
- All of it was tested in a real browser with Claude Code. There are 83 tests.

Still to do:
- The interview story bank.
- A follow-up email or thank-you note in Writing help, if he wants them; the recruiter-contacts draft covers the first email.

## Where things stand (as of 2026-11-07, 11:00 Pacific)

Waiting on Oladapo:
- Tag and approve **b3spoken-v0.1.3** (it now also carries the source package and the new setup scripts), install it over 0.1.2 (his setup is kept), then test with his real resume: Claude Code/Codex sign-in buttons, Job Bank from his home connection, scores, PDFs.
- Tell us whether the kit's `setup.ps1` runs with the Unblock/Bypass steps, and whether his tester now gets B3spoken.
- Decide: Google Drive sync and phone view (needs a Google Cloud sign-in app in his name), Windows code signing (paid certificate) and Mac notarization (Apple developer account), and which friends test first.
- Earlier to-dos: check domains for the product name (reminder set for Nov 12 on the old account), Gmail sign-in idea (reminder Dec 3).

Not done yet: Metro (classic hosted sapsf.com site), Microsoft rate limits, Dayforce and Meta are left out on purpose (bot check / no public feed), Chrome built-in AI isn't used for tailoring yet, recruiter contacts mostly need his own Hunter.io key.

## Latest conversation (2026-11-07), in order

1. **Handoff.** He's moving to another Claude account. A word-for-word transcript export wasn't possible, so this file was written instead and covers both projects.
2. **Kit `setup.ps1` closed straight away on his computer** (a window flashed and shut, with no logs). Cause: Windows blocked the script before it ran (downloaded-file block or script policy). Setup itself always waits with "Press Enter to close", and its `logs` folder is only created once `app/setup.mjs` starts. Fix given: open PowerShell in the kit folder (type `powershell` in File Explorer's address bar), run `Get-ChildItem -Recurse | Unblock-File`, then `powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1`. Any error then stays on screen. He wants to test **both** the kit and B3spoken; he hasn't said yet whether that worked.
3. **A tester saw the old board after "installing B3spoken" and running `setup.ps1`.** Cause: the `b3spoken` branch still had the kit's root `setup.ps1` and `setup.sh`, inherited from `main`. Testers want to see every file that goes onto their computer, so a source install has to work and shipping only an .exe isn't enough. Fixed on `b3spoken` only:
   - root `setup.ps1` / `setup.sh` now install B3spoken from source: Node 22 check, a Start menu shortcut running `node b3spoken/src/helper/main.mjs`, then start the app;
   - `uninstall.ps1` / `uninstall.sh` were added, and `update-kit.ps1` / `update-kit.sh` removed;
   - releases now include a signed `B3spoken-source-X.tar.gz`, and source installs update themselves from it;
   - the README opens with install steps;
   - Windows CI tests `setup.ps1` and `uninstall.ps1`.

   The tester should run `node app\uninstall.mjs` in his old download if he wants the kit's shortcut and daily refresh gone, then re-download the branch, or 0.1.3's source package, and run the new `setup.ps1`.
4. **"B3spoken releases are missing."** They aren't: 0.1.0 to 0.1.2 are pre-releases. The repo's Releases sidebar only shows the release GitHub marks Latest (kit v2.2.0). Always give testers the direct link: https://github.com/Dapper-D/job-board/releases?q=b3spoken&expanded=true. Don't mark a B3spoken release as Latest, because the kit's own updater may rely on Latest.
5. **He said not to touch `main`.** Everything above is on `b3spoken`. An optional line in main's README pointing testers to B3spoken was suggested but **not** made; only add it if he asks.
6. **Ideas still waiting on his yes:** B3spoken noticing a running old kit (port 4777) and offering to import it and switch it off.

## Things that stayed on the old Claude account

These don't move with the repo; ask him to bring them over if he wants them:
- The claude.ai Project "Random askss": his resume and cover-letter templates and every tailored version (Affirm, Apple, EA, Fortinet, GitLab, Cohere, etc.), the scoring instructions, and the project instructions above. Re-upload them to a new project.
- The Claude artifact job board and its daily scheduled refresh, and the "B3spoken: plan" doc.
- Scheduled reminders (Nov 12 website/domain decision, Dec 3 Gmail sign-in idea).
- GitHub: connect the new account to GitHub so it can reach `Dapper-D/job-board`.

## How to start

1. Attach the repo, check out `b3spoken`, read this file and `README.md`, run `cd b3spoken && npm test`.
2. Ask him where he is: has he tagged 0.1.3 and tried it? Did the kit setup and the tester's B3spoken install work? Fix what he reports first.
3. Keep the same style: say what you're about to do, do it, then leave a short note of what worked, what didn't, and what's next.
