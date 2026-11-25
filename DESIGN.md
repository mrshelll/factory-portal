---
name: ninben portal
description: The stop where a person decides — an indigo shell over white cotton, one thread that breaks where the factory waits for you.
colors:
  signal: "#4137FF"
  on-signal: "#FFFFFF"
  soft: "#EFEEFF"
  shell: "#1F2A4E"
  on-shell: "#FFFFFF"
  on-shell-muted: "#B6BED9"
  signal-on-shell: "#A8A2FF"
  thread: "#2E3B6E"
  stop: "#F3F2FF"
  pill-run: "#2F25C9"
  pill-run-bg: "#E4E1FF"
  pill-todo: "#4A5272"
  pill-todo-bg: "#EEF0F6"
  pill-sent: "#17663B"
  pill-sent-bg: "#E6F4EC"
  bg: "#FFFFFF"
  sheet: "#FFFFFF"
  ink: "#151B30"
  muted: "#535B78"
  line: "#E4E6F0"
  line-strong: "#C9CDDD"
  ok: "#17663B"
  error: "#B42318"
typography:
  display:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  section:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  subheading:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.4
  item-title:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  piece-title:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  brand:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "24px"
    fontWeight: 400
    letterSpacing: "0.3em"
rounded:
  base: "4px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
  between-blocks: "32px"
  margin-page-sm: "16px"
  margin-page: "24px"
  reading-column: "60rem"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.base}"
    padding: "8px 24px"
    height: "48px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "8px 24px"
    height: "48px"
  button-secondary-on-shell:
    backgroundColor: "transparent"
    textColor: "{colors.on-shell}"
    rounded: "{rounded.base}"
    padding: "8px 24px"
    height: "48px"
  button-disabled:
    backgroundColor: "{colors.line}"
    textColor: "{colors.muted}"
    rounded: "{rounded.base}"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "8px 12px"
    height: "48px"
  masthead:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.on-shell}"
    padding: "8px 0"
    height: "64px"
  list-row:
    textColor: "{colors.ink}"
    typography: "{typography.item-title}"
    padding: "16px 0"
    height: "56px"
  list-row-stop:
    backgroundColor: "{colors.stop}"
    textColor: "{colors.signal}"
    padding: "24px 12px 24px 48px"
  status-pill-run:
    backgroundColor: "{colors.pill-run-bg}"
    textColor: "{colors.pill-run}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  status-pill-todo:
    backgroundColor: "{colors.pill-todo-bg}"
    textColor: "{colors.pill-todo}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  status-pill-sent:
    backgroundColor: "{colors.pill-sent-bg}"
    textColor: "{colors.pill-sent}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  decisions-panel:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.base}"
    padding: "24px"
  tag-new:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.signal}"
    typography: "{typography.small}"
    rounded: "{rounded.base}"
    padding: "4px 8px"
---

# Design System: ninben portal

## Overview

**Creative North Star: "The Loom That Stops"**

ninben is named for 亻, the stroke «person» that turned «to move» into jidoka: the loom stops by itself when a thread breaks, and a person decides. The portal is that stop. An aizome-indigo shell runs across the window; under it, a white undyed-cotton page holds one centred reading column. Inside it, one thread runs down the list of what was asked of the signed-in person and breaks exactly where the factory waits for them, with the violet 亻 disc sitting in the gap. Everything else is calm and exact: hairline rules and one hairline panel, small radii, soft state pills, one family, no texture, no fabric imagery, no motion beyond standard hover and focus.

Density is that of a working list, not a dashboard: rows of 56 px or more, a 32 px gap between blocks, a bold page title that leads, text kept to a reading measure. Violet is reserved for what can be touched (actions, links) and for what waits for the person (the stop rows, «N por responder», the «En curso» pill on the person's own list); it never decorates. Every state is said in words inside its pill; the tint and the dot only repeat it.

**Tokens are not this project's to invent.** `brand/ninben.css`, `brand/ninben-components.css`, `brand/logo.svg` and `brand/fonts/` are a generated copy (by `scripts/sync-brand.mjs`) of the single source in the factory repo, `software-factory/design-system/assets/brand/`, shared with the factory's pieces. That source is authoritative for every brand token: colours (light and dark), radius, fonts, the 14/16/20/24 text steps, the spacing scale, the page margin and the shared components. Change a brand token there and sync; never edit the copy in `brand/`. The reading column and the three state pills are brand tokens too (`--reading-column`, `--pill-*`), shared with the pieces. The portal's own tokens live in `css/portal.css`: the page title's display size, the shell wordmark's sizes and the thread's two colours.

**Accessibility is the floor.** No sideways scroll and nothing cut from 320 to 1440 px, 48 px controls and 44 px link targets, a visible focus ring on everything that can be touched, axe clean in light and dark, AA text in both schemes and a legible forced-colours rendering. The portal's browser tests measure these; a change that breaks one is a defect, not a design choice.

**Key Characteristics:**
- Indigo shell across the window over a white cotton page; content in a centred reading column of at most 60rem; light and dark from the same roles.
- One accent, violet, meaning «you can touch this» or «this waits for you».
- The thread: the portal's only signature, drawn on one list only.
- States as soft pills with their words and dot: violet in progress (on the person's own list), indigo-grey not started, green sent.
- Flat: hairline rules, one hairline panel and tinted rows; no shadows for depth.
- One family (Figtree, 400/600/700); JetBrains Mono only for the sign-in code.

## Colors

Indigo and undyed cotton: an indigo-tinted neutral ramp, one violet signal, green only for what arrived.

### Primary
- **Signal Violet** (`signal`): every action and link — the primary button, link text, project titles on home, the focus ring, a checked choice, the fold chevron — and what waits for the person: the title and chevron of a stop row, «N por responder» on home, the fill of the 亻 disc. Its tint, **Violet Wash** (`soft`), backs the «Nuevo» tag and the text selection.
- **Shell Violet** (`signal-on-shell`): the 亻 stroke and the focus ring on the indigo shell, where Signal Violet would not hold contrast.

### Secondary
- **Aizome Shell** (`shell`): the top bar, painted to the window's edges. Text on it is white (`on-shell`); «Entraste como …» takes **Faded Indigo** (`on-shell-muted`), and «Salir»'s border sits halfway between Faded Indigo and the shell.
- **Thread Indigo** (`thread`, portal-owned): the 2 px thread and its knots. **Stop Wash** (`stop`, portal-owned): the tint of a row where the thread is cut.
- **State pills** (brand tokens, shared with the pieces): **Running Violet** words on **Running Wash** (`pill-run` on `pill-run-bg`) for «En curso» on the person's own list; **Slate** on **Slate Wash** (`pill-todo` on `pill-todo-bg`) for «Por empezar», «La abrió», «Reemplazada», and for «En curso» on the owner's progress list, where nothing waits for the owner; **Sent Green** on **Green Wash** (`pill-sent` on `pill-sent-bg`) for «Enviada» and «Recibida». Every pair is 4.5:1 or more.

### Tertiary
- **Received Green** (`ok`): the dots of «Enviada» (ring) and «Recibida» (fill), and a notice that went well. Never an action colour.
- **Error Red** (`error`): invalid fields (border plus a 1 px inset ring) and error notices.

### Neutral
- **Cotton** (`bg`, `sheet`): the page, the «Decisiones» panel and every sheet; white in light, deep indigo-night in dark.
- **Indigo Ink** (`ink`): text, row titles that do not wait, the secondary button's words, the «En curso» and «La abrió» dots.
- **Faded Ink** (`muted`): meta lines, hints, the way back, field borders, the default chevron, «Eres responsable».
- **Hairline** (`line`): rules between rows, the panel's border, notices; the disabled button's fill. The brand also defines **Strong Hairline** (`line-strong`), which the portal does not use.

Dark scheme (same roles; brand values from the source, the pills included; portal values derived in `css/portal.css`): bg #0F1424, sheet #151B2E, ink #E6E9F2, muted #A3ABC4, line #2A3250, signal #8E88FF, shell #1B2547 (lighter than the ground so the bar still reads as a band), ok #6FBF7A, error #FF8A80; thread #8C98C8, stop #1C1A3A; pills #C4BEFF on #2C2866, #C1C7DA on #232A40, #8BD39A on #133022.

### Named Rules
**The One Meaning Rule.** Violet means «you can touch this» or «this waits for you». A notice is never violet; nothing decorative is violet; the only violet state is «En curso» on the person's own list. On the owner's progress list another person's «En curso» waits for nobody looking at it, so it takes the slate pill.

**The Single Source Rule.** Brand tokens are edited only in the factory's `design-system/assets/brand/` and synced; the reading column and the pills are among them. The portal sets its own tokens only in `css/portal.css`: the display size, the shell wordmark and the thread.

**The Words In The Pill Rule.** A state is always said in words inside its pill; the tint and the dot repeat it. Hollow grey ring «Por empezar», ink half-fill «La abrió», ink ring «En curso», green ring «Enviada», green fill «Recibida», struck grey ring «Reemplazada». The portal never uses the base's ink-filled dot: inside the pieces it means «Con observaciones».

## Typography

**Display Font:** Figtree at 700 for the page title only; no second family.
**Body Font:** Figtree (with system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif), variable 400–700, self-hosted.
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo, Consolas), only for the sign-in code.

**Character:** One friendly, even-handed grotesque that carries everything from the wordmark to the meta line; hierarchy comes from size and weight, never from a second family.

### Hierarchy
- **Display** (700, 32px from 672 px and 24px below, 1.2, -0.025em): the page's h1, so it leads above the 20 px sections.
- **Section** (600, 20px, 1.3): a section's h2 («Lo que se te pidió», «Decisiones»).
- **Subheading** (700, 16px, 1.4): a heading inside a section, such as «¿Falta algo?» under «Decisiones»; its field label stays 400 so it is the form's one bold line.
- **Item title** (600, 16px, 1.4): a row's title, a point's title.
- **Piece title** (700, 24px from 672 px and 20px below, 1.25, -0.02em, Indigo Ink): the piece screen's h1, the heading of its title band; it wraps and is never truncated.
- **Body** (400, 16px, 1.5): running text at the 40rem measure; inputs never below 16 px; choice words.
- **Small** (400 or 600, 14px): meta lines, pill words, hints, the «Nuevo» tag, «Entraste como …», field errors.
- **Brand** (600, 19px, line-height 1, -0.02em, lowercase «ninben»): only on the shell, beside a 22 px 亻, so «Salir» never outweighs it.

### Named Rules
**The Brand Is Not A Heading Rule.** The wordmark's combination (19 px, 600, tight tracking, on the shell) is never used by a heading, and the page title is always bolder and larger than it.

Running text wraps «pretty» and headings «balance».

## Layout

Mobile first, tiers at 672 px and 1056 px. The shell spans the window; its content (wordmark left; «Entraste como …» and «Salir» right) sits on the page margin (16 px below 672, 24 px from 672). Below 672 «Entraste como …» drops to its own line under the wordmark and «Salir». Under the shell everything sits in one centred **reading column** of at most 60rem; main pads 16 px (32 px from 672) above and 48 px below; blocks are 32 px apart; running text keeps the 40rem measure and forms the 440 px form measure. The piece screen keeps the column too: its frame band — the way back, the title band, its notices and the rule under them — sits in the same centred column, on the project page's left edge at every width, so moving from a project to a piece nothing jumps. Only the embedded piece's iframe takes the full window width (up to the frame), because the factory measures its pieces at that width, and the piece centres its own content in the same column. A piece published before the factory did so (2026-11-25) gets that centring from the bridge, which injects the same rule with a literal 60rem ahead of the piece's own styles. An approval sheet is the exception: an old one keeps two columns in «Computador», and in 60rem its screens would shrink to an unreadable 0.43, so it stays at the frame's width, off the band's edge, until it is resent. The iframe takes the height the piece posts, so the page scrolls, never the piece. Nothing is fixed or sticky.

Lists are rows between hairlines, each row a whole link ending in a 16 px chevron. Below 672 a row stacks (title, meta, pill); from 672 the pill sits on the title's line; from 1056 a row is four columns — title · state (fixed 9rem) · meta (up to 20rem) · chevron — so pills fall on the same x down every list. The owner's progress entries use the same 9rem state column (from 672) and leave the chevron column empty. Sections side by side share the width equally from 672.

### Named Rules
**The Reading Column Rule.** Under the shell, content never runs wider than 60rem, centred, the piece screen's frame band included. Only the embedded piece's iframe spans the full window width (the factory measures it so), and the piece centres its own content in the same column; for a piece published before that, the bridge does it, except an old approval sheet, which stays wide so its screens stay readable.

**The Same Column Rule.** From 1056 px every list's state lives in the 9rem column, so states line up down the screen.

## Elevation & Depth

Flat. Depth is never conveyed with shadows; surfaces are separated by the indigo shell, hairline rules and the one hairline panel (1 px `line`), and tints (the stop wash, the pill washes, notice tints mixed from the tone colour into the sheet). The only `box-shadow` uses are structural, not elevation: the masthead's spread shadow in its own colour that paints the bar to the window's edges, the inset ring of a checked choice, and the inset ring of an invalid field.

### Named Rules
**The No Lift Rule.** Nothing floats. Hover changes an underline or a border colour, never a shadow or a position.

## Shapes

Small, square-ish corners (4px) on buttons, inputs, notices, the «Decisiones» panel and tags; full round (999px) for the state pills, their dots and the choice marks. Borders are 1 px hairlines; the thread is a 2 px line whose cut ends curl through an 8 px quarter turn into 2.5 px knots. The quote inside «En qué se apoya» carries a 4 px rule on its start edge. Icons are drawn SVG strokes (the 亻, the back arrow, the row chevron, the fold chevron), never glyphs.

## Components

### Buttons
- **Shape:** gently squared (4px), 48 px tall, 8 px × 24 px padding, Figtree 600.
- **Primary:** Signal Violet fill, white words. The action that completes a task: send the code, verify, «Actualizar», «Enviar respuesta» on each point of «Decisiones», send a change request. Full width up to the form measure on sign-in and the empty home.
- **Secondary:** transparent, Indigo Ink words, Faded Ink border. Actions that reopen or add: «Cambiar respuesta», «Enviar propuesta».
- **On the shell («Salir»):** transparent, white words, a border halfway between Faded Indigo and the shell; hovered, the border goes white.
- **Disabled (while sending):** Hairline fill, Faded Ink words. A button missing an input keeps its normal look and moves focus to what is missing.
- **Focus:** 2 px Signal Violet outline, 2 px offset (Shell Violet on the shell).

### Chips
- **State pill:** full round, 4 px × 12 px, 14 px 600 words with the state's 10 px dot inside, tint and words per the pill tokens. Under forced colours the tint goes and the pill keeps a 1 px CanvasText border.
- **«Nuevo» tag:** Violet Wash background, Signal Violet words, 14 px 600, 4 px × 8 px, 4 px radius, as wide as its word. Other point marks («Cambió desde tu respuesta», «Ya lo confirmaste») are plain small Faded Ink text.
- **«N por responder»:** on a home row's state column, small 600 Signal Violet text; «Eres responsable» and «Todo enviado» in small Faded Ink.

### Cards / Containers
- **«Decisiones» panel:** one hairline panel holding the points — 1 px `line` border, 4 px radius, sheet fill, no shadow, a rule between points, 16 px padding per point (24 px from 672). The lead sits above it; the proposal form («¿Falta algo?») follows below it, outside.
- **Notices:** 4 px radius, the sheet tinted by tone (information: sheet with grey edge; warning: 6 % ink; error and ok: 10 % of their colour, edge at 55 %), 1 px border, never a coloured stripe on one side, 12 px × 16 px padding.
- **Lists** have no container, only rules.

### Inputs / Fields
- **Style:** 1 px Faded Ink border, sheet background, 4 px radius, 48 px tall, 16 px text, violet caret. Labels 600 above (400 in the proposal form); hints in small Faded Ink.
- **Focus:** the 2 px Signal Violet outline.
- **Error:** Error Red border plus a 1 px inset ring, and a small 600 error line under the field.
- **Code input:** JetBrains Mono at 24 px, 0.3em tracking, tabular figures.
- **Choices:** radio rows of 48 px, words in regular weight; the real radio lies invisible over the row and the mark is drawn: a 20 px Faded Ink ring, checked as a violet fill with a 4 px sheet-coloured inner ring (Highlight under forced colours); the whole row shows the focus. Two by two below 672, one wrapping line above.

### Navigation
- **Masthead:** the indigo shell across the window, 64 px tall (taller on a phone with «Entraste como …» on its own line); the wordmark (22 px 亻 in Shell Violet + 19 px «ninben») links home on the left; «Entraste como …» and «Salir» on the right.
- **Way back:** «← Tus proyectos» / «← Volver» above the title in Faded Ink 600 with a drawn arrow, 44 px target; hovered, Indigo Ink and underlined.
- **Row links:** the whole row is the link, ending in a chevron (Faded Ink, Signal Violet on a stop row); its title underlined on hover. In «Lo que se te pidió» a title is Signal Violet only on a stop row and Indigo Ink otherwise; on home project titles are Signal Violet; owner entries are Indigo Ink names with their own links.
- **Fold («En qué se apoya»):** a violet chevron that turns 90° when open, only the words underlined, a 44 px summary.

### The Thread (signature)
Drawn only on «Lo que se te pidió», the list of what was asked of the signed-in person; never on the owner's progress list or any other. A 2 px Thread Indigo line runs down a track at the list's left (24 px below 672, 36 px from 672; row text starts at 32 / 48 px). Beside «Enviada» and «Recibida» rows the thread is whole and meets the next row's over the rule. At «Por empezar» and «En curso» rows it is cut: the 20 px violet 亻 disc sits in the gap, its centre level with the middle of the row title's first line at every width (beside the title on a phone too, not at the meta line), and the row takes the Stop Wash, a violet title and a violet chevron (from 672 px with an extra step of padding above and below). A cut end — the upper one curling left, the lower one curling right, each with a knot — is drawn only on a side where the thread goes on inside the list, toward an adjacent row that is whole. Nothing is drawn above a stop that is the list's first row, below one that is its last, or between two adjacent stop rows, so a cut never shows a loose hook: a list where everything waits shows only its discs, one per row, and no line; a stop between two whole rows keeps both ends. The thread is decorative and `aria-hidden`; the row's words and pill carry the state. Under forced colours the tint and knots drop, the line takes the system text colour and the disc is drawn in CanvasText with the 亻 in Canvas. No motion.

## Do's and Don'ts

### Do:
- **Do** take every brand token from the factory's `design-system/assets/brand/` source and sync it; treat `brand/` as generated, and keep the portal's own tokens in `css/portal.css`.
- **Do** keep violet for actions, links and what waits for the person, and say every state in words inside its pill.
- **Do** keep content in the centred 60rem reading column under the full-width shell, running text at 40rem and forms at 440 px.
- **Do** put every list's state in the 9rem column from 1056 px (from 672 px on the owner's entries).
- **Do** draw the thread only on «Lo que se te pidió», cut with the 亻 disc at «Por empezar» and «En curso», whole at «Enviada» and «Recibida».
- **Do** hold the accessibility floor: no sideways scroll or cut content from 320 to 1440 px, 48 px controls, 44 px links, visible focus, axe clean and AA in light, dark and forced colours.
- **Do** draw icons as SVG strokes.

### Don't:
- **Don't** edit `brand/ninben.css` or `brand/ninben-components.css` in the portal, or set a brand token in `css/portal.css`.
- **Don't** use shadows for elevation, coloured side stripes on notices, or texture or fabric imagery.
- **Don't** use the ink-filled status dot in the portal, or carry a state by colour alone.
- **Don't** make a state other than «En curso» on the person's own list violet, or a notice violet.
- **Don't** draw the thread on lists about other people (the owner's progress list) or animate it.
- **Don't** add a second type family; JetBrains Mono is only for typed figures.
