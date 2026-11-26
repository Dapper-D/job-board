# Apply assistant: fill the application, stop before Submit

Status: design, awaiting approval. Written 2026-11-26.

## Intent

B3spoken already finds the jobs and writes a tailored resume and cover letter for each one. The part
it leaves to the person is the worst part: twenty minutes of retyping the same name, address, work
history and "why this company" into a different form at every employer, after making an account with
that employer first.

This feature does the typing. It drives the person's own browser through the application, fills what
it can from answers they have given once, attaches the documents B3spoken already made, and stops.
They read the form, fix anything, and press Submit themselves.

The point is to make one good application take two minutes instead of twenty. It is **not** to fire
off hundreds. The evidence runs against volume: Greenhouse now ships spam and identity detection,
there are around 254 applicants per job, and Greenhouse's own figures say candidates who flag one
priority role a month are hired at roughly five times the rate. A tool that makes careful applications
cheap is worth building. A tool that makes careless applications free is not.

## Goals

- From a job card on the board, get to a filled-in application with the resume and cover letter
  attached, without the person typing anything they have typed before.
- Hand control back, clearly and immediately, whenever only a human can act: making an account with
  that employer, a verification email, a CAPTCHA, a question with no stored answer.
- Never put a value on a form that the person did not supply.
- Work for anyone who installs B3spoken, not only its author.

## Non-goals

- Submitting. The person submits, every time, having read the form.
- An "apply to all" button, a queue, or any unattended run. Explicitly rejected by the owner.
- A redesign of the board. The existing **Apply** button on a card is the trigger; nothing else about
  the card changes.
- Filling job-site applications (LinkedIn, Indeed, Glassdoor). Out of scope, as scraping them is.
- Phenom-hosted forms (12% of the board). Detect and hand over — see Adapters.

## Anti-goals

Things that would make this a failure even if it worked:

- A wrong answer reaching an employer silently. Two shipped tools demonstrate the failure: LazyApply
  told employers a user required an H-1B when they did not; Simplify ticked the wrong ethnicity.
  A mismatched field that validates and submits is worse than no autofill at all.
- Getting someone's employer account terminated by looking like a bot.
- Leaking the answer file, or the browser profile's accumulated employer logins, to another program
  on the person's computer.

## Constraints

1. **Nothing defeats a CAPTCHA or a bot check.** When one appears, the human does it. (Owner's
   standing rule, and the cost of breaking it is a terminated account, which loses the application.)
2. **Nothing is invented.** Unmatched field → left blank and flagged.
3. **The helper is a Node SEA single-file exe with zero npm runtime dependencies.** Every runtime
   import is `node:*`. Playwright exists in the repo but only under `src/scan/discover-render.mjs`
   behind a dynamic import, and is never packed into the exe. The driver must keep that true.
4. The local server binds 127.0.0.1, authenticates with a per-run token in a page meta tag, and
   serves the board under a strict CSP (`connect-src 'self'`). The board page therefore cannot talk
   to a debugging port directly; the driver lives in the helper.
5. Windows is the shipping platform (`B3spoken-Setup-*.exe`); Mac and Linux builds exist.

## Approaches considered

**1. A Chrome extension.** Runs in the person's everyday browser with their real sessions, which is
what Simplify does. Rejected as the vehicle: it needs store review, cannot be shipped inside the
installer, and Simplify's dominant user complaint is not detection but memory — "99% RAM, browser
freezes," worst on Workday. It also splits the product in two.

**2. A bundled or patched Chromium driven by Playwright.** Simplest to build and test. Rejected on
evidence: Workday sits behind Kasada, which checks Chrome globals that patched Chromium gets wrong,
and LinkedIn-style TLS ClientHello checks catch it too. That is 42% of the board failing on day one,
and it would put a ~300MB browser in a single-file exe.

**3. The person's real Chrome, driven by the helper. ← chosen.** Real Chrome binary, real TLS
fingerprint, real Chrome globals. A visible window is also what makes the hand-off natural rather
than bolted on: when it pauses for a signup, the person is already looking at the page.

A correction found during review: Chrome 136+ refuses a remote debugging connection when the profile
is the user's default one. So this is real Chrome with a **dedicated profile** under B3spoken's data
folder, in which employer logins accumulate over time. That is a deliberate trade: the profile is
isolated from their everyday browsing (and from its App-Bound-Encryption key), at the cost of signing
in to each employer once inside it.

## How it works

### The trigger

The existing **Apply** button on a job card. Today it opens the posting. It now starts a session: the
helper opens the posting in the B3spoken Chrome profile and begins. One session at a time. No change
to the card's design.

### The browser

`src/helper/apply/cdp.mjs`, hand-written, `node:*` only, behind one small interface with two
implementations, because these are different transports and only one of them is proven here:

- **`--remote-debugging-pipe`** — newline-delimited JSON over inherited file descriptors 3 and 4. No
  listener, nothing for another program to connect to. Preferred.
- **`--remote-debugging-port=0`** — Node 22's global `WebSocket`, with the real port read from
  `DevToolsActivePort` inside the profile directory. Fallback.

Passing extra inherited descriptors to a child process on Windows, from a Node SEA exe, is the part
that may not work, and it cannot be proven from a Linux machine. **Slice 1 starts by proving the pipe
on Windows.** If it does not work, the port fallback ships with the honest caveat below, not a claim
that it is as safe. This is a security decision, not a style
one: Chrome's debugging endpoint has no authentication of any kind — its only gate is a `Host` header
check that stops web pages but not other local processes — so a TCP port on a profile holding employer
logins is an unauthenticated credential store for anything running as that user. A pipe has no
listener to connect to. If a pipe proves unworkable, the fallback is `--remote-debugging-port=0`, the
real port read from `DevToolsActivePort` inside the 0700 profile directory, open only for the duration
of one application.

**Lifecycle.** The helper starts Chrome and owns the debugging channel, not the window. It detaches —
closing the channel — the moment the session reaches `review`, `failed`, `cancelled` or the idle
timeout, and from then on the window is the person's: a half-filled form is never closed out from
under them, and at `review` they need that window to submit. The helper kills Chrome only in the one
case where nothing is on screen worth keeping: it started the browser and the session never reached
`filling`. If the helper exits or installs an update mid-session, the channel closes and the window
stays. A second Apply while a review window is open opens a new tab in the same browser rather than a
second one — still one session at a time.

On the port fallback, the residual risk is stated plainly rather than papered over: file modes are a
no-op on Windows and `%LOCALAPPDATA%` is readable by anything running as that user, so while the
channel is open another local program could drive that profile. This is why the channel is open only
during a session, and why the profile must never be used to sign in to personal email. Chrome is found by probing `%ProgramFiles%`,
`%ProgramFiles(x86)%` and `%LOCALAPPDATA%\Google\Chrome\Application`, in the shape of `findOnPath()`
in `ai.mjs`. If Chrome is not installed, the feature says so and the Apply button behaves as it does
today.

### The session, and pausing for a human

State lives in a closure in `createApp`, exactly as `preparing` and the `installs` map already do, and
is surfaced through `status()`. HTTP never blocks.

States: `idle → attaching → navigating → filling → blocked → review → done | failed | cancelled`.
`blocked` carries `{ kind, prompt, field? }` where kind is one of `account`, `verify-email`, `captcha`,
`unknown-answer`.

- `POST /api/jobs/:id/apply` → 202, mirroring `POST /api/refresh`.
- `status()` gains `apply: { jobId, state, step, blocked, filled[], flagged[] }`. The board already
  polls; it drops to the existing 2s cadence while a session is live.
- `POST /api/apply/continue` — the person has done the human part; resume.
- `POST /api/apply/answer { field, value }` — they supply a missing answer. Only a key in the fixed
  enum is written to the store; a one-off employer question ("how did you hear about us") is used for
  this application and not stored, unless it is a free-text box the bank accepts.
- A pause can also be resolved by the person simply typing into the Chrome window themselves and
  pressing Continue. The runner re-snapshots on resume, leaves every field it did not fill alone, and
  the read-back check never fires on human-entered values — it compares only what the session itself
  typed.
- `POST /api/apply/cancel`.
- There is no submit route.

Twenty minutes idle in `blocked` ends the session. A session is refused while `state.refreshing`, and
`prepareAll` is skipped while a session is live, so a five-minute AI call cannot stall a person who is
mid-application.

### The answer store

`answers.json` in the data folder beside `profile.json`, written with the existing `writeJson`
(atomic, 0600, in a 0700 directory), validated by a `cleanAnswers()` in the style of `cleanProfile`.
Shape `{ fields: { [key]: { value, updatedAt, source } } }` with a **fixed key enum**, so a page can
never introduce a key.

Street address, phone and email are not stored anywhere today — the resume library keeps
`contact: { name, lines: [] }`, unparsed — so a small one-time panel in setup collects them. They go
in `answers.json`, **not** `profile.json`, deliberately: `documentStamp()` hashes the profile, so
putting them there would invalidate every prepared document for every user on upgrade and re-run
`prepareAll`; the profile is also embedded in the AI prompts, and a home address has no business
there. Do not parse the contact lines.

**Never stored, and never auto-answered:**

- **Work authorization and sponsorship.** The owner's decision: pause at every one, every time. Not
  stored, not derived from the profile's work-authorization setting. Mapping one dropdown value onto
  differently-worded yes/no questions is inference, and this is the field that produced the worst
  known failure in a shipped tool.
- **EEO and self-identification** (race, ethnicity, disability, veteran status, gender) — voluntary,
  special-category data, human every time.
- SIN, date of birth, immigration document numbers, salary history.

### Free-text boxes

Employers do not ask the same questions, and a pre-written answer for an arbitrary question does not
exist. So the box is classified first, and the class decides what happens. The class is decided once
per question text and cached forever, so the same question is never reasoned about twice.

| Class | Examples | Behaviour |
|---|---|---|
| **Reusable** | behavioural ("a time you handled conflict"), capability prose ("your experience with CI") | answered from the bank when the normalised question text matches exactly; otherwise pause and the answer enters the bank |
| **Parametrized** | anything containing a number, a named technology or a company ("years of Kubernetes") | never reused freely — the answer is a factual claim, and near-identical wording hides a different fact. Pause |
| **Always pause** | "why do you want to work here", "why this city", compensation, anything legal or attesting | the person writes it. Forty seconds, and the only box where reuse can actually blow up |

**The answer bank** (`answers-bank.json`, same protections as the answer store) holds answers the
person wrote, keyed by normalised question text, with the slot it was filed under, when it was
written, how often it has been reused and where it last went.

- **Exact normalised match auto-fills. Nothing else does, ever** — no similarity threshold, no
  closest match. A model may be called once, on first sighting of a question, to file it under one of
  about fifteen slots from a closed list; that result is cached. The model picks a slot, never a value.
- **Seeding, so week one is not a wall of pauses.** The owner already has twenty-odd cover letters and
  tailored resumes. At setup these are harvested into the bank as drafts, each marked unapproved and
  labelled with the letter it came from. Non-zero bank on day one, in his own words, and nothing
  unapproved is ever typed without him reading it.
- **The pause panel** shows the question verbatim, the candidate answer, the character count against
  the field's real `maxlength`, and three buttons: Use, Use and save the edit, Skip. Editing happens
  in the panel, never in the employer's textarea, which has no undo and re-renders on blur.
- **An edit forks** rather than overwriting, capped at three variants per slot; a fourth replaces one.
  Overwriting would let one company-specific sentence quietly poison the next ten applications.
- **Every reused answer carries its provenance** — written on, reused n times, last sent to X — and
  every proper noun and every number in it is highlighted. Those are exactly the tokens that go stale,
  and a reader scans for *empty*, not for *wrong*.
- **A hard block before anything is typed:** text containing a company name that is not this
  employer's is refused. The one real reuse failure is the paragraph that still names the last company.

Never auto-answered in a free-text box, at any confidence: compensation of any kind; any proficiency
or duration claim that is not already on the resume; attestations (work authorization, visa, criminal
record, non-compete, reason for leaving, references, start date); company-specific motivation; and any
sentence describing sole ownership of the projects the owner built jointly with someone else — those
need his eyes every time, because an honest tool starts producing claims he cannot defend in an
interview exactly there.

### Matching a field to an answer

`fields.mjs`, deterministic, in this order: the adapter's selector map (Workday's `data-automation-id`,
SuccessFactors' ids) → the field's `autocomplete` attribute (`given-name`, `tel`, `postal-code`) → the
label text, resolved through `for` / `aria-labelledby` / an ancestor `<label>`, against a per-key
pattern. Below the confidence floor: leave blank, flag, carry on.

A hard allowlist of **consequential questions** — work authorization, sponsorship, criminal record,
degree, salary — may only be filled from an exact stored answer. Never inference, never a closest
match. No stored answer means a pause, not a guess.

After filling, the value is read back from the DOM and compared to what was intended; any difference
aborts the session rather than continuing. Selectors are re-resolved after any page mutation. Hidden
and offscreen inputs are never touched.

### Adapters

`makeJob()` already stamps `job.source` (`workday`, `successfactors`, `oraclecloud`, `greenhouse`, …),
so adapter selection is a lookup, with a host-based `detect()` for pasted links.

An adapter is **pure**: given a snapshot of the page it returns a decision
(`{ action: 'fill' | 'click-next' | 'blocked' | 'done' }`) and never touches the browser. It exports
`{ id, hosts, startUrl(job), steps, map, isAccountWall, isCaptcha, isReviewPage, next(snapshot) }`.

Everything else is shared: the transport, navigation and settle waits, snapshotting a form into
`[{ selector, tag, type, name, id, automationId, autocomplete, label, options, required }]`, matching,
the answer store, file upload via `DOM.setFileInputFiles` using the paths the document index already
knows, the blocked/resume machine, and the guard.

**Phenom is not an adapter.** It is a career-site front end, often a door onto Workday or
SuccessFactors underneath; its own terms are the only vendor terms found that explicitly prohibit
bots. The behaviour is: detect, follow the hand-off to whatever ATS it lands on, and if the form is
Phenom's own, open it and hand over.

### Documents

The tailored resume and cover letter already exist for board matches (`prepareAll`), and are attached
from their existing paths. When a job has none — or the library has changed since they were made, so
the stamp has moved — the session enters a `documents` state and makes them **without the AI**, which
is the existing rules-only path and takes about a second. A five-minute AI call before the browser
even opens would undo the point of the feature. The AI version can be made afterwards from the card,
as it is today.

### The tracker

A session that reaches `review` does **not** mark the job as applied: reaching the review page is not
evidence that anything was submitted, and marking it would fill the Applied tab with applications
that never went out and generate follow-up nudges for them. After the session detaches, the panel
asks once — "Did you submit it?" — and marks it applied only on a yes, through the tracker route that
already exists.

### The no-submit guard, structurally

Not a setting and not a prompt — a missing capability.

- `cdp.mjs` exports a fixed allowlist of CDP methods, and the one that matters is absent:
  **no `Runtime.evaluate` and no `Runtime.callFunctionOn`**, because either would let page-derived
  text become executable and bypass every other control in a single call. The allowlist is
  `DOM.*` (resolve, focus, box model, `setFileInputFiles`), `Input.insertText` and
  `Input.dispatchKeyEvent` for typing, `Input.dispatchMouseEvent` for clicking, `Page.navigate` and
  its lifecycle events, `Network` events for redirect checking, and `Accessibility.getFullAXTree`,
  which is how a field's *current* value is read back without script (`DOM.getAttributes` returns the
  HTML attribute, not the live value). Typing through the real input pipeline is also what makes
  React-based forms — all of slice 1 — actually register the value.
- Every click candidate passes `isSubmit()` in `apply/nosubmit.mjs` — the sibling of
  `tailor/guard.mjs` — which **throws** (never silently skips) on `type="submit"` or on text,
  `value`, `aria-label` or `data-automation-id` matching submit-ish wording.
- Clicking is coordinate-based, so **every click resolves the element under the point first** and
  passes it to `isSubmit()` before the mouse event is dispatched. A click that cannot be resolved to a
  non-submit element is not dispatched at all.
- Synthesised Enter/Return into an input is filtered, because that submits a form.
- The apply tree never imports `src/scan/http.mjs`, so no code path can POST to an employer.
- A test asserts the exported method list equals the allowlist and that `Runtime.evaluate` and
  `Input.` appear nowhere outside `cdp.mjs` — the same shape as the regression pins in
  `coverage.test.mjs` and the public-build check.

When the adapter recognises the review page, the session ends in `review` and detaches. The person
reads and submits.

### Where the AI is allowed

The AI has exactly two jobs here, both of which produce a label and never a sentence: filing a
question under one of about fifteen slots on first sighting, and choosing which stored answer fits a
field. **It may never produce the text that gets typed** — the string always comes from the person's
own file. That is what stops a posting or an application page whose text carries instructions aimed at
an AI from steering what is typed into a form. The worst a crafted question can achieve is the
person's own answer in the wrong box, which the review catches. `guard.mjs` keeps flagging such
postings, but it is a regex denylist and is a signal, not a boundary.

**Navigation** is governed by an allowlist, not a single pin, because real applications hop origins
routinely — employer careers domain to ATS domain, Workday tenant to SSO and back, and Phenom's
hand-off to whatever sits behind it. The rule: the posting's own registrable domain, plus the
registrable domains of the known hiring systems (the adapters already declare `hosts`, and the scan
catalogue already knows them), plus one recorded redirect hop from the posting. Anything else stops
the session and asks. The pin applies to the top document; subframes may only load from the same
allowlist, since some ATS forms render in a third-party frame.

`127.0.0.1` and `localhost` are denied outright — including, pointedly, the board's own origin,
because the board page carries the API token in a meta tag and a browser that could read it could
drive the whole local API. The resolved application host is checked against the existing
`isBlockedIp` before navigating, and again on every redirect. There is no bypass flag in shipped code:
the dev-only real-DOM check drives Chrome from the test harness with Playwright and never goes through
the shipped driver, the same way `discover-render.mjs` stays out of the exe.

### Logging and the API surface

A typed value is never logged — redaction belongs at the logger, since `server.mjs`'s catch-all
`console.error(e)` will otherwise print a CDP error object containing it. The API returns presence and
masks, never the stored answers in full. `answers.json` is excluded from the kit import, backup and
update paths. An append-only per-application log records field → source (not value) so a bad fill can
be traced.

## What ships first

**Slice 1 — the one-page boards** (Greenhouse, Ashby, Lever, SmartRecruiters, Workable; ~10% of the
board). One adapter with a single step, no account wall, no multi-page state. It proves the entire
spine: start Chrome, navigate, snapshot, match, fill, upload both documents, the guard, the flagged
list, the status panel, and the review hand-off. Nothing can go badly wrong while the machinery is
being got right.

**Slice 2 — Workday** (42%). The account wall becomes the first pause. Per-tenant questionnaires are
filled only from exact stored answers. Honest limit: saved HTML cannot reproduce Workday's SPA or its
bot wall, so this adapter can only be finished by careful manual runs on postings the owner actually
means to apply to.

**Slice 3 — SuccessFactors** (19%), then **Oracle Cloud** (6%), which has no account wall and the most
uniform forms of the three.

Phenom detection/hand-off lands with slice 2, since most Phenom sites route to Workday.

## Testing

1. Adapters and `matchField` are pure, so they test as `node --test` over page snapshots committed to
   `test/fixtures/apply/<ats>-<page>.json`, captured once by hand with the Playwright already in the
   repo.
2. The session machine tests end to end against a **fake CDP server** injected through `createApp`'s
   existing `deps` seam, the way `helper.test.mjs` already injects `deps.ask`. The runner takes an
   injected clock and exposes the blocked promise, so the pause/resume handshake is testable.
3. The guard gets a fixture corpus of real submit-button labels, and the "no forbidden CDP method"
   assertion runs in the normal suite.
4. A dev-only real-DOM check serves saved application HTML from 127.0.0.1 and drives real Chrome —
   kept out of the exe, like `discover-render.mjs`.

## Left to the builder

- The exact confidence floor for label matching, and the per-key patterns.
- The shape of the one-time contact panel in setup.
- Whether the blocked prompt lives in the job card or a panel, within the existing design tokens
  (`DESIGN.md`).
- Retry and settle-wait tuning.
- Whether slice 1 ships behind a setting while it is new.

## Known limits

- Workday's own cross-employer Candidate Profile is due in 2027 and would prefill much of what slice 2
  does. Build slice 2 anyway; it is 42% of the board today.
- A dedicated Chrome profile means signing in to each employer once inside it. There is no way around
  this that does not involve the debugging port on a default profile, which Chrome has closed.
- Per-employer questionnaires change without notice. The honest failure mode is a pause, and the design
  prefers pausing to guessing everywhere.
