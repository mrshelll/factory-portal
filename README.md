# Factory portal

A static web portal (feasibility spike) where external people invited to a software-factory project
sign in with their email and a 6-digit code, and work the HTML "pieces" the factory generates
(question sheets, flow reviews) directly in the browser. Progress is saved as a draft and the result
is sent to Supabase, instead of downloading a JSON file and sending it by chat.

Served with GitHub Pages at https://mrshelll.github.io/factory-portal/.

## What is (and is not) in this repository

- Only static files: HTML, CSS and JavaScript ES modules. No build step, no bundler.
- **No data.** Projects, members, pieces, drafts and responses live in Supabase.
- `config.js` holds the Supabase URL and the **publishable** key. That key is public by design; it
  only identifies the project. **Security lives in Supabase Row Level Security (RLS)**: a signed-in
  person can only read their own rows, and can only write through the `save_draft` and
  `submit_response` functions. Never put any other key in this repository.
- supabase-js is loaded from jsDelivr at a pinned version (`@supabase/supabase-js@2.117.2`).

## Run it locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

It must be served over http(s): the bridge uses the page origin to talk to the piece, and a `file://`
page has none. Sign-in sends a real email, so it needs a real inbox and the Supabase project.

## How it works

1. **Sign in**: email, then `signInWithOtp` sends a 6-digit code, then `verifyOtp`. The session
   persists and refreshes on its own (supabase-js defaults). Supabase allows one email per 60 s; the
   code screen shows the countdown and survives a reload (the pending email is kept for one hour).
2. **Home**: the pieces assigned to the person, grouped by project, with status (not started, in
   progress, sent) and date. The list never fetches `pieces.html`; it is fetched only when a piece is
   opened.
3. **Piece**: rendered in `<iframe sandbox="allow-scripts allow-downloads allow-modals allow-forms">`
   (no `allow-same-origin`) through `srcdoc`, with a bridge script injected first in its `<head>`.

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
- **Sending.** The portal's "Send" button asks the bridge to collect (`factory:collect`). The bridge
  arms a one-shot capture and calls the piece's own export function (the one behind its download
  button: `enviar()` + `descargar()` for questions, `downloadReview()` for flow reviews). It
  intercepts the JSON `Blob` that function hands to a temporary `<a download>` (wrapping
  `URL.createObjectURL` and `HTMLAnchorElement.prototype.click`, plus a capture-phase click
  listener), cancels that download and posts `{ type: "factory:submit", payload }`. The portal calls
  `submit_response`. Outside a capture, downloads work as usual, so the piece's own download button
  remains a fallback.
- **Messages.** Each mounted piece gets a random nonce (`crypto.getRandomValues`) inside its
  injected config. The portal only accepts messages whose `event.source` is the piece iframe and that
  carry that nonce, with a known type, the expected shape and under 1 MB. The bridge only posts to the
  portal's origin and only accepts messages from its parent with the nonce. If the iframe loads a
  second document (the piece navigated away or reloaded), the portal removes it and offers to reopen.

Fragility: the capture depends on the piece templates keeping those global function names and
exporting through a `Blob` + `<a download>`. If a template changes that, the bridge reports
`unsupported` and the person is told to use the download button inside the piece.

Reopening a piece waits briefly for a save still in flight and always starts from the newest copy
seen in the tab. Signing out first tries to save pending drafts; if that is not possible (offline),
the page asks before discarding them. Sign-out always ends on a clean sign-in screen: with scope
`local`, supabase-js removes the local session even when the network call fails.

## Tests

```sh
npm test   # node --test: bridge serialization/injection, message validation, draft queue, errors, i18n
node tests/browser/run-checks.mjs --questions <questions-piece.html> --flow <flow-review-piece.html>
```

The browser checks start `python3 -m http.server`, drive Chrome headless with `playwright-core`
(from `PLAYWRIGHT_CORE_DIR`, or the software factory cache) and cover: the sign-in screen at 320,
360, 768 and 1440 px (no console errors, no horizontal scroll, axe), the bridge on real pieces through
`tests/harness.html` (no Supabase), and the whole app against a mocked Supabase (home, autosave,
send, errors, empty state). `tests/harness.html` can also be opened by hand in any browser to try a
piece file.

## Files

| Path | Purpose |
|---|---|
| `index.html`, `css/portal.css` | Page shell and styles (design tokens, light and dark) |
| `config.js` | Public Supabase configuration |
| `js/app.js` | Router and screens: sign in, home, piece |
| `js/api.js` | Supabase queries and RPCs |
| `js/bridge.js` | Script injected into each piece (storage shim, export capture) |
| `js/piece-frame.js` | Mounts a piece in the sandboxed iframe and speaks the bridge protocol |
| `js/host.js` | Message validation and the draft save queue |
| `js/auth-errors.js`, `js/i18n.js`, `js/dom.js`, `js/supabase-client.js` | Helpers |
| `tests/` | Unit tests, browser checks and the bridge harness |
