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
2. **Home**: the pieces assigned to the person, grouped by project, with status (not started, in
   progress, sent) and date. The list never fetches `pieces.html`; it is fetched only when a piece is
   opened.
3. **Piece**: rendered in `<iframe sandbox="allow-scripts allow-downloads allow-modals allow-forms allow-popups allow-popups-to-escape-sandbox">`
   (no `allow-same-origin`) through `srcdoc`, with a bridge script injected first in its `<head>`.
   The popup flags let a piece open a `target="_blank"` link (the demo sheet opens the prototype) as a
   normal tab.

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
  800 ms of quiet; the portal calls
  `save_draft` (one request at a time, newest data wins, retries when offline). The draft is also
  flushed when the person leaves the piece or the page is hidden. `sessionStorage` gets the same
  shim without persistence.
- **Sending.** The piece has the only "Send" button. It calls `globalThis.factorySubmit(payload)`
  (opened outside the portal, a piece finds no `factorySubmit` and offers its own download instead),
  which the bridge defines: it checks the payload against the piece kind (`respuestas-fabrica/1`,
  `ux-flows.md`, `revision-demo/1`) and size, sends the pending draft, and posts
  `{ type: "factory:submit", requestId, payload }`. The portal waits up to 3 s for that draft to be
  saved, calls `submit_response` and answers `{ type: "factory:submit-result", requestId, ok, error? }`.
  The promise resolves `{ ok: true }` only after the server saved; otherwise `{ ok: false, error }`
  with `invalid`, `too-large`, `timeout` (no answer in 45 s), `network`, `session-expired` (the
  portal also offers to sign in again) or `rejected`. A second call while one is in flight returns
  the same promise. The piece shows its own sent screen; the portal's status line shows the send
  time. Downloads are not touched, so the piece's own "Download a copy" stays as the fallback.
- **Host.** The bridge also defines a frozen `globalThis.factoryHost = { persistence, reviewerName }`:
  `persistence` is `"server"` when the storage shim took (else `"none"`), and `reviewerName` is the
  member's `project_members.display_name` (or `null`).
- **Messages.** Each mounted piece gets a random nonce (`crypto.getRandomValues`) inside its
  injected config. The portal only accepts messages whose `event.source` is the piece iframe and that
  carry that nonce, with a known type, the expected shape and under 1 MB. The bridge only posts to the
  portal's origin and only accepts messages (`factory:flush`, `factory:submit-result`) from its
  parent, from the portal's origin, with the nonce. If the iframe loads a
  second document (the piece navigated away or reloaded), the portal removes it and offers to reopen.

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
Mono, and the logo in the masthead. The single source lives in the software factory repo, in
`design-system/assets/brand/` (`ninben.css`, `logo.svg`, `fonts/`). `brand/` here is a generated copy;
never edit it by hand:

```sh
node scripts/sync-brand.mjs --from <path to the software factory repo> --check   # 0 equal, 1 differs
node scripts/sync-brand.mjs --from <path to the software factory repo> --write   # copy what differs
```

`--write` copies only what changed, removes files that are no longer in the source, writes each file
atomically and is safe to run twice; `--check` names every file that differs. Both exit 2 on bad
usage or a broken source (for example, a font that `ninben.css` names is missing), before writing
anything. `index.html` loads `brand/ninben.css` before `css/portal.css`; the fonts are referenced as
`url("fonts/…")` relative to that CSS, so GitHub Pages serves them from `brand/fonts/` (their SIL Open
Font License texts travel with them). The logo is read once from `brand/logo.svg` and placed inline,
so its stroke follows the brand's signal colour in light and dark. `css/portal.css` only adds its
three text sizes and the spacing scale on top of the brand tokens.

The sign-in screens follow the visual manual's `formulario` pattern and home follows `lista`; their
`data-rol` marks (`marco`, `cabecera`, `avisos`, `cuerpo`, `accion-principal`, `marca-producto`,
`data-medida="formulario"`) are what the factory's verifier measures (see [Tests](#tests)).

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

`tests/sql/factory-connection-checks.sql` checks that migration against the database (see its header).

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
npm test   # node --test: bridge, message validation, draft queue, errors, i18n, sync-brand
node tests/browser/run-checks.mjs --questions <questions-piece.html> --flow <flow-review-piece.html> \
  --demo <demo-sheet.html> --out <dir> --factory <path to the software factory repo>
node scripts/sync-brand.mjs --from <path to the software factory repo> --check
```

The browser checks start `python3 -m http.server`, drive Chrome headless with `playwright-core`
(from `PLAYWRIGHT_CORE_DIR`, or the software factory cache) and cover: the sign-in screen at 320,
360, 768 and 1440 px (no console errors, no horizontal scroll, axe, the brand's logo, colour and
font), the bridge on real pieces through `tests/harness.html` (no Supabase), and the whole app
against a mocked Supabase (home, autosave, send, errors, empty state, a session that ends before a
change was saved). `tests/harness.html` can also be opened by hand in any browser to try a piece file.

**Visual manual.** Each run saves four screens to `<out>/screens/`: `sign-in-email.html`,
`sign-in-code.html` (pattern `formulario`), `home-pieces.html` and `home-empty.html` (pattern
`lista`). Each one is the rendered DOM without scripts, next to a copy of `css/` and `brand/`, so it
looks exactly as in the app. With `--factory`, every screen goes through the factory's
`design-system/assets/verifica-pantalla.mjs` (the visual manual's checks and axe) at 320, 768 and
1440 px, in light and dark, and each run is one check (its JSON is saved next to the screen). To
re-run one by hand:

```sh
node <factory>/design-system/assets/verifica-pantalla.mjs --html <out>/screens/home-pieces.html \
  --patron lista --ancho 768 --color-scheme dark
```

## Files

| Path | Purpose |
|---|---|
| `index.html`, `css/portal.css` | Page shell and styles (on top of the brand tokens) |
| `brand/` | Generated copy of the ninben brand (`ninben.css`, `logo.svg`, `fonts/`) |
| `scripts/sync-brand.mjs` | Copies the brand from the software factory repo, or checks the copy |
| `supabase/migrations/` | Schema: the baseline recovery snapshot and the factory connection |
| `.github/workflows/keep-alive.yml` | Calls `keep_alive()` every 3 days so Supabase does not pause |
| `config.js` | Public Supabase configuration |
| `js/app.js` | Router and screens: sign in, home, piece |
| `js/api.js` | Supabase queries and RPCs |
| `js/bridge.js` | Script injected into each piece (storage shim, `factorySubmit`, `factoryHost`) |
| `js/piece-frame.js` | Mounts a piece in the sandboxed iframe and speaks the bridge protocol |
| `js/host.js` | Message validation and the draft save queue |
| `js/auth-errors.js`, `js/i18n.js`, `js/dom.js`, `js/supabase-client.js` | Helpers |
| `tests/` | Unit tests, browser checks (with the screen snapshots), the bridge harness and SQL checks |
