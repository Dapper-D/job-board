# Apply assistant, slice 1 (one-page boards) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking **Apply** on a job card from a one-page board opens the application in B3spoken's own Chrome, fills every field it can from the person's stored answers, attaches the tailored resume and cover letter, lists what it filled, and stops — the person reads and submits.

**Architecture:** A new `src/helper/apply/` tree. Pure modules (guard, answer store, field matching, answer bank, adapters) with no I/O, driven by one session state machine that talks to Chrome over an allowlisted DevTools transport. State lives in a closure in `createApp` and is surfaced through the existing `status()` poll, exactly as `preparing` already is. No code path can submit.

**Tech Stack:** Node 22, `node:*` only (no npm runtime dependencies — the helper ships as a single-file SEA exe). `node --test`. Playwright exists in the repo for dev-only checks and must never be imported by shipped code.

**Spec:** `docs/superpowers/specs/2026-11-26-apply-assistant-design.md`

## Global Constraints

- Every runtime import is `node:*`. Nothing in `src/helper/apply/` may import `playwright`, and nothing may be added to a package manifest.
- `Runtime.evaluate` and `Runtime.callFunctionOn` appear **nowhere** in the apply tree. Enforced by a test, not by convention.
- No code path clicks a submit control, dispatches Enter into an input, or sends an HTTP request to an employer. `src/helper/apply/**` must never import `src/scan/http.mjs`.
- Never invented: a field with no confident match is left blank and flagged. A draft that fails a check leaves the box blank and flagged — never a quiet rewrite.
- Attestations (work authorization, sponsorship, criminal record, visa, non-compete, references, reason for leaving) and EEO/self-identification are never stored and never filled. They pause.
- The data folder is reached through `dataDir()`; files are written with `writeJson` (0600).
- The existing suite must stay green: `npm test` in `b3spoken/` (219 tests at the time of writing), and `node b3spoken/scripts/public-build-check.mjs` must still pass on main.
- Windows is the shipping platform. Anything that cannot be proven on Linux is marked for a manual check on Windows before the slice is called done.

## Review Focus

1. **Chrome missing, or too old for the debugging channel** — Apply must behave exactly as it does today (open the posting in the normal browser) and say why, never throw. Test in Task 6.
2. **The form re-renders between snapshot and fill** — a stale node id must not write a value into a different field. Every fill re-resolves its selector and reads back; a mismatch aborts the session. Test in Task 8.
3. **A textarea's `maxlength` is shorter than the answer** — the answer must be refused and flagged, not silently truncated mid-sentence. Test in Task 4.
4. **The person closes the Chrome window mid-session** — the session must end as `failed` with a readable reason on the next poll, not hang until the idle timeout. Test in Task 8.
5. **Apply clicked twice, or on a second job while a session is live** — refused with a clear message; never two sessions. Test in Task 9.

---

### Task 1: The no-submit guard

**Files:**
- Create: `b3spoken/src/helper/apply/nosubmit.mjs`
- Create: `b3spoken/test/apply-nosubmit.test.mjs`
- Create: `b3spoken/test/fixtures/apply/buttons.json` (array of `{label, type, automationId, submit: true|false}`, at least 40 real control labels across the five boards: "Submit application", "Submit Application", "Apply now", "Send application", "Next", "Continue", "Add another", "Upload", "Save draft", "Review", "Attach resume", French and bilingual variants)

**Interfaces:**
- Produces: `isSubmit(el) -> void` where `el` is `{tag, type, label, value, ariaLabel, automationId}`. **Throws** on a submit control; returns undefined otherwise. Never returns a boolean — a caller cannot forget to check a thrown error.

- [ ] **Step 1: Write the failing test** in `b3spoken/test/apply-nosubmit.test.mjs`: load the fixture, assert `isSubmit` throws for every entry with `submit: true` and does not throw for every entry with `submit: false`; plus explicit cases for `type: "submit"` with an innocuous label, for `aria-label="Submit application"` on a `div`, and for a label differing only by case and spacing.
- [ ] **Step 2: Run it and watch it fail.** Run: `cd b3spoken && node --test test/apply-nosubmit.test.mjs` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement `isSubmit`** in `b3spoken/src/helper/apply/nosubmit.mjs`. Normalise with the same `fold()` approach as `src/helper/tailor/guard.mjs` (NFKC, strip zero-width, collapse whitespace, lowercase) before matching, so a zero-width character inside "submit" does not get past it. Match `type === "submit"` or any of `label`, `value`, `ariaLabel`, `automationId` against the submit wording.
- [ ] **Step 4: Run it and watch it pass.** Run: `cd b3spoken && node --test test/apply-nosubmit.test.mjs` — Expected: PASS.
- [ ] **Step 5: Commit.** `git add b3spoken/src/helper/apply/nosubmit.mjs b3spoken/test/apply-nosubmit.test.mjs b3spoken/test/fixtures/apply/buttons.json && git commit -m "Apply: the no-submit guard"`

---

### Task 2: The answer store

**Files:**
- Create: `b3spoken/src/helper/apply/answers.mjs`
- Create: `b3spoken/test/apply-answers.test.mjs`

**Interfaces:**
- Produces: `KEYS` (frozen array of the allowed field keys: `firstName`, `lastName`, `email`, `phone`, `addressLine`, `city`, `province`, `postalCode`, `country`, `linkedin`, `github`, `portfolio`, `noticePeriod`, `earliestStart`, `payFloor`, `payTarget`, `heardAbout`, `willRelocate`); `NEVER_STORED` (frozen array: `workAuth`, `sponsorship`, `criminalRecord`, `visa`, `references`, `nonCompete`, `reasonForLeaving`, `eeoRace`, `eeoGender`, `eeoDisability`, `eeoVeteran`, `sin`, `dateOfBirth`, `salaryHistory`); `cleanAnswers(obj) -> {fields: {[key]: {value, updatedAt, source}}}`; `readAnswers(dir)`, `writeAnswer(dir, key, value, source)`.
- Consumes: `readJson`/`writeJson`/`dataDir` from `src/helper/paths.mjs`.

- [ ] **Step 1: Write the failing test.** Assert: a key outside `KEYS` is dropped by `cleanAnswers`; every key in `NEVER_STORED` is dropped even when passed explicitly; `writeAnswer` on a `NEVER_STORED` key throws; values are trimmed and capped (2000 chars); `readAnswers` on a missing file returns `{fields:{}}`; a round trip through `writeAnswer`/`readAnswers` in a temp dir preserves `value` and sets `updatedAt`.
- [ ] **Step 2: Run it and watch it fail.** Run: `cd b3spoken && node --test test/apply-answers.test.mjs`
- [ ] **Step 3: Implement** `b3spoken/src/helper/apply/answers.mjs`, writing to `join(dir, "answers.json")` through `writeJson`, in the style of `cleanProfile` in `src/helper/profile.mjs`.
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.** `git commit -m "Apply: the answer store, with the two never-stored lists"`

---

### Task 3: Matching a field to an answer

**Files:**
- Create: `b3spoken/src/helper/apply/fields.mjs`
- Create: `b3spoken/test/apply-fields.test.mjs`
- Create: `b3spoken/test/fixtures/apply/greenhouse-form.json`, `ashby-form.json`, `lever-form.json` (snapshots: arrays of `{selector, tag, type, name, id, automationId, autocomplete, label, options, required, maxlength}`, captured by hand from real forms)

**Interfaces:**
- Consumes: `KEYS` from Task 2.
- Produces: `matchField(node, {map}) -> {key, confidence} | null` and `FLOOR` (the confidence below which a field is flagged rather than filled).

- [ ] **Step 1: Write the failing test.** Over the three fixtures: every node whose fixture entry carries an `expectKey` matches that key above `FLOOR`; every node carrying `expectNone` returns `null` or lands below `FLOOR`. Named cases: `autocomplete="tel"` beats a misleading label; a label of "Phone (optional)" matches `phone`; "Preferred name" does **not** match `firstName`; a question containing "sponsorship" returns `null` (it is an attestation, Task 4 owns it); a hidden node (`type="hidden"`) returns `null`.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `matchField`** in the order the spec fixes: the adapter's `map` by `automationId`/`id`, then `autocomplete`, then label text via per-key patterns. Pure; no I/O.
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.** `git commit -m "Apply: matching a form field to a stored answer"`

---

### Task 4: Free-text boxes — classify, reuse, and check a draft

**Files:**
- Create: `b3spoken/src/helper/apply/bank.mjs`
- Create: `b3spoken/test/apply-bank.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `classify(question) -> "draftable" | "parametrized" | "attestation"`; `normalise(question) -> string`; `readBank(dir)`, `saveAnswer(dir, question, text, {slot})`, `lookup(dir, question) -> {text, writtenAt, uses, lastSentTo} | null`; `checkDraft(text, {library, employer, maxlength}) -> {ok: true} | {ok: false, why}`.

- [ ] **Step 1: Write the failing test.**
  - `classify`: "Describe a time you handled conflict" → `draftable`; "How many years of Kubernetes do you have?" → `parametrized`; "Rate your React skill 1-5" → `parametrized`; "Are you legally authorized to work in Canada?" → `attestation`; "Will you now or in the future require sponsorship?" → `attestation`; "Have you ever been convicted of a criminal offence?" → `attestation`.
  - `normalise`: two spellings of the same question ("Why do you want to work here?" / "why do you want to work here") produce the same key; a different question does not.
  - `checkDraft` returns `ok: false` with a `why` for each of: text containing `[your start date]`; text naming a company other than `employer`; text asserting "3 years of Kubernetes" when the library has no Kubernetes duration; text longer than `maxlength`; text claiming "I built X" for a project the library marks as shared. `ok: true` for a draft built only from library sentences.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `bank.mjs`**, storing to `join(dir, "answers-bank.json")` via `writeJson`. `checkDraft` is a set of independent checks returning the first failure; shared-project detection reads the library entry's existing shared/joint marker.
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.** `git commit -m "Apply: free-text classification, the answer bank, and the checks a draft must pass"`

---

### Task 4b: Drafting a free-text answer

**Files:**
- Create: `b3spoken/src/helper/apply/draft.mjs`
- Create: `b3spoken/test/apply-draft.test.mjs`

**Interfaces:**
- Consumes: `lookup`, `classify`, `checkDraft` from Task 4; the existing `ask(provider, prompt)` seam from `src/helper/ai.mjs`, injected.
- Produces: `answerFor(question, ctx) -> {text, source} | {blank: true, why}` where `ctx` is `{dir, library, posting, employer, maxlength, ask}`. `source` is `"written"` (his own, from the bank) or `"drafted"`.

- [ ] **Step 1: Write the failing test** with a stub `ask`:
  - a question already in the bank returns that text with `source: "written"` and never calls `ask`;
  - an unknown draftable question calls `ask` once and returns `source: "drafted"`;
  - a draft that fails `checkDraft` returns `{blank: true, why}` and is **not** retried into something weaker;
  - an `attestation` question returns `{blank: true, why: "pause"}` without calling `ask`;
  - a `parametrized` question with no figure in the library returns `{blank: true}` without calling `ask`;
  - `ask` throwing or timing out returns `{blank: true, why}` rather than propagating;
  - the prompt sent to `ask` contains the person's library and the question, and the posting text only after `fold()` from `tailor/guard.mjs`.
- [ ] **Step 2: Run it and watch it fail.** Run: `cd b3spoken && node --test test/apply-draft.test.mjs`
- [ ] **Step 3: Implement `answerFor`.** Bank first, then draft. The prompt instructs plainly: use only the facts in the library, no placeholders, no company name but this employer's, and stay under `maxlength`. The checks are what enforce that, not the instruction.
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.** `git commit -m "Apply: draft a free-text answer, or leave the box blank and say why"`

---

### Task 5: The DevTools transport

**Files:**
- Create: `b3spoken/src/helper/apply/cdp.mjs`
- Create: `b3spoken/test/apply-cdp.test.mjs`
- Create: `b3spoken/test/helpers/fake-cdp.mjs` (a `node:http` + `WebSocketServer`-free fake: serves `/json/version`, accepts a WebSocket upgrade with `node:http`'s own upgrade event, replies to method calls from a script, and records what it was asked)

**Interfaces:**
- Produces: `METHODS` (frozen allowlist); `connect({port}) -> {send(method, params), on(event, fn), close()}`; `send` throws `Error("method not on the allowlist")` for anything outside `METHODS`.
- `METHODS` is exactly: `DOM.getDocument`, `DOM.querySelector`, `DOM.querySelectorAll`, `DOM.describeNode`, `DOM.getBoxModel`, `DOM.focus`, `DOM.setFileInputFiles`, `DOM.scrollIntoViewIfNeeded`, `Input.insertText`, `Input.dispatchKeyEvent`, `Input.dispatchMouseEvent`, `Page.enable`, `Page.navigate`, `Page.getFrameTree`, `Network.enable`, `Accessibility.enable`, `Accessibility.getFullAXTree`, `Target.getTargets`, `Target.attachToTarget`.

- [ ] **Step 1: Write the failing test.** Against the fake: `connect` resolves and `send("DOM.getDocument")` returns the fake's reply; `send("Runtime.evaluate", …)` throws before anything reaches the socket (assert the fake recorded no such call); a reply carrying an `error` rejects with its message; `close()` ends the socket. Plus the static assertion: read every file under `src/helper/apply/`, assert none contains `Runtime.evaluate`, `Runtime.callFunctionOn`, or an import of `src/scan/http.mjs`, and assert the exported `METHODS` array equals the list above verbatim.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `cdp.mjs`** using Node 22's global `WebSocket`: fetch `/json/version` for `webSocketDebuggerUrl`, connect, correlate replies by incrementing id, surface events through `on`. Keep the pipe transport out of this task — it lands in Task 6 behind the same interface.
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.** `git commit -m "Apply: an allowlisted DevTools transport, with no way to run page script"`

---

### Task 6: Starting Chrome

**Files:**
- Create: `b3spoken/src/helper/apply/chrome.mjs`
- Create: `b3spoken/test/apply-chrome.test.mjs`

**Interfaces:**
- Consumes: `connect` from Task 5.
- Produces: `findChrome(env, platform) -> string | ""` (probes `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%LOCALAPPDATA%\Google\Chrome\Application` on win32; the usual Mac and Linux paths otherwise, in the shape of `findOnPath` in `src/helper/ai.mjs`); `chromeArgs(profileDir, {pipe}) -> string[]`; `startChrome(dir, {spawn, env, platform}) -> {transport, kill()}`.

- [ ] **Step 1: Write the failing test.** `findChrome` returns "" when nothing exists (injected `exists` predicate) and the first hit otherwise; `chromeArgs` contains `--user-data-dir=<profileDir>` and, with `{pipe: true}`, `--remote-debugging-pipe` and no `--remote-debugging-port`; with `{pipe: false}`, `--remote-debugging-port=0`; the args never contain `--headless` and never `--disable-web-security`. **Review Focus 1:** `startChrome` with an injected `spawn` that throws ENOENT rejects with a message naming Chrome, and does not throw an unhandled error.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `chrome.mjs`.** Profile at `join(dataDir(), "chrome-profile")` via `ensureDir`. Try the pipe transport first (fds 3 and 4, newline-delimited JSON, same interface as Task 5's `connect`), fall back to the port when the pipe handshake does not complete within 5 seconds.
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.** `git commit -m "Apply: find and start Chrome with its own profile"`
- [ ] **Step 6: Mark for Windows.** Add a line to the plan's "Needs a Windows run" list below: the pipe handshake from the built exe.

---

### Task 6b: The navigation allowlist

**Files:**
- Create: `b3spoken/src/helper/apply/allowed.mjs`
- Create: `b3spoken/test/apply-allowed.test.mjs`

**Interfaces:**
- Consumes: the blocked-address predicate used by `src/scan/http.mjs`, **by copy, not by import** (the apply tree must not import that module): duplicate the check and add a test asserting the two agree over a fixture list of addresses.
- Produces: `allowedNavigation(url, {posting, adapterHosts, hops}) -> true | {refused, why}`.

- [ ] **Step 1: Write the failing test.** Allowed: the posting's own registrable domain; a registrable domain in `adapterHosts`; one recorded redirect hop away from the posting. Refused, each with a `why`: a second hop to an unrelated domain; `http://127.0.0.1:4747/` (the board's own origin, which carries the API token); `http://localhost:9222/`; a private or reserved address; a `file://` or `data:` URL; a subframe URL outside the allowlist.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `allowedNavigation`.** Compare registrable domains, not hosts, so `boards.greenhouse.io` and `job-boards.greenhouse.io` both pass while `greenhouse.io.evil.test` does not.
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.** `git commit -m "Apply: where the browser is allowed to go"`

---

### Task 7: The one-page adapter

**Files:**
- Create: `b3spoken/src/helper/apply/adapters/index.mjs`, `b3spoken/src/helper/apply/adapters/onepage.mjs`
- Create: `b3spoken/test/apply-adapter-onepage.test.mjs`

**Interfaces:**
- Consumes: the snapshot fixtures from Task 3, `classify` from Task 4.
- Produces: `adapterFor(job) -> adapter | null` (by `job.source`, then by host); adapter shape `{id, hosts, startUrl(job), map, isAccountWall(snapshot), isCaptcha(snapshot), isReviewPage(snapshot), next(snapshot, state) -> {action, …}}` where `action` is one of `fill`, `upload`, `blocked`, `done`. Pure: it never touches a transport.

- [ ] **Step 1: Write the failing test.** `adapterFor({source:'greenhouse'})` returns the one-page adapter; `adapterFor({source:'workday'})` returns `null` (slice 2). Over each fixture: `next()` returns a `fill` action naming every field Task 3 matched, an `upload` action for the resume input, and `done` once the fixture's state marks them filled. A fixture containing a visible CAPTCHA iframe returns `blocked` with `kind: "captcha"`; a fixture that is a sign-in wall returns `blocked` with `kind: "account"`.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement both files.** One adapter covers all five boards; `hosts` lists their registrable domains.
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.** `git commit -m "Apply: the one-page board adapter"`

---

### Task 8: The session

**Files:**
- Create: `b3spoken/src/helper/apply/session.mjs`
- Create: `b3spoken/test/apply-session.test.mjs`

**Interfaces:**
- Consumes: everything above, injected: `createSession({dir, job, cdp, adapter, documents, now})`.
- Produces: `createSession(...) -> {state(), start(), continue(), answer(key, value), cancel()}` where `state()` returns `{jobId, state, step, blocked, filled: [{question, key, text, source}], flagged: [{label, why}]}` and `state` is one of `idle, attaching, documents, navigating, filling, blocked, review, done, failed, cancelled`.

- [ ] **Step 1: Write the failing test**, against the fake CDP server and a fixture form:
  - a happy run reaches `review` with `filled` naming every matched field and `flagged` naming the rest;
  - **Review Focus 2:** when the fake returns a different node id for a selector between snapshot and fill, the session ends `failed` with a reason mentioning the field — it does not write;
  - after a fill, the session reads the value back through `Accessibility.getFullAXTree` and aborts on a mismatch;
  - a `blocked` state resolves through `continue()`, and on resume the session re-snapshots and leaves fields it did not fill untouched (a value the test writes into the fake between pause and resume survives);
  - **Review Focus 4:** when the transport closes mid-run, the next `state()` is `failed` with a readable reason;
  - the idle timeout moves `blocked` to `failed` using the injected clock;
  - reaching `review` **detaches** (the fake records a close) and never kills the browser;
  - a navigation the allowlist refuses ends the session `failed` with the `why`, and no `Page.navigate` reaches the fake.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `session.mjs`.** Documents come from the injected `documents` accessor; when none exist it enters `documents`, makes them without the AI, then continues.
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit.** `git commit -m "Apply: the session, pausing for a human and never submitting"`

---

### Task 9: Wiring into the app and the API

**Files:**
- Modify: `b3spoken/src/helper/main.mjs` (a `session` binding in `createApp`; `apply` added to the `status()` return; `startApply`, `applyContinue`, `applyAnswer`, `applyCancel` on the returned object)
- Modify: `b3spoken/src/helper/server.mjs` (routes)
- Modify: `b3spoken/test/helper.test.mjs` (one new test)

**Interfaces:**
- Consumes: `createSession` from Task 8.
- Produces: `POST /api/jobs/:id/apply` → 202; `POST /api/apply/continue`; `POST /api/apply/answer`; `POST /api/apply/cancel`; `status().apply`.

- [ ] **Step 1: Write the failing test** in `helper.test.mjs`, with a fake cdp injected through the existing `deps` seam: `POST /api/jobs/<id>/apply` returns 202 and `status().apply.jobId` is that job; **Review Focus 5:** a second `POST` while a session is live returns 409 and the first session is untouched; `POST /api/apply/cancel` returns the state to `idle`; apply is refused with 409 while `state.refreshing`; **there is no route that submits** — assert a `POST /api/apply/submit` returns 404.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement the wiring.** `deps.cdp` defaults to the real transport. `prepareAll` is skipped while a session is live (guard in `status()` next to the existing `preparing` check).
- [ ] **Step 4: Run the whole suite.** Run: `cd b3spoken && npm test` — Expected: all green, including the 219 that existed before.
- [ ] **Step 5: Commit.** `git commit -m "Apply: wire the session into the app and the local API"`

---

### Task 10: The board

**Files:**
- Modify: `b3spoken/src/helper/public/app.js` (the Apply control, the apply panel, the poll)
- Modify: `b3spoken/src/helper/public/app.css` (panel styles, using the existing tokens only)
- Create: `b3spoken/scripts/apply-ui-check.mjs` (a dev-only Playwright check in the shape of the pager check, run by hand, never imported by shipped code)

**Interfaces:**
- Consumes: `status().apply` and the four routes from Task 9.

- [ ] **Step 1: Write the failing check** in `b3spoken/scripts/apply-ui-check.mjs`. Drive the board in Playwright the way the pager check does, against a helper with a fake cdp: clicking Apply on a one-page job shows the panel; the panel lists filled fields with their text and source and flagged fields with why; a `blocked` state shows the prompt and a Continue button; `review` shows "Read the form in Chrome, then submit it yourself" and a "Did you submit?" control; clicking that marks the job applied through the existing tracker route; a job whose source has no adapter opens the posting exactly as today.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Keep the card's layout unchanged: Apply starts a session for a supported source and remains a plain link otherwise. The panel follows `DESIGN.md` tokens; no new colours.
- [ ] **Step 4: Run the check and the suite.**
- [ ] **Step 5: Commit.** `git commit -m "Board: start an application from the Apply button and show what was filled"`

---

### Task 11: Seed the bank from the letters already written

**Files:**
- Create: `b3spoken/src/helper/apply/seed.mjs`
- Create: `b3spoken/test/apply-seed.test.mjs`
- Modify: `b3spoken/src/helper/public/setup.js` (one panel: contact fields, and "Use my old cover letters to start the answer bank")

**Interfaces:**
- Consumes: `saveAnswer` from Task 4.
- Produces: `seedFromLetters(dir, letters) -> {added, skipped}` where `letters` is `[{employer, text}]`.

- [ ] **Step 1: Write the failing test.** Two sample letters produce bank entries marked `source: "letter"` and `approved: false`; an entry still naming its original employer is kept but flagged so `checkDraft` refuses it elsewhere; the same letter twice adds nothing the second time.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement** `seed.mjs` and the setup panel (contact fields write through `writeAnswer`).
- [ ] **Step 4: Run the suite.**
- [ ] **Step 5: Commit.** `git commit -m "Apply: start the answer bank from the cover letters already written"`

---

## Needs a Windows run before this slice is done

- The `--remote-debugging-pipe` handshake from the built `B3spoken.exe` (Task 6). If it fails, the port fallback ships and the design's stated residual risk applies.
- One real application on a Greenhouse or Ashby posting, filled and read but not submitted, to confirm the five boards' forms match the fixtures.
