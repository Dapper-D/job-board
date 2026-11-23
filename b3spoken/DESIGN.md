# B3spoken design

The board and setup pages follow this file. Anyone changing the UI, including an AI agent, reads it first and keeps
to it. The rules come from Vercel's Web Interface Guidelines, Anthropic's frontend-design skill and the DESIGN.md
format (one file holding the look, the components and the do's and don'ts), adapted to a plain HTML and JavaScript
page with a strict Content-Security-Policy (no build step, no outside scripts, styles or fonts).

## 1. Feel

A calm work tool for someone applying to jobs every day. It should feel like a tidy inbox, not a newspaper. Each
screen answers one question: "what should I apply to next?" (Jobs) or "where are my applications?" (My applications).

## 2. Colour (tokens in `app.css`, `:root`)

| Token | Use |
| --- | --- |
| `--bg` | Page background |
| `--card` | Cards, inputs, dialogs |
| `--ink` / `--muted` | Text / secondary text (never below 4.5:1 on `--card`) |
| `--line` | Borders and dividers |
| `--accent` | The one main action per card, links, the current tab |
| `--ok` / `--warn` / `--bad` | Match level and alerts only |
| `--*-soft` | Tinted fills behind tags and alerts |

Colour is never the only signal: every level, status and alert also says it in words.

## 3. Type

System UI font stack (no web fonts: the CSP blocks them and the board works offline). One scale:
12px (labels), 13px (meta, tags), 15px (body), 17px (card title), 22px (page title). Line length stays under about
70 characters (`--measure: 68ch`). Numbers that line up use `font-variant-numeric: tabular-nums`.

## 4. Spacing

One scale, used everywhere: `--s1` 4px, `--s2` 8px, `--s3` 12px, `--s4` 16px, `--s5` 24px, `--s6` 32px.
Cards sit `--s4` apart and have `--s5` padding on wide screens (`--s4` on phones). Sections inside a card are `--s3`
apart. Nothing touches the edge of its box.

## 5. Components

- **Card** (`.job`): one job. Title, company and place, a match chip, "why it matches", then actions. Content goes in
  cards, never in alert boxes.
- **Match chip** (`.score`): the level in words and the score, e.g. "Strong match · 72". Levels: Strong match, Good
  match, Long shot. The legend under the tabs explains them.
- **Tag** (`.tag-skill`): a skill. Filled, no border. "On your resume" tags are green-tinted, "Missing" tags grey.
- **Alert** (`.alert`, also the older `.problems` and `.trap`): only for something the person must notice now: a
  scam sign, an AI trap, an error. A tinted box with a coloured left edge and a bold first word.
- **Buttons**: one primary (filled accent) per card, the rest secondary (outlined) or quiet (text). Labels say what
  happens: "Apply on Lever", "Mark as applied", not "Go" or "Continue". A busy button keeps its label and adds an
  ellipsis ("Writing…").
- **Disclosure** (`details`): extra tools and the score breakdown stay folded until asked for.
- **Pager** (`.pager`): "Showing 21–40 of 312", Previous, page numbers, Next. Links, not buttons.

## 6. Layout

One column, `max-width: 920px`. Header, then the view tabs, then filters, then the list, then the pager. Filters,
tab and page live in the URL, so a refresh or the Back button keeps your place. Lists are paged (20 a page), never
endless.

## 7. Depth

Flat. Cards have a 1px border and a faint shadow; a dialog has a stronger one. Inner radius is never larger than its
parent's.

## 8. Responsive and accessible

- Works from 320px wide. Tap targets at least 44px tall on touch screens, 32px with a mouse.
- Every control has a visible or `aria-label` label; focus shows a 2px accent outline (`:focus-visible`).
- Live messages (saved, moved, errors) use `aria-live="polite"`.
- Motion only with `prefers-reduced-motion: no-preference`, and only opacity or transform.
- Dark mode follows the system.

## 9. Do's and don'ts

Do:
- Say where a button goes ("Apply on Greenhouse ↗") and open the employer's own application page.
- Explain every score: the four parts (skills, job title, level, pay) and their points.
- Keep application tracking (status, follow-up date, notes) under My applications. A job card only offers
  "Mark as applied" and "Not interested".
- Use short bullets instead of sentences joined with "·".
- Spell skills one way (JavaScript, Node.js, APIs) and list each one once.

Don't:
- Don't use alert styling for tags, labels or content.
- Don't show internal words ("Stretch", "Skip", "tech 7/10") without plain words beside them.
- Don't add an endless "Show more" list.
- Don't put more than three buttons in a card's main row; the rest go under "More for this job".
- Don't use `innerHTML`; build elements with `el()` so posting text stays text.
