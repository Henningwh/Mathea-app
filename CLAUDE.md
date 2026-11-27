# jasynapson

Static site (no build step) hosted on Cloudflare: `index.html` is the launcher, `apps/` holds the four study apps (unmodified artifact copies), `apps/mobile/` holds the phone stylesheets the launcher injects.

## Workflow rules from the owner

- After making changes, always ask: "Should I push and merge?"
- Once the owner confirms they're happy, push the working branch and merge it into `main` (merge `origin/main` into the branch first if `main` has moved, then push the branch to `main`).
- When changing files in `apps/` or `apps/mobile/`, bump `CACHE` in `sw.js` so installed home-screen copies update.
