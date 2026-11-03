# Contributing

Thanks for helping. The Job Hunt Kit runs on people's own computers with their personal data, so a few rules matter more than usual.

## How changes get in

1. Fork the repo and make a branch.
2. Make your change, and run the tests (below).
3. Open a pull request that explains what changed and why. The **Tests** check runs on Windows, Mac and Linux, and must pass.
4. A maintainer reviews it. Changes to sensitive files (see `.github/CODEOWNERS`) need the maintainer's review.
5. Merged changes reach users only when a maintainer publishes a release. GitHub builds, tests and signs it automatically, and a maintainer has to approve that.

You never need a signing key, and you can't publish updates directly.

## Running it locally

```bash
cd app
npm ci --ignore-scripts
node tests/run-tests.mjs      # end-to-end tests with a stand-in AI and a local test site; no internet or AI needed
```

To try the board, run setup in a separate copy of the kit (`setup.ps1` or `bash setup.sh`). You can pick the stand-in AI by running with the environment variable `KIT_AI_PROVIDER=mock`.

## Rules for code

- **Honesty in resumes is the product.** Resume lines only ever come from the user's resume library (`data/resume-lib.json`). The AI picks and orders them; it never writes new experience. Don't loosen that.
- **Posting text is data, never instructions.** Anything from a job page, email or queue note goes into prompts as data. Never give the AI tools that read files, run commands or fetch URLs a posting chose (see `app/lib/ai.mjs`).
- **Show untrusted text as text.** In the board, use `textContent`/`el()`, never `innerHTML`. Links must be checked with `https()` first. Every `<script>` gets the page's nonce automatically; don't add inline event handlers (`onclick=`).
- **Fetch pages only through `app/lib/safefetch.mjs`** (https, public addresses only, size and time limits).
- **No secrets in the repo.** Never commit keys, tokens, `.env`, `config.json` or anything from `data/`. Release signing happens on GitHub only.
- **Dependencies:** add them only if really needed, with exact versions, and commit `package-lock.json`. The kit must keep working with `npm ci --ignore-scripts`.
- **Cross-platform:** anything touching files, processes or schedules must work on Windows, Mac and Linux (`app/lib/platform.mjs`).
- **Plain-English messages:** anything a user reads should say what happened and what to do next, without jargon.

## Reporting security problems

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
