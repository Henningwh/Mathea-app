# jasynapson

A home-screen launcher for four study apps. Tap an app and a spark jumps between two synapses in that app's colour, then the app opens inside the page.

| App | File | Colour |
|---|---|---|
| MED 301 Flashcards | `public/apps/med301-flashcards.html` | violet |
| Brain and Behaviour Quiz | `public/apps/brain-behaviour-quiz.html` | blue |
| Recall Deck | `public/apps/recall-deck.html` | red |
| Mathea Revision Quiz | `public/apps/mathea-revision-quiz.html` | amber |

The files in `public/apps/` are unmodified copies of the original artifacts. Phone layout tweaks live in `public/apps/mobile/<app>.css` and the launcher adds them when an app opens.

## Saved progress

The apps save progress in the browser (localStorage). `public/sync.js` mirrors that to the cloud, so progress survives new builds, refreshes, new links, other browsers and cleared site data:

- Before an app opens, the launcher loads the latest saved progress.
- Every change is uploaded within a second, every 15 seconds, and when the app is closed. Offline changes upload when you are back online.
- **Manage progress** on the home screen resets one app everywhere. The resets inside the apps sync too.

The cloud copy lives in a Cloudflare Durable Object (`ProgressStore`, SQLite, see `src/worker.js`). Cloudflare creates it on deploy, with no dashboard setup, and the data survives redeploys. There is one shared progress store for the site, and anyone with the link can see and change it.

## Deploy (Cloudflare Workers Builds)

- Connected to this repo; production branch `main`. Build command: none. Deploy command: `npx wrangler deploy`.
- `wrangler.jsonc` serves `./public` as static assets and sends `/api/*` to the worker.

Local preview: `npm install`, then `npx wrangler dev`.

## Updating an app

Replace the file in `public/apps/` with the new HTML, keeping the same filename. Then bump `CACHE` in `public/sw.js` so installed copies pick up the change. Progress keeps working as long as the app keeps its storage key prefix (`bb-fc2-`, `bb-quiz3-`, `cv1-recall-deck`, `mathea-quiz-`).

## Note

The AI "explain" button in the two quiz apps only works inside claude.ai. On this site, tapping it shows a short "not available here" message.
