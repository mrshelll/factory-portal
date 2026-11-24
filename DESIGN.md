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
  bg: "#FFFFFF"
  sheet: "#FFFFFF"
  ink: "#151B30"
  muted: "#535B78"
  line: "#E4E6F0"
  line-strong: "#C9CDDD"
  ok: "#17663B"
  error: "#B42318"
typography:
  title:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  section:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  item-title:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  small:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  brand:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "16px"
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
    textColor: "{colors.signal}"
    typography: "{typography.item-title}"
    padding: "16px 0"
    height: "56px"
  list-row-stop:
    backgroundColor: "{colors.stop}"
    textColor: "{colors.signal}"
    padding: "24px 12px 24px 48px"
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

ninben is named for 亻, the stroke «person» that turned «to move» into jidoka: the loom stops by itself when a thread breaks, and a person decides. The portal is that stop. An aizome-indigo shell frames a white, undyed-cotton work area; inside it, one thread runs down the list of what was asked of the signed-in person and breaks exactly where the factory waits for them, with the violet 亻 disc sitting in the gap. Everything else is calm and exact: hairline rules, small radii, one family, no texture, no fabric imagery, no motion beyond standard hover and focus.

Density is that of a working list, not a dashboard: rows of 56 px or more, a 32 px gap between blocks, text kept to a reading measure. Violet is reserved for what can be touched (actions, links, row titles) and for the person's stop; it never decorates. State is said in words and repeated by a small dot, never carried by colour alone.

**Tokens are not this project's to invent.** `brand/ninben.css`, `brand/ninben-components.css`, `brand/logo.svg` and `brand/fonts/` are a generated copy (by `scripts/sync-brand.mjs`) of the single source in the factory repo, `software-factory/design-system/assets/brand/`, shared with the factory's pieces. That source is authoritative for every brand token: colours (light and dark), radius, fonts, the text sizes, the spacing scale, the frame and the shared components. Change a brand token there and sync; never edit the copy in `brand/`. Only the thread's two colours (`thread`, `stop`) and the portal's own layout live in `css/portal.css`.

**System constraints, not choices.** The type scale (14/16/20/24), the 4/8-based spacing scale, the 4 px radius, the 44 px link and 48 px control targets, the 672 px breakpoint and the frame rules (page margin 16/24 px at every width, frame capped at 1392 px + margins, nothing cut from 320 to 1440 px, title band ending at 160 px or less on a phone) come from the factory's visual manual and are measured by its verifier and the portal's browser tests. Do not tune them per screen.

**Key Characteristics:**
- Indigo shell (full-bleed top bar) over a white cotton work area; light and dark schemes from the same roles.
- One accent, violet, meaning «you can touch this» or «this waits for you».
- The thread: the portal's only signature, drawn on one list only.
- Flat: hairline rules and tinted rows, no shadows for depth.
- One family (Figtree), JetBrains Mono only for figures typed by the person (the sign-in code).

## Colors

Indigo and undyed cotton: an indigo-tinted neutral ramp, one violet signal, green only for what arrived.

### Primary
- **Signal Violet** (`signal`): every action and link — the primary button, link text, row titles, the focus ring, a checked choice, the fold chevron — and the fill of the 亻 disc at the person's stop. Its tint, **Violet Wash** (`soft`), backs the «Nuevo» tag and the text selection.
- **Shell Violet** (`signal-on-shell`): the 亻 stroke and the focus ring on the indigo shell, where Signal Violet would not hold contrast.

### Secondary
- **Aizome Shell** (`shell`): the top bar, painted to the window's edges. Text on it is white (`on-shell`); quiet parts take **Faded Indigo** (`on-shell-muted`), and «Salir»'s border sits halfway between Faded Indigo and the shell.
- **Thread Indigo** (`thread`, portal-owned): the 2 px thread and its knots. **Stop Wash** (`stop`, portal-owned): the tint of a row where the thread is cut.

### Tertiary
- **Received Green** (`ok`): the «Enviada» ring and the «Recibida» filled dot, and a notice that went well. Never an action colour.
- **Error Red** (`error`): invalid fields (border plus a 1 px inset ring) and error notices.

### Neutral
- **Cotton** (`bg`, `sheet`): the page and every sheet; white in light, deep indigo-night in dark.
- **Indigo Ink** (`ink`): text, the secondary button's words, the «En curso» ring.
- **Faded Ink** (`muted`): meta lines, hints, the way back, field borders, the «Por empezar» ring.
- **Hairline** (`line`) and **Strong Hairline** (`line-strong`): rules between rows and around notices; the disabled button's fill.

Dark scheme (same roles, from the brand source): bg #0F1424, sheet #151B2E, ink #E6E9F2, muted #A3ABC4, line #2A3250, signal #8E88FF on #0F1424, shell #1B2547 (lighter than the ground so the bar still reads as a band), ok #6FBF7A, error #FF8A80; thread #8C98C8, stop #1C1A3A. All text pairs are AA, checked by the brand source's contrast eval.

### Named Rules
**The One Meaning Rule.** Violet means «you can touch this» or «this waits for you». A notice is never violet; a status is never violet; nothing decorative is violet.

**The Single Source Rule.** Brand tokens are edited only in the factory's `design-system/assets/brand/` and synced. The portal sets exactly two colours of its own: the thread and the stop wash.

**The Words First Rule.** A state is always said in words; the dot only repeats it. Hollow muted ring «Por empezar», ink half-fill «La abrió», ink ring «En curso», green ring «Enviada», green fill «Recibida», struck grey ring «Reemplazada». The portal never uses the base's ink-filled dot: inside the pieces it means «Con observaciones».

## Typography

**Display Font:** none; the system has no display role.
**Body Font:** Figtree (with system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif), variable 400–700, self-hosted.
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo, Consolas), only for the sign-in code.

**Character:** One friendly, even-handed grotesque that carries everything from the brand word to the meta line; hierarchy comes from four sizes and two weights, never from a second family.

### Hierarchy
- **Title** (600, 24px, 1.25, -0.02em): the page's h1. On a phone a point's page drops it to 16 px with normal tracking so a long title still ends the band in time.
- **Section** (600, 20px, 1.3): a section's h2 («Lo que se te pidió», «Decisiones»).
- **Item title** (600, 16px, 1.4): a row's title, a point's title, a piece's title in its bar.
- **Body** (400, 16px, 1.5): running text, at a reading measure of 40rem; inputs never below 16 px.
- **Small** (400 or 600, 14px): meta lines, status words, hints, the «Nuevo» tag, field errors.
- **Brand** (600, 16px, line-height 1, -0.02em, lowercase «ninben»): only beside the 亻 stroke.

### Named Rules
**The Four Steps Rule.** Text takes 14, 16, 20 or 24 px and nothing else; weights are 400 and 600.

**The Brand Is Not A Heading Rule.** No heading takes the brand's combination (16 px, 600, tight tracking), so the logo never reads as a title.

Running text wraps «pretty» and headings «balance».

## Layout

Mobile first, one breakpoint at 672 px, and a table tier at 1056 px. Every block, the masthead's content included, starts on the frame's left edge: page margin 16 px below 672 and 24 px from 672, frame capped at 1392 px plus margins and centred. Blocks are separated by 32 px; main pads 32 px above and 48 px below. Text keeps the 40rem reading measure; forms keep the 440 px form measure.

Lists are rows between hairlines. Below 672 a row stacks (title, meta, state); from 672 it is one line with the state on the right; from 1056 every list row becomes three equal columns (title · meta · state), so states fall on the same x down every list of a screen, and a list with no meta line uses two. «Decisiones» follows the same three columns (title and mark · what was decided · the answer); its choices are two-by-two below 672 and one wrapping line above.

Sections side by side share the width equally from 672. Nothing in the frame is fixed or sticky; a piece's iframe takes the height the piece posts and the page scrolls, never the piece.

### Named Rules
**The One Edge Rule.** Brand, way back, title, lists, forms and an embedded piece's content all start on the same left edge at every width.

**The Measured Frame Rule.** Margins, the 672 tier, the 160 px title band on a phone and nothing cut at 320 px are verified by tests; a change to them is a deliberate test change, never a silent one.

## Elevation & Depth

Flat. Depth is never conveyed with shadows; surfaces are separated by the indigo shell, hairline rules (1 px `line`), and tints (the stop wash, notice tints mixed from the tone colour into the sheet). The only `box-shadow` uses are structural, not elevation: the masthead's spread shadow in its own colour that paints the bar to the window's edges, the inset ring of a checked choice, and the inset ring of an invalid field.

### Named Rules
**The No Lift Rule.** Nothing floats. Hover changes an underline or a border colour, never a shadow or a position.

## Shapes

Small, square-ish corners (4px) on buttons, inputs, notices and tags; full round (999px) only for the status dots and choice marks. Borders are 1 px hairlines; the thread is a 2 px line whose cut ends curl through an 8 px quarter turn into 2.5 px knots. The quote rule inside «En qué se apoya» is the 4 px mark on its start edge. Icons are drawn SVG strokes (the 亻, the back arrow, the fold chevron), never glyphs.

## Components

### Buttons
- **Shape:** gently squared (4px), 48 px tall, 8 px × 24 px padding, Figtree 600.
- **Primary:** Signal Violet fill, white words. One per view, the view's main action (send the code, verify, «Actualizar», send a change request); full width up to the form measure on forms.
- **Secondary:** transparent, Indigo Ink words, Faded Ink border. Used for per-item actions («Enviar respuesta» on each point, «Cambiar respuesta», «Enviar propuesta»).
- **On the shell («Salir»):** transparent, white words, a border halfway between Faded Indigo and the shell; hovered, the border goes white.
- **Disabled (while sending):** Hairline fill, Faded Ink words. A button missing an input keeps its normal look and moves focus to what is missing.
- **Focus:** 2 px Signal Violet outline, 2 px offset (Shell Violet on the shell).

### Chips
- **«Nuevo» tag:** Violet Wash background, Signal Violet words, 14 px 600, 4 px × 8 px, 4 px radius, as wide as its word. Other point marks («Cambió desde tu respuesta», «Ya lo confirmaste») are plain small Faded Ink text.
- **Status:** a 10 px dot with a 2 px ring plus the state word in 14 px; never a filled pill.

### Cards / Containers
- **Corner Style:** 4px on notices; lists have no container, only rules.
- **Background:** the sheet; notices tint it with their tone (information: sheet with grey edge; warning: 6 % ink; error and ok: 10 % of their colour, edge at 55 %).
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1 px, never a coloured stripe on one side.
- **Internal Padding:** 12 px × 16 px.

### Inputs / Fields
- **Style:** 1 px Faded Ink border, sheet background, 4 px radius, 48 px tall, 16 px text, violet caret. Labels 600 above; hints in small Faded Ink.
- **Focus:** the 2 px Signal Violet outline.
- **Error:** Error Red border plus a 1 px inset ring, and a small 600 error line under the field.
- **Code input:** JetBrains Mono at 24 px, 0.3em tracking, tabular figures.
- **Choices:** each a 48 px row, the radio invisible over it; a 20 px ring in Faded Ink, checked as a violet fill with a 4 px sheet-coloured inner ring; the whole row shows the focus.

### Navigation
- **Masthead:** the indigo shell across the window, 64 px tall; the logo (亻 in Shell Violet + «ninben») links home on the left, «Salir» on the right. No signed-in identity line.
- **Way back:** «← Tus proyectos» / «← Volver» above the title in Faded Ink 600 with a drawn arrow, 44 px target; hovered, Indigo Ink and underlined. On a project's page it is hidden below 672 (the logo already goes home).
- **Row links:** the whole row is the link; its title in Signal Violet 600, underlined on hover.
- **Fold («En qué se apoya»):** a violet chevron that turns 90° when open, only the words underlined, a 44 px summary.

### The Thread (signature)
Drawn only on «Lo que se te pidió», the list of what was asked of the signed-in person; never on the owner's progress list or any other. A 2 px Thread Indigo line runs down a track at the list's left (24 px below 672, 36 px from 672; row text starts at 32 / 48 px). Beside «Enviada» and «Recibida» rows the thread is whole and meets the next row's over the rule. At «Por empezar» and «En curso» rows it is cut: the upper end curls left and the lower end curls right, each with a knot, the 20 px violet 亻 disc sits in the gap, and the row takes the Stop Wash (from 672 px with an extra step of padding above and below). Between two adjacent stop rows the thread stays open, with no ends or knots drawn on the facing sides, so the gap reads as one cut. The thread is decorative and `aria-hidden`; the row's words and dot carry the state. Under forced colours the tint and knots drop, the line takes the system text colour and the disc is drawn in CanvasText with the 亻 in Canvas. No motion.

## Do's and Don'ts

### Do:
- **Do** take every brand token from the factory's `design-system/assets/brand/` source and sync it; treat `brand/` as generated.
- **Do** keep violet for actions, links and the person's stop, and say every state in words with its dot.
- **Do** keep text on the 14/16/20/24 scale, spacing on the 4/8 scale, controls at 48 px and links at 44 px.
- **Do** start every block on the frame's left edge and keep running text at the 40rem measure.
- **Do** draw the thread only on «Lo que se te pidió», cut with the 亻 disc at «Por empezar» and «En curso», whole at «Enviada» and «Recibida».
- **Do** draw icons as SVG strokes and keep AA contrast in both schemes, including forced colours.

### Don't:
- **Don't** edit `brand/ninben.css` or `brand/ninben-components.css` in the portal, or set a brand token in `css/portal.css`.
- **Don't** use shadows for elevation, coloured side stripes on notices, or texture or fabric imagery.
- **Don't** use the ink-filled status dot in the portal, or carry a state by colour alone.
- **Don't** draw the thread on lists about other people (the owner's progress list) or animate it.
- **Don't** add a second type family or a display face; JetBrains Mono is only for typed figures.
- **Don't** put «Decisiones» in a panel: its parts span their columns and its forms keep the form measure at the part's edge (manual MAR-09, MAR-12).
