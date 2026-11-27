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

## Adding a new app (standard pattern)

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

If an app needs a brand-new storage key prefix after it ships (e.g. the artifact author renamed keys), add the new prefix next to the old one rather than replacing it, so saved progress isn't orphaned.
