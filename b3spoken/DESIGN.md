---
version: alpha
name: B3spoken-design
description: >
  B3spoken's board and setup pages. A quiet, dense, text-first app UI that runs on the person's own
  computer in whichever theme their system is set to. Light and dark are equals here: both are designed,
  neither is an afterthought. One chromatic accent, hairline borders, almost no shadow.
  Format follows Google's DESIGN.md convention. The real values live in src/helper/public/app.css;
  this file is the reasoning behind them and the rules for changing them.

colors:
  accent: "#2a5bd7"          # light theme; dark theme "#7aa2ff"
  canvas: "#f7f7f5"          # dark "#151514"
  surface: "#ffffff"         # dark "#1f1f1d"
  ink: "#1d1d1b"             # dark "#ecece6"
  ink-subtle: "#66665f"      # dark "#a2a29a"
  hairline: "#e2e2dc"        # dark "#33332f"
  ok: "#1d7a46"              # dark "#5fcf8f"
  warn: "#9a5b00"            # dark "#f0b45a"
  bad: "#b42318"             # dark "#ff8a80"

spacing:
  base: 4px
  s1: 4px
  s2: 8px
  s3: 12px
  s4: 16px
  s5: 24px
  s6: 32px
  s7: 48px

rounded:
  r1: 6px     # alerts, focus ring
  r2: 8px     # inputs, buttons
  r3: 12px    # cards, panels
  r4: 16px    # dialogs
  pill: 9999px  # chips and tags only

typography:
  family: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
  body:   { size: 15px, line: 1.45 }
  h2:     { size: 17px, line: 1.3, weight: 600 }
  small:  { size: 13px, line: 1.5 }
  tiny:   { size: 12px, line: 1.4 }
  measure: 68ch

components:
  apply:        "Primary action. Background {colors.accent}, white text, {rounded.r2}, padding 7px 14px. Hover brightens 8%."
  badge:        "Flat chip. {rounded.pill}, 1px {colors.hairline} border, no fill, {typography.tiny}."
  score:        "Chip carrying meaning: Strong {colors.ok}, Good {colors.accent}, Stretch {colors.warn}."
  alert:        "Box with a 3px coloured left edge on {colors.surface}, {rounded.r1}. Warnings {colors.warn}, AI traps {colors.bad}."
  job-card:     "{colors.surface}, 1px {colors.hairline}, {rounded.r3}, padding {spacing.s4} {spacing.s5}, gap {spacing.s4} between cards."
  focus-ring:   "2px {colors.accent} at 50% opacity, as a box-shadow on :focus-visible. Never removed."
---

## Overview

B3spoken is a tool someone opens every morning to decide where to spend an hour applying. It is read
quickly and acted on: scan a list, judge a match, download two files, move on. Everything here serves
that. There is no hero, no marketing surface, no illustration. The page is text and controls, and the
job's own words are the loudest thing on it.

## Colors

One chromatic accent. It means "you can act on this" and nothing else.

**The accent is allowed on:** the Apply button, links, the focus ring, the selected tab, and the Good
match chip. Nowhere else — not borders on hover, not panel fills, not decoration.

The semantic three (ok, warn, bad) are a separate axis and carry meaning only: match quality, follow-ups
due, AI traps, health results. A colour never carries meaning on its own — the word is always there too,
because about one man in twelve cannot separate the red from the green.

Both themes are defined token for token. Light values sit on `:root`; dark values are redefined inside
`@media (prefers-color-scheme: dark)`. No component rule hard-codes a colour.

## Typography

System fonts, no web font. The app opens offline and must not wait on a download or shift as one lands.

Running text stops at 68 characters (`--measure`). Long job descriptions and AI reviews are the reason
this file exists: a 900px line of grey text is what made a reviewer say it read like a newspaper.

Size does the work, not weight. Body 15px, card titles 17px/600, supporting text 13px, chips 12px.

## Layout

**Base unit 4px.** Every gap and padding is a step on the scale: s1 4, s2 8, s3 12, s4 16, s5 24, s6 32,
s7 48. No hand-picked values.

Cards sit on a 16px gap with 16/24 padding. Content inside a card is separated by 8px, and a rule
divides the job from the things you do about it.

One column, 920px maximum. A job list does not benefit from a second column; it benefits from a short
line and clear order.

## Elevation & depth

Hairline borders carry the structure. In light there is one barely-there lift on cards; in dark there is
none at all, because a shadow on a dark ground reads as dirt. Nothing else in the app is raised.

## Components

Three box shapes, each with one job, and they are never swapped:

- **Chip** (`.badge`, `.score`) — pill, flat, no fill. A label on something.
- **Card** (`.job`, `.health`) — 12px radius, hairline, surface fill. A thing you can act on.
- **Alert** (`.problems`, `.trap`) — 6px radius with a 3px coloured left edge. Something gone wrong or
  worth care. Never used for ordinary content, which is what a reviewer caught us doing.

Every control shows keyboard focus as a 2px accent ring at 50% opacity. This is never removed.

## Do's and don'ts

**Do** keep the accent for actions, links, focus and the selected tab.
**Do** give every colour-coded thing a word as well as a colour.
**Do** put new spacing on the 4px scale.
**Do** keep running text inside `--measure`.
**Do** name a control by what happens: "View posting" when it opens the posting, "Apply" only when it
opens an application form.

**Don't** add a second accent hue.
**Don't** use an alert box for content, or a chip for an action.
**Don't** style a hover with the accent — the accent means actionable, and everything is hoverable.
**Don't** add a web font, a gradient, or a shadow beyond the card lift.
**Don't** define a colour only inside the dark-mode block.
**Don't** put a bare number on screen without saying what it is out of and who worked it out.

## Responsive behaviour

One breakpoint at 560px: header and main padding tighten, filter rows wrap. Everything else is already
fluid, because the layout is a single column of wrapping flex rows. Tap targets stay at or above 36px.

## Iteration guide

1. Change the token in `:root` in `src/helper/public/app.css`, not the component rule.
2. Change the dark value in the same commit.
3. Update this file's front matter so the two agree.
4. Look at the board in both themes at 1100px and 400px before committing.

## Known gaps

- The setup pages were written before these tokens and still carry a few hand-picked values.
- Contrast has been eyeballed, not measured against WCAG with a checker.
