# Security

The Job Hunt Kit handles personal data (your resume, applications and job search) and runs every day on your computer, so it's built to be safe by default. This page explains how, and how to report a problem.

## Reporting a problem

Please **don't** open a public issue for a security problem. Use GitHub's **Security → Report a vulnerability** (private advisory) on this repository, or contact the maintainer privately through their GitHub profile. Include steps to reproduce. You'll get a reply as soon as possible, and credit if you'd like it.

## How the kit protects you

**Your data stays on your computer**
- Everything is stored in the kit folder. The board server listens only on `127.0.0.1`, never on your network.
- On Mac and Linux, `config.json`, `.env`, `data/`, `documents/` and `logs/` are made readable only by you. On Windows, `config.json` and `.env` are limited to your account.

**The board can only be used by you**
- The board only opens from the **Job Board** shortcut. The shortcut gets a one-time launch code (valid 2 minutes, usable once). That code sets a private session cookie in your browser (HttpOnly, SameSite=Strict). The page never contains the secret token.
- Every request must come from the board itself: the right `Host` (stops DNS-rebinding), a same-origin check and a custom header. Other websites, including other apps on another `localhost` port, can't read or change anything.
- A strict Content Security Policy (a fresh nonce on every page load, no inline-script loophole, no outside connections) means text from a job posting can't run as code. All posting text is shown as plain text, and links open only if they're `https`.
- The page uses no outside resources: fonts and scripts are served by the kit itself.

**Job postings can't attack you or your network**
- Postings are fetched over `https` only, on every redirect. Links to private, local or cloud-metadata addresses are refused, and the connection is pinned to the address that was checked. Downloads are size- and time-limited.
- Posting text is treated as data. Your AI tool runs with no tools at all:
  - **Claude Code:** no tools and no MCP servers; web search only for "Research company".
  - **Codex:** read-only sandbox, ignoring your personal config and rules.
  - **Gemini CLI:** an admin-level policy blocks every tool, except Google search for research.
  So a posting can't make the AI read your files, run commands or send data to a website.
- Hidden instructions aimed at AI tools ("AI traps") are detected and flagged. Their phrases are kept out of anything written for you.

**Updates are signed**
- Updates come only from this repository's **Releases**. Each release archive is signed with the maintainer's Ed25519 key, and the matching public key is built into every kit (`app/kit.json`).
- The signature is checked **before** anything is unpacked or run. A hijacked GitHub account, a tampered download, a wrong version or an archive with links or unsafe paths is refused.
- The new version backs up the old files, and puts them back automatically if anything fails. Your data is never touched.

**Supply chain**
- Board packages install with `npm ci` from the committed `package-lock.json`, with exact versions, hash checks and no install scripts.
- career-ops is installed at a tested commit pinned in `app/kit.json`, never "whatever is on main today". Updates only move it forward to the next tested commit.
- The AI tools are the vendors' official npm packages, installed into the kit's own `tools` folder.

## What it can't protect against

- Anything already running as your user account (malware) can read your files. That's true of any app.
- The AI vendors (OpenAI, Anthropic, Google) receive the text sent to them, under your plan's terms.
- Always read a tailored resume or cover letter before sending it.

## For the maintainer

- The release signing key lives in your home folder (`~/.job-hunt-kit/release-signing-key.pem`), never in the repo. Back it up offline.
- If the key is ever exposed, make a new one (`node app/release.mjs keygen --force`), publish a release, and tell users to run `update-kit.ps1` / `update-kit.sh` once.
- Turn on two-factor authentication for your GitHub account, and branch protection for `main`.
