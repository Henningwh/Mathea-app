// Network first, cache fallback: you always get the latest version when online,
// and the launcher plus all four apps still open offline once visited.
const CACHE = 'jasynapson-v3';
const CORE = [
  './', 'index.html', 'sync.js', 'manifest.webmanifest', 'icons/logo.svg', 'icons/icon-192.png',
  'apps/med301-flashcards.html', 'apps/brain-behaviour-quiz.html',
  'apps/recall-deck.html', 'apps/mathea-revision-quiz.html',
  'apps/mobile/med301-flashcards.css', 'apps/mobile/brain-behaviour-quiz.css',
  'apps/mobile/recall-deck.css', 'apps/mobile/mathea-revision-quiz.css'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return;
  if (sameOrigin && url.pathname.startsWith('/api/')) return; // progress API: always live
  e.respondWith(
    fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
