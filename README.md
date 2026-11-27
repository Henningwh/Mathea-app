# jasynapson

A home-screen launcher for four study apps. Tap an app and a spark jumps between two synapses in that app's colour, then the app opens inside the page.

| App | File | Colour |
|---|---|---|
| MED 301 Flashcards | `apps/med301-flashcards.html` | violet |
| Brain and Behaviour Quiz | `apps/brain-behaviour-quiz.html` | blue |
| Recall Deck | `apps/recall-deck.html` | red |
| Mathea Revision Quiz | `apps/mathea-revision-quiz.html` | amber |

The files in `apps/` are unmodified copies of the original artifacts. Each app keeps its own progress in the browser, under its own storage keys, so the apps don't overwrite each other.

## Deploy on Cloudflare Pages

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo.
2. Framework preset: **None**. Build command: *(leave empty)*. Build output directory: `/`.
3. Deploy, then open the `*.pages.dev` URL on your phone.
4. iPhone: Safari → Share → **Add to Home Screen**. Android: Chrome menu → **Install app**.

It's a static site: there's no build step and nothing to install. After the first visit it works offline (`sw.js`).

## Updating an app

Replace the file in `apps/` with the new HTML, keeping the same filename. Then bump `CACHE` in `sw.js` (for example to `jasynapson-v2`) so installed copies pick up the change.

## Note

The "explain this simply" AI feature in the two quiz apps only works inside claude.ai. Off claude.ai it switches itself off, and everything else works as usual.
