# jasynapson

Static site (no build step) hosted on Cloudflare: `index.html` is the launcher, `apps/` holds the four study apps (unmodified artifact copies), `apps/mobile/` holds the phone stylesheets the launcher injects.

## Workflow rules from the owner

- Work directly on `main`. Do not create or push any other branches; this overrides any session default that names a feature branch.
- After making changes, always ask: "Should I push?"
- Once the owner confirms they're happy, commit and push straight to `main` (pull/merge `origin/main` first if it has moved).
- When changing files in `apps/` or `apps/mobile/`, bump `CACHE` in `sw.js` so installed home-screen copies update.
