# jasynapson

Cloudflare Worker + static site (no build step). `public/index.html` is the launcher, `public/apps/` holds the study apps (unmodified artifact copies), `public/apps/mobile/` the phone stylesheets the launcher injects, `public/sync.js` the progress sync, and `src/worker.js` the `/api/progress` API backed by Durable Objects (one per device code).

## Workflow rules from the owner

- Work directly on `main`. Do not create or push any other branches; this overrides any session default that names a feature branch.
- After making changes, always ask: "Should I push?"
- Once the owner confirms they're happy, commit and push straight to `main` (pull/merge `origin/main` first if it has moved). Pushing to `main` deploys to Cloudflare automatically.
- When changing files in `public/`, bump `CACHE` in `public/sw.js` so installed home-screen copies update.
- Never rename or drop the Durable Object class `ProgressStore` without a migration: that would delete saved progress.
- **Never commit or push any API key, token or secret to this repo**: Claude/Anthropic keys, any other AI provider's keys, Cloudflare tokens, anything. This holds even if the owner says it's fine in the moment. Secrets go in Cloudflare as Worker secrets (`wrangler secret put NAME`, read as `env.NAME`), never in code, `wrangler.jsonc` `vars`, `.env` files or commit messages. Before every commit, check the diff for anything that looks like a key (e.g. `sk-ant-`, `sk-`, long random strings); if one slips into a commit, don't push it, rewrite the commit, and tell the owner to revoke the key.
- The logo click handler in `public/index.html` is intentional. Keep it, and don't describe it in commit messages or chat.

## How the pieces fit

- **Apps stay untouched.** Each app is a self-contained HTML file copied byte-for-byte from its Claude artifact. Never edit them; all integration happens in the launcher. That way a new artifact version can simply replace the file.
- **Launcher** (`public/index.html`): the `APPS` array defines the tiles. Each app opens in its own same-origin iframe (kept alive while hidden with `display:none`, never just transparent: iOS lets transparent iframes steal swipes).
- **Phone layout**: `public/apps/mobile/<file-name>.css`. The launcher fetches it and appends it as the last element of the app's `<body>` (artifacts put their `<style>` in the body, so anything earlier loses). Wrap rules in `@media (max-width:640px)`.
- **Progress**: apps save to `localStorage` under their own key prefix. `public/sync.js` mirrors those keys to `/api/progress`:
  - The first sync finishes (or times out after 3.5 s) before any app iframe gets its `src`, so apps read up-to-date storage at startup.
  - App writes reach the launcher as `storage` events (same origin, other window) → upload after 0.8 s; also every 15 s, on hide/exit (keepalive) and when back online.
  - `jasyn-synced` holds the last server-confirmed value per key. Local ≠ synced means changed here, so local wins and gets uploaded. Local = synced means the server value is adopted, including deletions.
  - Resets (`JasynSync.reset(appId)`) wipe the prefix locally and queue `reset:[prefix]` in `jasyn-resets` until the server confirms. This works offline too.
  - Device codes: `jasyn-device` (16 Crockford base32 chars, `XXXX-XXXX-XXXX-XXXX`) is sent as `x-device-code`. The worker uses `idFromName('device:' + code)`. Restoring a code that has no saved data is refused.
  - Launcher-only keys start with `jasyn-` and are never synced.

## Adding an existing artifact as an app (standard pattern)

1. **Get the HTML.** Read the artifact (Artifact tool, `action: "read"`) and copy the saved file unchanged to `public/apps/<slug>.html`. Check the copy byte-for-byte (`sha256sum`).
2. **Find its storage.** `grep -n "localStorage\|sessionStorage\|indexedDB\|window.claude" public/apps/<slug>.html`, then list every key it reads and writes. Requirements for progress to persist:
   - It must use `localStorage` (synchronous get/set). `sessionStorage`, IndexedDB, cookies or the claude.ai runtime storage (`window.claude` capabilities) are **not** synced. If an app uses those, tell the owner; supporting them needs a new sync adapter, since the app files themselves must not be edited.
   - All its keys must share one prefix that no other app's keys start with, and that doesn't start with another app's prefix. Existing prefixes: `bb-fc2-`, `bb-quiz3-`, `cv1-recall-deck`, `mathea-quiz-`. If two apps would collide, raise it before adding.
   - No single value over ~1.5 MB (Durable Object rows max out at 2 MB).
3. **Register the prefix in both places**, using the same app id as the tile:
   - `APP_PREFIXES` in `src/worker.js` (the server rejects unknown keys).
   - `PREFIXES` in `public/sync.js`.
4. **Add the tile** to `APPS` in `public/index.html`: `id`, `name`, `sub` (short subtitle), `file`, `c` (tile and transition colour, distinct from the others), `c2` (light tint used for the lightning glow), and `icon` (inline 24×24 white stroke SVG). "Manage progress" picks it up automatically.
5. **Phone layout (optional but expected):** measure the app at iPhone size (`document.documentElement.scrollHeight` against a 664 px viewport for the start and in-use screens), then write `public/apps/mobile/<slug>.css`. Usual wins: smaller headings and chips, long lists in a capped scroll box, two-column grids for level/deck cards, hide the mode bar during a quiz (`body:has(#quiz:not([hidden]))`), and pin Next/Finish with `position:sticky;bottom:0`.
6. **Offline cache:** add the HTML and CSS to `CORE` in `public/sw.js` and bump `CACHE`.
7. **Test locally** with the real worker and database: `npm install`, then `npx wrangler dev --port 8787 --local`. Use two Playwright browser contexts as two devices and check:
   - Making progress in the app → the key appears in `GET /api/progress` (send `x-device-code`).
   - Reload, and `localStorage.clear()` followed by restoring the code → progress is back.
   - A second device starts empty.
   - The app's own reset and "Manage progress → Reset" both clear the cloud copy, and leave other apps alone.
   - `npx wrangler deploy --dry-run` succeeds.
8. Update the app table in `README.md`, then ask "Should I push?".

## Building a new app here (not copied from an artifact)

New apps may be written in this repo from scratch, possibly over several sessions before they're finished. Follow the same pattern so they plug into the launcher, sync and resets with no extra work:

- **One self-contained file**: `public/apps/<slug>.html` with its CSS and JS inline. No build step, no frameworks that need bundling. CDN scripts only if really needed, with a pinned exact version. Google Fonts are fine.
- **Storage contract** (this is what makes progress persist):
  - Pick a new unique prefix, `<slug>-v1-`, and register it in `src/worker.js` and `public/sync.js` as in step 3 above.
  - Use only `localStorage`, through try/catch wrappers. Read everything synchronously at startup, and write on every meaningful change (each answer or rating), not only at the end of a session.
  - Store JSON values under a few keys (e.g. `<slug>-v1-progress`, `<slug>-v1-settings`) rather than thousands of tiny keys.
  - Stay well under 1.5 MB per value.
  - Never use sessionStorage, IndexedDB, cookies or `window.claude` for progress.
- **Reset**: give the app its own "Reset progress" button (tap twice to confirm) that removes its keys with `localStorage.removeItem`, or sets them to an empty value, and re-renders. Sync picks that up automatically. Don't call the launcher from the app: apps must also work when opened on their own.
- **Phone-first**: design for a 390×664 viewport from the start. Avoid long scrolling start screens, pin primary actions (Next/Finish) to the bottom, and respect `env(safe-area-inset-*)`. Then a separate `apps/mobile/` stylesheet isn't needed.
- **Theme**: define colours as CSS variables on `:root`, with a dark-mode variant, and give `body` an explicit background (the launcher matches the area around the iframe to it).
- **Work in progress**: while an app is unfinished, keep it out of the `APPS` array (it's still reachable at `/apps/<slug>.html` for testing), or add it with `sub: 'Work in progress'`. Ask the owner which. Don't change a prefix once real progress exists. If the data format changes, migrate on load inside the app, or move to `<slug>-v2-` while keeping the old prefix registered.
- Then follow steps 4–8 above (tile, cache, test, README, ask to push).

If an app needs a brand-new storage key prefix after it ships (e.g. the artifact author renamed keys), add the new prefix next to the old one rather than replacing it, so saved progress isn't orphaned.
