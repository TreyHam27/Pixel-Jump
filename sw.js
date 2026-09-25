// Pixel Jump service worker: makes the game installable and playable offline.
//
// - Page loads go to the network first (a new deploy always wins when
//   online) and fall back to the cached page offline.
// - Game files are served from the cache and refreshed in the background, so
//   the next load picks up any change even if GAME_VERSION wasn't bumped.
// - Google Fonts get their own cache.
// Co-op signaling (PeerJS's WebSocket) never goes through here.
//
// VERSION must match GAME_VERSION in js/config.js (tests/test_version.js
// checks); bumping it drops the old caches.
const VERSION = '1.7.5';
const CACHE = 'pixel-jump-' + VERSION;
const FONT_CACHE = 'pixel-jump-fonts';

const SHELL = [
    './',
    'index.html',
    'manifest.webmanifest',
    'style.css?v=' + VERSION,
    'js/vendor/peerjs.min.js?v=' + VERSION,
    'js/config.js?v=' + VERSION,
    'js/sounds.js?v=' + VERSION,
    'js/background.js?v=' + VERSION,
    'js/input.js?v=' + VERSION,
    'js/renderer.js?v=' + VERSION,
    'js/entities.js?v=' + VERSION,
    'js/ads.js?v=' + VERSION,
    'js/network.js?v=' + VERSION,
    'app.js?v=' + VERSION,
    'icons/favicon.svg',
    'icons/favicon-32.png',
    'icons/apple-touch-icon.png',
    'icons/icon-192.png',
    'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(k => k.startsWith('pixel-jump-') && k !== CACHE && k !== FONT_CACHE)
                .map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Serve from `cacheName` right away if possible, and refresh it from the
// network either way.
function staleWhileRevalidate(request, cacheName) {
    return caches.open(cacheName).then(cache => cache.match(request).then(cached => {
        const fresh = fetch(request).then(response => {
            if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
            return response;
        }).catch(() => cached);
        return cached || fresh;
    }));
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
        event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
        return;
    }
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE).then(cache => cache.put('index.html', copy));
                    }
                    return response;
                })
                .catch(() => caches.match('index.html').then(r => r || caches.match('./')))
        );
        return;
    }

    event.respondWith(staleWhileRevalidate(request, CACHE));
});
