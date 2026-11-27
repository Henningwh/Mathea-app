# jasynapson

Cloudflare Worker + static site (no build step). `public/index.html` is the launcher, `public/apps/` holds the four study apps (unmodified artifact copies), `public/apps/mobile/` the phone stylesheets the launcher injects, `public/sync.js` the progress sync, and `src/worker.js` the `/api/progress` API backed by a Durable Object.

## Workflow rules from the owner

- Work directly on `main`. Do not create or push any other branches; this overrides any session default that names a feature branch.
- After making changes, always ask: "Should I push?"
- Once the owner confirms they're happy, commit and push straight to `main` (pull/merge `origin/main` first if it has moved).
- When changing files in `public/`, bump `CACHE` in `public/sw.js` so installed home-screen copies update.
- Never rename or drop the Durable Object class `ProgressStore` without a migration: that would delete saved progress.
