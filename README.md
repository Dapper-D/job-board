# B3spoken (work in progress)

> This is the `b3spoken` branch, where B3spoken is being built and tested. The current **Job Hunt Kit** lives on the [`main` branch](https://github.com/Dapper-D/job-board/tree/main) and keeps working while this is built. B3spoken is a placeholder name.

B3spoken is a free, open-source job search tool. It finds verified jobs every day, matches them to each person's resume and writes them tailored resumes and cover letters using the AI they already pay for. It is a ground-up rebuild of the Job Hunt Kit with no career-ops code in its architecture.

What's built so far is in [`b3spoken/`](b3spoken/); see [Build status](#build-status).

## Decisions already made

| Area | Decision |
| --- | --- |
| Shape | A desktop helper that everyone installs; after setup it opens B3spoken on their own computer at localhost. A simple free download page (GitHub Pages) is the only public site |
| Accounts | None by default; data stays on the person's computer |
| Optional sign-in | Google, to sync to their own Google Drive and get a view-only phone view |
| Computers | Windows, Mac and Linux; only the Windows installer is signed at first |
| AI | ChatGPT (Codex) and Claude (Claude Code) both fully supported; Chrome built-in AI as the free fallback; rule-based tailoring for people with neither |
| Daily scan | Runs once on shared servers (GitHub Actions in the public repo), not on each computer |
| Privacy | The helper sends only derived keywords, never the resume |
| Launch country | Canada |
| Fields | All fields, personalised from each resume and the onboarding questions |
| Job sources | Employer hiring systems, government job banks, remote feeds and pasted links; no scraping of LinkedIn, Indeed or Glassdoor |
| Price | Free for now, with room for a monthly subscription later |
| Code | Public; anonymous usage counts only |
| Hosting | No paid hosting yet; Vercel's free plan at most |
| Testing | On this branch, with a small group of friends (mostly Windows) |
| Old kit | Keeps working; automatic migration only after a lot of testing |

## How it works, from download to daily use

A new user is set up in about 15 minutes, then gets a fresh list of matched jobs with ready-made documents every morning.

1. **Download.** From the download page (GitHub Releases at first). Windows gets a signed installer; Mac and Linux show the usual "unidentified developer" warning with steps to allow it.
2. **Install.** One installer, no terminal. It sets up the helper, adds a B3spoken shortcut and starts it in the background.
3. **Open B3spoken.** Setup ends by opening B3spoken in their browser at a localhost address, served by the helper on their own computer. The shortcut opens it again any time; nothing is hosted online.
4. **Connect an AI.**
   - ChatGPT: the helper installs Codex and opens the ChatGPT sign-in.
   - Claude: the helper installs Claude Code and opens the Claude sign-in.
   - Neither: Chrome's built-in AI if their computer can run it, otherwise rule-based tailoring with no AI.
5. **Upload a resume.** The AI builds a resume library: every job, project and bullet, each with an ID. Lines it isn't sure about are flagged and never used until the user checks them.
6. **Answer the questions.** Target roles (with a check if a target is far from the resume), pay floor and goal, on-site and remote locations, work authorization, start date, skills they don't have and industries to avoid.
7. **Pick extra roles.** B3spoken suggests related and niche roles, each with a one-line reason; each is a toggle.
8. **Optional: sign in with Google.** Saves copies to their own Google Drive and turns on a view-only phone view.
9. **Every morning.** The shared scan has already collected Canada's new postings. The helper sends only keywords, gets back the matching jobs, then on their computer verifies each posting, scores it and writes a tailored resume and cover letter as PDFs.
10. **Use the board.** New jobs, scores and reasons, the PDFs and an Apply link straight to the employer's own posting. Track status, add notes and paste any job link to have it checked and tailored.
11. **Updates.** The helper installs new signed versions by itself; a bad or unsigned update is refused.

## Architecture

The heavy daily scan runs once for everyone on free GitHub servers; everything personal runs on each user's own computer.

```mermaid
flowchart LR
  subgraph Servers["Shared servers · GitHub Actions, once a day"]
    S[Job sources<br/>hiring systems, Job Bank, remote feeds] --> D[Daily scan<br/>verifies postings, builds Canada's job pool] --> M[Match service<br/>filters by keywords, keeps no IPs]
  end
  subgraph PC["The user's computer"]
    P[B3spoken page<br/>localhost] <--> H[Desktop helper<br/>holds the resume; scores, tailors, saves PDFs] <--> A[Their AI<br/>Codex, Claude Code, Chrome AI or rules]
  end
  H <-- "keywords up · matching jobs down" --> M
  R[GitHub Releases<br/>signed updates] --> H
  H --> G[Google Drive, optional] --> F[Phone view, read-only]
```

## AI

The AI always runs on the user's own computer, signed in with their own account, so B3spoken never holds anyone's AI login or pays for their usage.

| AI | How they connect | Who it's for | Rules and limits |
| --- | --- | --- | --- |
| ChatGPT | The helper installs Codex; they sign in with ChatGPT | Plus, Pro or Business plans | OpenAI allows open-source, local apps to use plan usage; a hosted website would need OpenAI's approval |
| Claude | The helper installs Claude Code; they sign in with Claude | Pro or Max plans | Claude Code itself is Anthropic's own tool; B3spoken runs it as-is, the way career-ops does. Using consumer sign-ins inside third-party apps is restricted, so this is documented for users as a grey area |
| Chrome built-in AI | Nothing to sign in to | Anyone with a strong enough computer, including Gemini users | Desktop Chrome only; more than 4 GB graphics memory or 16 GB RAM; about 22 GB free disk; short inputs; works only while the page is open |
| No AI | Nothing | Everyone else | Rule-based tailoring: picks and orders their own bullets by keyword match |

How the AI is locked down: Codex runs read-only and ignores the user's own config; Claude Code runs with no tools, no MCP servers and no slash commands; the AI only picks bullet IDs from the resume library and never writes claims of its own.

## Onboarding and role matching

The resume decides what B3spoken searches for; the user's answers can widen or redirect it but never add claims.

1. Upload the resume (PDF or Word). The AI builds the library and lists the roles the resume supports.
2. The user types the roles they want.
3. If a target is drastically different from what the resume supports, B3spoken says so and asks: use the suggested roles, or keep theirs (then it expands from their role).
4. Pay floor and goal, locations, work authorization, start date, skills they don't have, industries to avoid.
5. Related and niche roles, each with a one-line reason, each a toggle.
6. The profile becomes the search keywords sent to the daily scan. The resume stays on their computer.

## Features carried over from the kit

| Feature | What it does |
| --- | --- |
| Verified jobs only | Each posting is checked on the employer's own careers site or hiring system; anything unverifiable is left off |
| Scam and trap checks | Flags fake postings, payment requests and hidden instructions aimed at AI tools |
| Scoring | Fit score with reasons; jobs scored Skip never appear |
| Pay and location filters | The user's floor and goal, on-site area and remote rule |
| Freshness | Pasted links must be posted within the last 72 hours |
| Tailored resume | One-page PDF, real bullets, ATS-safe, no AI metadata, job title in the summary, bullets reordered to show transferable skills |
| Cover letter | PDF, honest about gaps, never claims missing skills |
| Tracker | Status, notes, follow-up reminders and interview prep per job |
| Paste a link | Matches it to the employer's own posting, then verifies and tailors it |
| Health check | Plain PASS/WARN/FAIL list with a fix for each problem |
| Signed updates | Checked against the release key before anything is installed |

**New after the core build: recruiter contacts for cold emails**

- Pull recruiter or HR emails already published in the posting or on the employer's own careers, contact or team pages.
- Optional Hunter.io lookup with the user's own free key, showing its confidence for each address.
- Draft a short cold email from the tailored resume; the user reviews it and sends it from their own email. Nothing is sent automatically.
- Never scrape LinkedIn and never guess-and-test addresses against mail servers. Only published business emails, used for that one job.

## Privacy and security

No resume, AI login or personal document leaves the user's computer unless they turn on Google Drive sync, and then it goes only to their own Drive.

| Data | Goes to | Kept for |
| --- | --- | --- |
| Search keywords (titles, skills, locations) | B3spoken match service | Deleted right after the match; no IP addresses stored |
| Anonymous usage counts | B3spoken | Totals only, no IDs |
| Copies of PDFs and the tracker (opt-in) | The user's own Google Drive | As long as they keep them |
| AI prompts | Their own ChatGPT or Claude account | Under that vendor's terms |

- The helper listens only on the user's own computer, with a secret token, session cookie, Host check and CSRF header.
- Job pages are fetched over HTTPS only, to hosts each source declares, with private network addresses blocked.
- Releases are signed with Ed25519 and checked before unpacking.
- Admins sign in with Google plus two-factor; no shared master password; one logged, deletable break-glass login.
- The release signing key lives only in GitHub's protected `release` environment and the owner's password manager. A maintainer approves each release.

## Code ownership, credits and job sources

B3spoken's architecture and main code are written from scratch; career-ops is not installed, pinned or run.

| Part | Where the code comes from |
| --- | --- |
| Helper, board, tailoring, PDFs, updater | Our own |
| Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable scanners | Our own, using each system's public job feed |
| Job Bank Canada (and USAJOBS later) | Our own, using their public data |
| Niche hiring systems | Copied from career-ops under its MIT licence, with its notice kept in `NOTICES.md` |
| Employer list | A large starter list plus automatic discovery |

- Credit for career-ops goes in `NOTICES.md` only. Its name is never used in our product name, domain, screens or "Powered by" lines.
- LinkedIn, Indeed and Glassdoor are never scraped; a pasted link from them is matched to the employer's own posting.

**Getting the most jobs legally**

- Use every source that publishes a public job feed or allows automated access.
- Before a source is added, check its terms of use and robots rules, and record the result in `SOURCES.md`.
- Track as many Canadian employers as possible: a large starter list plus automatic discovery.
- Cross-check every job against the employer's own careers site; anything that can't be confirmed is dropped.

## Hosting, cost and a future subscription

| Piece | Where it runs | Cost |
| --- | --- | --- |
| Daily scan and job pool | GitHub Actions in the public repo | Free |
| Match service | A GitHub-hosted job list the helper filters locally at first; a small Vercel function later if needed | Free |
| B3spoken page | Served by the helper at localhost; a static GitHub Pages download page | Free |
| Downloads and updates | GitHub Releases | Free |
| AI | The user's own ChatGPT or Claude plan | Paid by the user |
| Sync | The user's own Google Drive | Free for them |

A future subscription charges for the service, not the app: the shared scan and matching run on our side. What is free and what is paid will be decided later.

## Testing, branch, release and migration

1. Build in small pieces on this branch, each with tests on Windows, Mac and Linux.
2. A small group of friends installs pre-release builds; both ChatGPT and Claude users test every step.
3. Pre-releases (for example `b3spoken-0.1.0`) are signed like the kit and approved by a maintainer.
4. Merge to `main` only when it's stable.
5. Migrate the old kit last, automatically, after a lot of testing.

## Build status

| Piece | Status |
| --- | --- |
| Safe HTTP client (HTTPS only, per-source host list, private addresses blocked, polite delays, retries) | Done, tested |
| Scanners: Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Job Bank | Done, tested offline; live check runs in GitHub Actions |
| Canada filter and duplicate removal | Done, tested |
| Large employer list and automatic discovery | Next |
| Remote feeds and niche hiring systems | Next |
| Helper, localhost board, onboarding, AI, tailoring | After that |

Run it yourself (Node 22 or newer):

```
cd b3spoken
npm test            # offline tests
npm run live-check  # calls every source for real
npm run scan        # writes out/pool.json and out/report.json
```

## Open questions

- Final product name and domain
- Verify the Gemini CLI personal sign-in shutdown with Google's own announcement
- Which friends test first, and on which computers
- Mac code-signing later (needs a paid Apple developer account)
- What a future subscription includes and costs
