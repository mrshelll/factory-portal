# Factory portal

A static web portal where external people invited to a software-factory (ninben) project sign in
with their email and an 8-digit code, and work the HTML "pieces" the factory generates (question
sheets, flow reviews, demo reviews) directly in the browser. Progress is saved as a draft and the
result is sent to Supabase, instead of downloading a JSON file and sending it by chat.

Served with GitHub Pages at https://mrshelll.github.io/factory-portal/.

## What is (and is not) in this repository

- Only static files: HTML, CSS and JavaScript ES modules. No build step, no bundler.
- **No data.** Projects, members, pieces, drafts and responses live in Supabase.
- `config.js` holds the Supabase URL and the **publishable** key. That key is public by design; it
  only identifies the project. **Security lives in Supabase Row Level Security (RLS)**: a signed-in
  person can only read their own rows, and can only write through the `save_draft` and
  `submit_response` functions. Never put any other key in this repository.
- supabase-js is loaded from jsDelivr at a pinned version (`@supabase/supabase-js@2.117.2`).
- `brand/` is a generated copy of the ninben brand (see [Brand](#brand)); the schema lives in
  `supabase/migrations/` (see [Database migrations](#database-migrations)).

## Run it locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

It must be served over http(s): the bridge uses the page origin to talk to the piece, and a `file://`
page has none. Sign-in sends a real email, so it needs a real inbox and the Supabase project.

## How it works

1. **Sign in**: email, then `signInWithOtp` sends an 8-digit code, then `verifyOtp`. The code length
   is `EMAIL_OTP_LENGTH` in `config.js` and must match Authentication > Providers > Email > "Email OTP
   Length" in the Supabase dashboard (this project uses 8). The session
   persists and refreshes on its own (supabase-js defaults). Supabase allows one email per 60 s; the
   code screen shows the countdown and survives a reload (the pending email is kept for one hour).
2. **Home** («Tus proyectos»): the projects the person belongs to, one row each, with what is left to
   answer; a project the person owns says so (with its people and the last response).
   The lists never fetch `pieces.html`; it is fetched only when a piece is opened.
3. **A project's page** (`#/project/<id>`): first, under the title band, the line «El responsable del
   proyecto ve cuándo abres lo que te compartimos y lo que envías.» (`projectOwnerSees`; an owner with
   nothing asked of them does not get it); then the person's own items under «Lo que se te pidió», grouped
   as before, with status (not started, in progress, sent, received) and date. Every item opens
   at `#/piece/<id>`. The owner's part comes last. See **The owner's part** below.
4. **Piece**: rendered in `<iframe sandbox="allow-scripts allow-downloads allow-modals allow-forms allow-popups allow-popups-to-escape-sandbox">`
   (no `allow-same-origin`) through `srcdoc`, with a bridge script injected first in its `<head>`.
   The popup flags let a piece open a `target="_blank"` link (the demo sheet opens the prototype) as a
   normal tab. The screen keeps the portal's frame: the same masthead with the ninben brand as every
   screen, then the way back to the piece's project («← <project name>»; «← Tus proyectos» when its name cannot be
   read) and the piece's title with its save line («Guardando…», «Guardado»), the way back and the title on the brand's
   left edge. On a
   phone (below 672 px) the frame takes the least it can, with nothing cut (the manual's MAR-14): the way back reads
   «← Volver», one line, and its accessible name says where («Volver a <project>»); the title is never cut (a title
   of two lines ends the band at 160 px or less of a 640 px screen; the factory's publisher keeps titles to that); and
   the line next to the title, the save line («Guardando…», «Guardado») or on the owner's screen «Lo que envió … el …»,
   goes in the row of «← Volver», on its right and set to the row's end, in small text, so it never takes a row of its
   own under the title: with a title of 60 characters the band ends at 151 px at rest and with «Guardado» showing (on the
   owner's screen too, 155 px with a sender's name of 59 characters, which wraps in that row); a failed save
   wraps in that row as well: without connection («Sin guardar: no hay conexión. …», two lines) the title still ends at
   151 px, and so it does with a change too long to keep («Sin guardar: texto muy largo. …», two lines). From 672 px the line goes under the
   title. The brand in the masthead is a link to home («Tus proyectos», named «ninben, ir a Tus proyectos», `aria-current="page"`
   on home itself). Below 672 px the project's page has no «← Volver» (home is one tap on the brand), so a name of
   two lines ends its title at 141 px. The iframe is as
   tall as the piece (the height the bridge posts; until the first one, what is left of the screen under the frame)
   and the portal's page scrolls, never the piece: nothing of the frame is fixed or sticky, so on a phone it goes up
   with the page. The piece's scroll requests move the portal's page (`followPiece` in `js/app.js`): a position is
   kept inside the piece's last height, a request with `ifNeeded` scrolls only if its stretch is out of the window
   (the visual viewport, which a phone's keyboard shortens), and the page scrolls at once, so a step's
   `scrollTo(0, 0)` and its title's focus right after it move the page once. A failed save is said on the save line
   («Sin guardar: …», in the row of «← Volver» on a phone, where it may wrap; under the title from 672 px) and
   announced to screen readers by the screen's status region; it is not a notice, and nothing floats or stays fixed
   for it. The
   iframe takes the frame's box (margins included, so as wide as the window up to 1440 px, and centred above it), and the factory's pieces, inside the portal, start their content at the frame's
   margin (16 px, 24 px from 672 px), on the brand's edge, keeping their reading measure. The piece does
   not show its own brand bar there (see **Host** below); the save line does not repeat the send date,
   which the piece shows on its own sent screen, and says nothing until the person changes something.
   Only when the server has a send that the piece's saved draft cannot show (the draft was last saved
   at or before it, or there is none: the piece did not get to save its «sent» mark) does the line say
   «Enviada el …», until the person changes something or sends again.
5. **A replaced version** (the factory published a newer one; the project's page lists the old one only if the
   person had sent it) still opens from an old email or a tab left open, and can still send. Until it is sent, a
   fixed notice says there is a newer version, links to it (the newest piece of the same kind in the project among the
   person's own assignments, or the list), and the status line reads «Guardado aquí, sin enviar»: a
   draft saved there never reaches the factory, only a send does.

### The owner's part

Routes: `#/` (home), `#/project/<id>`, `#/piece/<id>` and `#/project/<p>/piece/<x>/person/<m>` (the owner
reading one person's send). The routes are pure functions in `js/project.js`.

The owner of a project (the member with `role = 'owner'`, which the factory sets after a publish through `factory_set_owner`) sees,
besides their own items, the section «Avance de lo que compartiste»: per piece, one entry per person
assigned, with their state («Por empezar», «La abrió», «En curso», «Enviada», «Recibida» or «Reemplazada») and a
date that says what it is («Recibida el …», «Envió el …», «La abrió el …», «Último cambio el …», «Compartida el …»). A
change request («pidió un cambio el …») and a send after the close («la reenvió el …») are said by their date, never their
text. Below 672 px each entry is two lines: the name with the state on its right, then the date line. Names are plain text; a send the owner can read carries the link «Ver lo que
envió» next to the name, which opens the same piece, closed and read only, with «Lo que envió <name> el <date>» in the title band. The owner never
responds, saves or sends for anyone: that screen posts nothing.

**What the owner never sees: drafts.** Not `piece_drafts`, not a response with `partial = true`, not the
storage of a change request. A person whose only responses are partial, or whose send predates the stored
`storage`, shows state and date but no link to open: the piece is never seeded with a draft. An old piece
(stored before the bridge had the observer mode) still opens closed and read only.

**How «La abrió» is recorded.** The first time the assigned person opens the piece in the portal while it is open
(not closed: neither received nor replaced), the portal calls `mark_piece_opened`, which sets `first_opened_at` on
that assignment once (a second open keeps the first date; status and `updated_at` do not change). Opening a closed
piece records nothing. It does not count when the person opens the email, nor when the owner opens someone's
piece. An assignment from before the migration has no date and shows none. If the call fails
(network, expired session, a database without the function) the piece opens and works anyway.

All of this reads through `security definer` functions that first check the caller is the project's owner
(`owner_projects`, `owner_project`, `owner_piece`); no policy was added to the tables. A person who owns one
project and is asked things in another sees the owner's part only in the first. The owner's own items in their
project are normal pieces (drafts, send), and opening them records their own «La abrió».

Text shown to people follows the project language (`projects.language`, `es` or `en`); before the
project is known (sign-in), the browser language is used, Spanish by default. All strings live in
`js/i18n.js`.

### The bridge (`js/bridge.js`)

The piece runs in an opaque origin, so it cannot see the portal's storage or session, and its own
`localStorage` throws a `SecurityError`.

- **Persistence.** The bridge replaces `window.localStorage` with an in-memory Storage shim seeded
  from `piece_drafts.storage`, using `Object.defineProperty(window, "localStorage", { value, configurable: true })`
  (on `Window` the property is configurable, so the bare identifier `localStorage` then resolves to
  the shim). It checks that the replacement took and reports it to the portal (`factory:ready`,
  `persistence`); if it did not, the portal warns that progress will not be kept. The first change
  posts `{ type: "factory:dirty" }` at once (no content), so the portal knows there is unsaved work
  and warns before the page closes; the full `{ type: "factory:draft", storage }` follows after
  800 ms of quiet. What the piece writes while it opens (restoring, stamping the opening time,
  probing the storage, until one task after `DOMContentLoaded`, when `factory:ready` is posted) posts
  nothing on its own: it is not the person's doing, so the portal does not say «Guardando…» for it
  and the piece stays «Por empezar» until a real change, which carries those writes along. The portal calls
  `save_draft` (one request at a time, newest data wins, retries when offline). The draft is also
  flushed when the person leaves the piece or the page is hidden. `sessionStorage` gets the same
  shim without persistence.
- **Too large to keep.** The shim holds up to 900,000 characters (keys + values,
  `STORAGE_QUOTA_CHARS`). A write past that throws `QuotaExceededError` in the piece, as a real
  `localStorage` does, and stores nothing. The bridge sends the pending draft and posts
  `{ type: "factory:save-failed", reason: "too-large" }` once; more refused writes stay quiet until a
  write that fits, and a refusal after that posts again. A write that fits counts even when it equals
  the stored value (the person undid a paste back to what was saved): it sends a draft too. The portal's status line then says the
  change was not saved and suggests shortening the last text or downloading a copy (the live region
  announces it). A later save of a draft from before the refusal does not bring back «Saved»; the
  line leaves that state once a change that fits has been through the save queue.
- **Sending.** The piece has the only "Send" button. It calls `globalThis.factorySubmit(payload)`
  (opened outside the portal, a piece finds no `factorySubmit` and offers its own download instead),
  which the bridge defines: it checks the payload against the piece kind (`respuestas-fabrica/1`,
  `ux-flows.md`, `revision-demo/1`) and size, sends the pending draft, and posts
  `{ type: "factory:submit", requestId, payload }`. The portal waits up to 3 s for that draft to be
  saved, calls `submit_response` and answers `{ type: "factory:submit-result", requestId, ok, error? }`.
  The promise resolves `{ ok: true }` only after the server saved; otherwise `{ ok: false, error }`
  with `invalid`, `too-large`, `timeout` (no answer in 45 s), `network`, `session-expired` (the
  portal also offers to sign in again) or `rejected`. A second call while one is in flight returns
  the same promise. The piece shows its own sent screen, with the send date; the portal's status line
  does not repeat it (except for a send the saved draft cannot show, see **Piece** above). Downloads are not touched, so the piece's own "Download a copy" stays as the fallback.
- **Host.** The bridge also defines a frozen `globalThis.factoryHost = { persistence, reviewerName }`:
  `persistence` is `"server"` when the storage shim took (else `"none"`), and `reviewerName` is the
  member's `project_members.display_name` (or `null`). Before anything of the piece is parsed, it sets
  `data-factory-host="portal"` on the piece's `<html>`: the factory's pieces hide their own brand bar
  with it (the portal's masthead already shows the brand) and move their content to the portal's
  edge, from the first paint. The flow review keeps
  «Ver todos los flujos» inside a flow, without the logo, and its bar is then not a banner landmark
  (`role="none"`), so the portal's masthead is the only one. Opened on its own, a piece shows its bar.
- **Closed pieces.** `factoryHost` also carries `closed` and `sentAt`. `closed` is `"received"` (the
  factory collected the response and is using it) or `"replaced"` (a newer version replaced it) when
  the piece opens read-only, and `null` otherwise; anything else the portal passes becomes `null`.
  `sentAt` is when the person sent it, an ISO string, or `null` (also when `Date.parse` rejects it).
  The portal sanitizes both before injecting them. With `closed` set the bridge posts no
  `factory:draft`, `factory:dirty` nor `factory:save-failed`: the piece may still write the shim (in
  memory), but nothing leaves the iframe, so the server draft keeps the person's unsent changes.
  `factory:flush` still answers `factory:flushed`, and `factorySubmit` still sends (the server turns a
  send after the close into a late change request). Old pieces ignore both fields.
- **Size and scrolling.** The portal sizes the iframe to the piece's height and its own page scrolls,
  so the piece never scrolls inside. Right after `factory:ready`, and on every change after it
  (a `ResizeObserver` on the piece's `<html>`), and once on the window's `load` and once on
  `document.fonts.ready` (with or without the observer), the bridge posts
  `{ type: "factory:height", height }`: whole px, the height of the piece's `<html>` box (not its
  `scrollHeight`, which never drops below the iframe's own height, so a shorter step could never
  shrink the frame back), never the same value twice in a row, and never 0: in Chrome the frame can
  have no size yet when the piece opens, and the first real height then comes with its first layout,
  a moment after `factory:ready`. A change in the same direction as a change of the iframe's height
  alone, in the same rendering frame, is not posted: it follows the frame (a piece sized with `vh`
  would grow forever otherwise). A change of the piece's own can come in that same frame too (it
  grew again while the portal gave the iframe its last height): when the guard held a measure back
  and the piece's DOM changed since the last height posted (a `MutationObserver` on `<html>`), the
  bridge measures once more when that frame is over, once, so a piece that touches its DOM and
  grows with its frame on every resize grows one step at most. A growth that changes no DOM (the
  brand's font arriving as the portal resizes the iframe) is what `load` and `fonts.ready` catch: each
  measures once, and if the guard holds that measure back, it is taken again once that frame is over,
  also once, so neither can loop. The portal gives the iframe exactly
  that height and nothing else (no minimum of the screen's): the guard counts on it. The piece's scrolling becomes
  `{ type: "factory:scroll", top, bottom?, ifNeeded? }`, in px from the piece's top:
  `window.scrollTo` / `window.scroll` (numbers or options, when they ask for a top; the pieces call
  `scrollTo(0, 0)` on every step change), `scrollIntoView` (the element's top; with
  `block: "nearest"` also its bottom and `ifNeeded`), a plain click on a link to `#id` of the piece
  (the target's top, `0` for `#` and `#top`; the iframe neither navigates nor changes its hash, and
  focus moves to the target as a browser would, without scrolling, with `tabindex="-1"` added only
  to a target that takes no focus and has no tabindex) and
  `focusin` on a control (its top and bottom with `ifNeeded: true`: the portal scrolls only if that
  stretch is out of its window). The piece's own calls still run. While the piece opens nothing of
  this is posted, so its start-up `scrollTo(0, 0)` does not move the portal's page. The portal
  rounds heights and positions and caps them at 200,000 px (`MAX_PIECE_HEIGHT`) and gives `mountPiece` handlers
  `onHeight(height)` and `onScroll({ top, bottom, ifNeeded })` (`bottom` is `top` when the piece
  gave none).
- **Messages.** Each mounted piece gets a random nonce (`crypto.getRandomValues`) inside its
  injected config. The portal only accepts messages whose `event.source` is the piece iframe and that
  carry that nonce, with a known type (`factory:ready`, `factory:dirty`, `factory:draft`,
  `factory:save-failed`, `factory:submit`, `factory:flushed`, `factory:height`, `factory:scroll`),
  the expected shape and under 1 MB. The bridge only posts to the
  portal's origin and only accepts messages (`factory:flush`, `factory:submit-result`) from its
  parent, from the portal's origin, with the nonce. If the iframe loads a
  second document (the piece navigated away or reloaded), the portal removes it and offers to reopen.

**Closed pieces in the portal.** A piece is closed when its assignment is `received`, or `replaced`
after the person sent it (a response with `partial = false`; a replaced version with only a draft the
factory collected stays open, as before). The list says «Recibida» for both (a replaced one adds «Hay
una versión más nueva»), «Pediste un cambio el …» when there is a change request, and leaves them out
of «por responder». A closed piece opens with the storage of the newest response sent (the draft only
when that response has none), `closed` and `sentAt` set, and a pinned notice that says why it cannot
change here (replaced: that what was sent already arrived, with the newer version's link) with «Pedir un
cambio»: a form with a required text of up to 4000 characters that calls `request_change`, and «Cancelar»,
which closes it keeping the text. When the server draft is newer by more than 5 s than both that response
and the newest change request (a late send already carried the draft), the form says the unsent changes
go with the request and sends that draft as `p_storage`, once. If `request_change` answers 55000 (the
factory reopened the piece meanwhile), the piece opens again as it is now. The notices and the form are content
of that moment: they scroll with the page, and on a phone with the form open both the form and the piece are reached
by scrolling. Every send passes the piece's storage to `submit_response`; when the id it returns is
a change request (the piece closed meanwhile), the piece hears ok and opens again, closed, saying once
that the send arrived as a change request. The rules are in `js/closure.js`.

Reopening a piece waits briefly for a save still in flight and always starts from the newest copy
seen in the tab. When the session ends (it expired, or it was closed elsewhere), the open piece
hands over its last change first, and every draft the server has not confirmed stays in the tab: it
is saved as soon as the same account signs in again. A draft is only ever saved with its owner's
session: if another account signs in on that tab, the previous account's drafts are set aside (never
sent with the new session, never shown to it) and are saved when their owner signs in again. Leaving
the page with such a draft still asks for confirmation. Signing out first tries to save pending drafts; if that is not possible
(offline), the page asks before discarding them. Sign-out always ends on a clean sign-in screen:
with scope `local`, supabase-js removes the local session even when the network call fails.

## Brand

The portal wears the ninben brand: its colours (light and dark), the 4 px radius, Inter and JetBrains
Mono, the logo in the masthead, and the components it shares with the factory's pieces. The single
source lives in the software factory repo, in `design-system/assets/brand/` (`ninben.css`,
`ninben-components.css`, `logo.svg`, `fonts/`). `brand/` here is a generated copy; never edit it by
hand:

```sh
node scripts/sync-brand.mjs --from <path to the software factory repo> --check   # 0 equal, 1 differs
node scripts/sync-brand.mjs --from <path to the software factory repo> --write   # copy what differs
```

`--write` copies only what changed, removes files that are no longer in the source, writes each file
atomically and is safe to run twice; `--check` names every file that differs. Both exit 2 on bad
usage or a broken source (for example, a font that `ninben.css` names is missing, or a
`ninben-components.css` that is missing, empty or has an `@import` or a `url(`), before writing
anything. `index.html` loads `brand/ninben.css`, then `brand/ninben-components.css`, then
`css/portal.css`; the fonts are referenced as
`url("fonts/…")` relative to that CSS, so GitHub Pages serves them from `brand/fonts/` (their SIL Open
Font License texts travel with them). The logo is read once from `brand/logo.svg` and placed inline,
so its stroke follows the brand's signal colour in light and dark. `brand/ninben-components.css` is the
base the portal and the three pieces share: the three text sizes, the 4/8 spacing scale, the frame, and
the notices, fields, buttons, actions, rows and status (`.status--done` once a piece is received). `css/portal.css`
keeps only the portal's own: the masthead, the page head, the sign-in form and its code field, the list rows' link,
the piece view and the rest of the state dots. The portal never uses the base's ink-filled `.status--active`: inside
the pieces that dot means «Con observaciones» or «Pidió un cambio», so «En curso» is the portal's ink ring
(`.status--in-progress`).

The sign-in screens follow the visual manual's `formulario` pattern and home follows `lista`; their
`data-rol` marks (`marco`, `cabecera`, `avisos`, `cuerpo`, `accion-principal`, `marca-producto`,
`data-medida="formulario"`) are what the factory's verifier measures (see [Tests](#tests)). The frame is the
base's on every screen: the page margin on both sides (16 px, 24 px from 672 px) and no cap before 1440 px, where it
stops growing and centres (the manual's MAR-11). Inside `<main>`, `data-rol="marco"` holds the title band, the
notices and the body. A form's primary action is its last control (what follows it, like «Enviarme otro código», goes
after the form). The empty home has the shape of the list it replaces (`data-rol="vacio"`): the list, with its own top
rule, and one row, its title and message at the reading measure, under them the base's section notice that asks to
check the email they were invited with, carrying its own action «Entrar con otro correo» (the base's link action) and,
right after it in the same column at every width, «Actualizar», the view's `accion-principal`, as wide as the body up
to the form measure like the sign-in buttons, as MAR-06 asks of an empty state. It does not reach FUN-43's 60 % from 1056 px and
carries that rule's empty-view exception, with its reason, in the geometry check. From 1056 px the rows of every list
(home's projects, a project's pieces, the owner's entries) are equal columns, decided by the list, not by the row: three
(the title, the meta line and the state or aside) as soon as one row of the list has a meta line, a row without one
leaving its middle cell empty; two (the title and the state or aside) when no row has one (every project is another
person's). Each column falls on the same x down the list (FUN-43, «el grupo tabular como tabla»); from 672 to 1056 px the state
stays on the row's right, and below 672 px the rows keep their phone layout.

## The sign-in code email

The email with the one-time code is `supabase/templates/otp-code.html` (HTML only: Supabase Auth's mailer sends no plain-text
part) and its subject is `supabase/templates/otp-code.subject.txt`. The rules are COR-10 to COR-13 of the factory's visual
manual (`patrones/correo-aviso.md`): the code first, large and as real text; how long it lasts; what to do if it was not asked
for; no links, no images. `tests/unit/otp-template.test.mjs` checks what is mechanical.

Steps in the Supabase panel (the owner does them; the app password is typed in the panel, never in this repository):

1. **Check first.** Authentication > SMTP Settings: see whether a custom SMTP is already set. Without one, Supabase's default
   sender only delivers to addresses in the project's team: make sure the owner's second address is in the team (Organization
   settings > Team) or set the SMTP below before testing with it.
2. **Authentication > SMTP Settings** > enable custom SMTP: host `smtp.gmail.com`, port `465`, username the Gmail address that
   already sends the notices, password an app password of that Gmail (Google account > Security > App passwords), sender
   address that same Gmail, sender name `ninben`.
3. **Authentication > Rate Limits:** set "emails per hour" below Gmail's limit of 500 a day (for example 20 an hour).
4. **Read "Email OTP expiration"** (Authentication > Sign In / Providers > Auth Providers > Email). The template says
   «Vale 1 hora.» (Supabase's default, 3600 seconds). If the panel shows another value, change that line in
   `otp-code.html` before pasting it.
5. **Authentication > Email Templates:** the portal asks for the code with `signInWithOtp` and creates users on the fly, so
   Supabase sends it with the "Magic link" template to an existing address and with "Confirm sign up" to a new one: paste the
   subject from `otp-code.subject.txt` and the body from `otp-code.html` into both.
6. Test: ask for a code from the portal with an address that is not Gmail's own and check the email arrives (and not in Junk),
   with the code first.

## Database migrations

`supabase/migrations/` holds the schema, without data:

- `20261016000000_baseline.sql` is a **recovery snapshot** of the live project as of 2026-10-16, for
  rebuilding the schema in an **empty** Supabase project. It was **never applied to `factory`**
  (that project already had the schema), and `factory`'s migration history only lists
  `20261021033643_factory_connection`. So never point `supabase db push` (or any migration runner) at
  `factory` with the baseline in the folder: it would try to create tables that already exist.
- `20261021033643_factory_connection.sql` is the factory connection: the `demo_review` kind,
  `display_name`, the `replaced` status, `partial` and `fetched_at` on responses, the factory-only
  functions (`factory_preview`, `factory_publish`, `factory_fetch`, `factory_mark_fetched`, execute
  for `service_role` only) and `keep_alive()`. Its name carries the version Supabase registered. It is
  idempotent.
- `20261024033949_piece_closure.sql` is the piece closure: the `received` status (the factory collected
  a complete response, so the piece closes), `storage` on responses, the `piece_change_requests` table
  (each person reads only their own), `submit_response` with an optional storage (a send on a closed
  piece is kept as a late change request; a storage copy over 1 MB is stored as null, so the send never fails
  because of it), `request_change` for the person, `factory_publish` also
  replacing `submitted` and `received` pieces, and the factory-only functions `factory_mark_received`,
  `factory_reopen`, `factory_fetch_change_requests` and `factory_mark_change_requests_fetched` (execute
  for `service_role` only). Applied to `factory` on 2026-10-23; its name carries the version Supabase
  registered. It is idempotent.
- `20261025120000_project_page.sql` is the project page (the routes and the owner's part are described under
  **The owner's part**): `first_opened_at` on assignments (the first
  time the assigned person opens the piece in the portal; null for assignments from before it),
  `mark_piece_opened` for the person (only the first open counts; status and `updated_at` are not
  touched), `save_draft` moving `updated_at` on every save while the piece is in progress (before, only
  the first save did; that date is the owner's «Último cambio el …»), the owner's read-only functions
  `owner_projects`, `owner_project` and `owner_piece`
  (execute for `authenticated`; each checks first that the caller is the project's `owner`, and none
  returns a draft: nothing from `piece_drafts`, no partial response, no storage of a change request)
  and the factory-only `factory_set_owner` (execute for `service_role` only). No policy is added: a
  person still reads only their own rows. Applied to `factory` on 2026-10-28, by hand from the SQL
  editor; its history row was inserted by hand with the file's version (`20261025120000`), so the name
  stays. It is idempotent.

`tests/sql/factory-connection-checks.sql` checks the factory connection migration,
`tests/sql/piece-closure-checks.sql` checks the piece closure and `tests/sql/project-page-checks.sql`
checks the project page, all against the database (see their headers).

## Keeping Supabase awake

The free Supabase plan pauses a project after 7 days without activity.
`.github/workflows/keep-alive.yml` runs every 3 days at 12:00 UTC (`cron: "0 12 */3 * *"`) and on demand
(Actions > Keep Supabase awake > Run workflow). It reads the URL and the publishable key from
`config.js` and calls `POST <url>/rest/v1/rpc/keep_alive`, a function that only returns `1`; the run
fails unless the answer is HTTP 200 with `1`. No secret is used.

**GitHub turns scheduled workflows off after 60 days without activity in the repository.** If the
portal goes two months without commits, check Actions and re-enable the workflow, or the project will
pause again a week later.

## Tests

```sh
npm test   # node --test: bridge, message validation, draft queue, errors, i18n, closure, project routes and states, sync-brand, the browser checks' server
node tests/browser/run-checks.mjs --questions <questions-piece.html> --flow <flow-review-piece.html> \
  --demo <demo-sheet.html> --out <dir> --factory <path to the software factory repo>
node scripts/sync-brand.mjs --from <path to the software factory repo> --check
```

The browser checks serve the repo with `tests/browser/static-server.mjs` (Node, on 127.0.0.1 and a
free port), drive Chrome headless with `playwright-core` (from `PLAYWRIGHT_CORE_DIR`, or the software
factory cache) and cover: the sign-in screen at 320,
360, 768 and 1440 px (no console errors, no horizontal scroll, axe, the brand's logo, colour and
font), the bridge on real pieces through `tests/harness.html` (no Supabase), and the whole app
against a mocked Supabase (home, autosave, send, errors, empty state, a session that ends before a
change was saved, a session that comes back while the piece hands over its draft, a change too long
to keep). With `--demo` as well: the demo sheet sends through the app (a failure shows its error and
never «Tu revisión llegó»; the retry arrives once), and a replaced version opened from an old email shows its
fixed notice, links to the newer version and still sends. With `--questions`, the piece closure, at
320, 768 and 1440 px, light and dark: the list with a received piece, a replaced version that was sent
and a change request (`list-received-<width>-<scheme>.png`); a received piece read only with its notice
(`closed-received-…`); the request form sent empty (`request-empty-error-…`), failing (network, and a
rejection) and arriving (`request-sent-…`), closed with «Cancelar»; a replaced version that was sent (`closed-replaced-…`); a
draft with unsent changes going with the request (`request-with-unsent-…`); and a send from a tab left
open after the close (`late-send-…`). At 320 × 640: with the form open the page scrolls, the iframe as tall as the
piece and the form in the window (`request-short-phone-320-light.png`), and scrolled to the piece's start the piece
shows painted, its «Lo que enviaste» inside the screen (`…-scrolled.png`); and a piece reopened while the person writes
opens again on 55000; a send whose late check cannot be read still answers ok and opens the piece again as the
server has it (closed after a late send, open after a normal one); and signing out with a change request written and
not sent asks first («Quedarme» keeps the text). The piece screen is checked at 320, 768 and
1440 px, light and dark, and at 672 and 1056 px: one brand on screen (the portal's), above the way back and
the title and on their left edge; no brand bar inside the piece; every top-level block of each screen
the checks walk (start, review, inside a flow, a note being written, the flows' final screen, sent),
and «Ver todos los flujos» in a flow, on that same edge, with the reading measure kept; no second
banner inside the piece; a piece opened and left alone says nothing about saving and saves nothing;
and «Enviada el …» only for a send the saved draft cannot show. Each piece opened on its own still
shows its bar. Below 672 px the review captures are 320 × 640 (`host-<piece>-w320-light.png` included). The
piece screen on a phone (MAR-14, `phoneFrameChecks`), at 320 × 640 with a project of a long name, in Chromium and
also in WebKit when playwright-core has its build installed (otherwise a `NOTE` line says it did not run; Playwright's
WebKit emulates the screen of the top page only, so there the piece's iframe is given the phone's screen too): at rest
the title band ends at 160 px or less, with a title of `TITLE_MAX` characters too; «← Volver» is one line named
«Volver a <project>»; the iframe is as tall as the piece, which does not scroll inside, and the page is taller than
the screen; one screen down nothing fixed or sticky is on screen; the project's page, the owner's project page and the
owner's piece screen (with a title of `TITLE_MAX` characters too) end their band at 160 px or less, with «← Volver»
in one line named after where it goes; «Guardado» and a failed save («Sin guardar: …», without connection or too long to keep, announced by the status region)
in the row of «← Volver», on its right and above the title, with the h1 ending at 160 px or less with either showing and the
whole band with «Guardado» too (a title of `TITLE_MAX` characters); a scroll request below the piece's last height is
done when the new height arrives; a short piece's box ends at the screen's bottom with nothing to scroll; at the bottom of a step «Siguiente» shows the new step's title, and a link of the flows' index its group; the
step's last field, focused, is in the window; an opened `<details>` grows the iframe; and a piece that grows again
in the same rendering frame as the portal's resize of its iframe ends as tall as the iframe, with the resize event
before the ResizeObserver there. Screenshots in `<out>`: `piece-view-<width>-<scheme>.png` (questions),
`piece-view-flow-320.png`, `piece-view-flow-1440-<scheme>.png`, `piece-view-flow-note-1440.png`,
`piece-view-flow-start-<768|1440>.png`, `piece-view-flow-final-<768|1440>.png` and
`piece-view-demo-1440-<scheme>.png`.

**The pieces.** The checks do not generate pieces: pass the three files with `--questions`, `--flow`
and `--demo`. Emit them from the factory's current templates into a scratch folder (never into either
repo), with `F` the software factory repo and `T` the scratch folder:

```sh
# questions: a copy of the factory's mini project, renamed portal-test, with four questions for Ana Pérez
cp -R "$F/factory-orchestrator/evals/preguntas/fixtures/proyecto-mini" "$T/project"
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["proyecto"]="portal-test"; json.dump(d,open(p,"w"))' "$T/project/project-manifest.json"
for i in 1 2 3 4; do
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); d["para"]="Ana Pérez"; json.dump(d,open(sys.argv[2],"w"))' \
    "$F/factory-orchestrator/evals/preguntas/fixtures/entrada-$i.json" "$T/q$i.json"
  python3 "$F/factory-orchestrator/assets/preguntas.py" agregar --proyecto "$T/project" --archivo "$T/q$i.json" --por prd
done
python3 "$F/factory-orchestrator/assets/preguntas.py" emitir --proyecto "$T/project" --para "Ana Pérez"
cp "$T/project/.factory/preguntas/ronda-1-ana-perez.html" "$T/questions.html"
# flow review
python3 "$F/ux-flows/assets/emit-recorrido.py" \
  --datos "$F/ux-flows/evals/recorrido-flujos/fixtures/golden-recorrido.json" --salida "$T/flow.html"
# demo sheet (without an expected reviewer: the name comes from the portal member)
D="$F/design-system/evals/demo-aprobacion/fixtures"
python3 "$F/design-system/assets/emit-aprobacion.py" --guion "$D/guion.json" --versiones "$D/versiones.json" \
  --respuestas "$D/revisiones" --enlace https://example.com/prototype --responsable "Ana Gómez" \
  --proyecto-titulo "la biblioteca" --salida "$T/demo.html"

node tests/browser/run-checks.mjs --questions "$T/questions.html" --flow "$T/flow.html" --demo "$T/demo.html" \
  --out "$T/checks" --factory "$F"
```

The checks expect these fixtures (the questions sheet for Ana Pérez in `portal-test`, the demo link on
`https://example.com/`). Re-emit the pieces whenever a template changes in the factory. The harness takes `submitTimeoutMs` and `quotaChars`
options so the timeout and the storage quota can be lowered for a check. `tests/harness.html` can also be opened by hand in any browser to try a piece file.

**The project page and the owner's part.** With `--questions`, the checks cover home «Tus proyectos» and a
project's page (its own items, the note about what the owner sees, a person who owns one project and is asked things in another,
the owner who also has a piece assigned in their own project, and `mark_piece_opened` failing: the piece opens
anyway). With `--questions`, `--flow` and `--demo` together, the owner's part: every state and date, the three
kinds of piece opened read only, a send kept without its storage (no link), an old piece, and that the owner's
screens save, send and ask nothing and never read a draft.

**Visual manual.** Each run saves screens to `<out>/screens/`: `sign-in-email.html`,
`sign-in-code.html` (pattern `formulario`) and `home-empty.html` (pattern `lista`); with `--questions`, also
`home-projects.html` and `project-page.html` (`lista`) and `project-received.html` (`lista`, a project with closed
pieces); with `--questions`, `--flow` and `--demo`, also `project-owner.html` (`lista`, an owned project with the
owner's part). That is seven snapshots, and all seven are measured. Each one is the rendered DOM without scripts,
next to a copy of `css/` and `brand/`, so it looks exactly as in the app. With `--factory`, every screen goes through the factory's
`design-system/assets/verifica-pantalla.mjs` (the visual manual's checks and axe) at 320, 768 and
1440 px, in light and dark, and each run is one check (its JSON is saved next to the screen). To
re-run one by hand:

```sh
node <factory>/design-system/assets/verifica-pantalla.mjs --html <out>/screens/home-projects.html \
  --patron lista --ancho 768 --color-scheme dark
```

**The portal's frame.** With `--factory`, the same seven screens (`sign-in-email`, `sign-in-code`, `home-projects`,
`project-page`, `home-empty`, `project-owner` and `project-received`) also go through the factory's
`design-system/assets/geometria.mjs`, the frame measure the factory's pieces are held to, at 320, 672, 1056 and
1440 px, light and dark: every rule at each width (one margin on both sides, MAR-11; sections side by side in equal
parts, MAR-12; the body not left half empty from 1056, FUN-43; …), the same frame on the seven screens (MAR-02), and
every `@media` of `css/portal.css` and the base on the grid's cuts (MAR-08). One check per screen, width and scheme
names what fails. The piece screen, and the owner's read-only piece screen, are checked at the same widths and at 1600: its frame on the other screens' edges
with the page margin on both sides, and its iframe over the frame's box, as wide as the factory's
`design-system/assets/piece-host.mjs` says (`widthInPortal`, up to 1440), so the factory measures its pieces inside the
portal at the width a person sees them.

## Files

| Path | Purpose |
|---|---|
| `index.html`, `css/portal.css` | Page shell and the portal's own styles (on top of the brand and its components) |
| `brand/` | Generated copy of the ninben brand (`ninben.css`, `ninben-components.css`, `logo.svg`, `fonts/`) |
| `scripts/sync-brand.mjs` | Copies the brand from the software factory repo, or checks the copy |
| `supabase/migrations/` | Schema: the baseline recovery snapshot, the factory connection, the piece closure and the project page |
| `supabase/templates/` | The sign-in code email: `otp-code.html` and `otp-code.subject.txt` (pasted in the Supabase panel) |
| `.github/workflows/keep-alive.yml` | Calls `keep_alive()` every 3 days so Supabase does not pause |
| `config.js` | Public Supabase configuration |
| `js/app.js` | Router and screens: sign in, home, a project's page (and the owner's part), piece |
| `js/project.js` | Routes and the states the owner reads, as pure functions |
| `js/api.js` | Supabase queries and RPCs |
| `js/bridge.js` | Script injected into each piece (storage shim, `factorySubmit`, `factoryHost`, height and scroll messages) |
| `js/piece-frame.js` | Mounts a piece in the sandboxed iframe and speaks the bridge protocol |
| `js/host.js` | Message validation and the draft save queue |
| `js/auth-errors.js`, `js/i18n.js`, `js/dom.js`, `js/supabase-client.js` | Helpers |
| `tests/` | Unit tests, browser checks (with the screen snapshots), the bridge harness and SQL checks |
