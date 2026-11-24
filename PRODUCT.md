# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Invited people** (primary): clients, stakeholders and interviewees of a software project that the
  factory is building. Often non-technical, never trained on the factory. They arrive from an email
  invitation, on a phone or a computer, sign in with a code, and answer what was asked of them: a
  question sheet, a review of key screens, a demo approval, points of «Decisiones». Their job: say what
  they think, quickly, without getting lost, and know it reached the team.
- **The project owner** («el responsable del proyecto»): the person who runs the factory. Shares pieces,
  follows who opened, who is working and who sent, reads what each person sent or received.

## Product Purpose

The portal is where the factory's work reaches a person and waits for their decision. It replaced
sending HTML files over chat: the person works each piece in the browser, progress is saved, and the
answer goes straight back to the factory. Success: invited people finish and send without abandoning,
and the owner knows the state of every person at a glance.

## Positioning

The name carries the mechanism. **ninben** (ニンベン) is the stroke 亻, «person», that Toyota added to
動 («to move») to write jidoka, 自働化: the loom stops by itself when a thread breaks, and a person
decides. The factory automates the building of software; the portal is the stop where a person decides.
No neighboring tool can claim that the human decision is the whole point of the surface.

## Operating Context

- Entry is always an emailed link, then email + 8-digit code (no passwords).
- Screens: sign-in (email, code), «Tus proyectos» (home), a project's page (what was asked of the
  person, «Decisiones», and for the owner «Avance de lo que compartiste»), a piece inside the portal's
  frame, the owner's read-only views of what a person sent or received.
- Pieces are separate HTML documents rendered inside the portal (sandboxed iframe); the portal frames
  them but does not draw their inside.
- Text follows the project language (Spanish by default, English supported).

## Capabilities and Constraints

- Static site: HTML, CSS, ES modules, no build step; Supabase for data; Cloudflare hosting.
- Must work from 320 to 1440 px wide, light and dark.
- Behavior, routes, copy and states are product truth; the visual redesign does not change them.
- Large browser test suite covers behaviour, brand, the thread and the chosen composition; a redesign updates those
  tests deliberately, never silently.
- Accessibility is the floor, not a visual manual (owner, 2026-11-24: the factory's retired manual no longer binds the
  portal): no sideways scroll from 320 to 1440 px, 44 px targets, visible focus, axe (contrast included) in light and
  dark, nothing cut.

## Brand Commitments

- Name **ninben**, lowercase, kept.
- Logo kept: the stroke 亻 (two strokes, square ends) next to the word.
- Colors and typefaces may change (owner, 2026-11-24): the visual should be built from what ninben
  represents, not from a generic app look.
- Open decision: the brand today is shared with the pieces (copied from the factory's
  `design-system/assets/brand/`). Whether a new portal look also changes the pieces is decided after
  the portal direction is chosen.

## Evidence on Hand

- Real copy and states: `js/i18n.js`, README «How it works».
- Logo: `brand/logo.svg`. Meaning of the name: factory README «Las piezas para terceros: ninben».
- No testimonials, customers or usage numbers exist; none may be invented.

## Product Principles

1. The person decides; the portal never decides for them and never hides what it records.
2. One clear next step per screen; nobody abandons from tedium.
3. The owner reads state, never drafts.
4. Calm and exact over decorative: the stop is a moment of attention, not a show.

## Accessibility & Inclusion

Non-technical people on phones: readable at 320 px, nothing cut, WCAG AA contrast in light and dark,
keyboard and screen-reader names for every action (already tested).
