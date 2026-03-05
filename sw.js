/* ═══════════════════════════════════════════════════════════════
   TasteLab Service Worker — v4.3.0
   Strategy: Cache-first for assets, Network-first for API
   Updated: New features — meal planner, collections, voice input,
            TTS, offline recipe cache, stats, compare, notes, tags
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME    = 'tastelab-v4.3';
const RUNTIME_CACHE = 'tastelab-runtime-v4.1';

/* Pre-cache on install — core shell only */
const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/favicon.ico',
];

/* ── INSTALL ─────────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => {
        console.log('[TasteLab SW] v4.3.0 installed');
        return self.skipWaiting();
      })
  );
});

/* ── ACTIVATE: purge old caches ──────────────────────────────── */
self.addEventListener('activate', event => {
  const valid = [CACHE_NAME, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !valid.includes(k)).map(k => {
          console.log('[TasteLab SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

/* ── FETCH ───────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* Anthropic API — always network, never cache */
  if (url.hostname === 'api.anthropic.com') {
    event.respondWith(fetch(request));
    return;
  }

  /* Google Fonts CSS — stale-while-revalidate */
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  /* Google Fonts files — cache-first (immutable) */
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  /* cdnjs (Quagga barcode etc.) — cache-first */
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  /* Same-origin: HTML, icons, manifest — cache-first */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  /* Everything else — network only */
  event.respondWith(fetch(request).catch(() => offlineFallback()));
});

/* ── STRATEGIES ──────────────────────────────────────────────── */

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchP = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchP;
}

/* ── OFFLINE PAGE ────────────────────────────────────────────── */
function offlineFallback() {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>TasteLab — Offline</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#111214;color:#f0ece4;font-family:system-ui,sans-serif;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;gap:20px;padding:24px;text-align:center}
    .logo{font-size:3.5rem;margin-bottom:4px}
    .name{font-size:1.8rem;font-weight:800;letter-spacing:-0.02em}
    .name span{color:#e8a87c}
    p{color:#9a9a8a;font-size:0.95rem;max-width:320px;line-height:1.6}
    .btn{margin-top:4px;padding:14px 32px;background:#e8a87c;color:#1a1410;
         border:none;border-radius:999px;font-size:0.95rem;font-weight:700;
         cursor:pointer;letter-spacing:0.02em}
    .note{font-size:0.8rem;color:#666;margin-top:8px}
  </style>
</head>
<body>
  <div class="logo">🍽️</div>
  <div class="name">Taste<span>Lab</span></div>
  <p>You're offline. TasteLab needs an internet connection to generate AI recipes. Please reconnect and try again.</p>
  <button class="btn" onclick="location.reload()">↺ Try Again</button>
  <p class="note">Recipes you cached with "Save offline" are available in your Saved tab.</p>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/* ── BACKGROUND SYNC ─────────────────────────────────────────── */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-saved-recipes') {
    event.waitUntil(syncSavedRecipes());
  }
});
async function syncSavedRecipes() {
  console.log('[TasteLab SW] Background sync: saved recipes');
}

/* ── PUSH NOTIFICATIONS ──────────────────────────────────────── */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'TasteLab', {
      body:    data.body    || 'Your recipe is ready!',
      icon:    './icons/icon-192.png',
      badge:   './icons/icon-72.png',
      vibrate: [100, 50, 100],
      data:    { url: data.url || './' },
      actions: [
        { action: 'view',    title: '👁 View Recipe' },
        { action: 'dismiss', title: '✕ Dismiss'     }
      ]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'view') {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});

/* ── SHARE TARGET ────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && url.searchParams.has('url')) {
    const sharedUrl = url.searchParams.get('url');
    if (sharedUrl) {
      event.respondWith(
        Response.redirect('./index.html?import=' + encodeURIComponent(sharedUrl), 302)
      );
    }
  }
});

/* ── DEEP LINK SHORTCUTS ─────────────────────────────────────── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[TasteLab SW] Service Worker v4.3.0 loaded');