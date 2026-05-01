// ════════════════════════════════════════════════════
//  APEX CHRONICLE — Service Worker
//  Version: 1.003-pwa
//  Strategy: Network-first for HTML, Cache-first for assets
// ════════════════════════════════════════════════════

const CACHE_NAME = 'apex-chronicle-v1.003';
const STATIC_CACHE = 'apex-static-v1.003';

// Assets to pre-cache on install
const PRE_CACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// External CDN assets to cache on first use
const CDN_CACHE_PATTERNS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'accounts.google.com/gsi/client',
  'cdnjs.cloudflare.com',
];

// URLs to NEVER cache (always fetch live)
const NEVER_CACHE_PATTERNS = [
  'googleapis.com/drive',
  'googleapis.com/oauth2',
  'accounts.google.com/o/oauth2',
  'oauth2.googleapis.com',
];

// ── INSTALL ──────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing Apex Chronicle Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching core assets');
        return cache.addAll(PRE_CACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache failed (ok if offline):', err))
  );
});

// ── ACTIVATE ─────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating new Service Worker...');
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME && name !== STATIC_CACHE)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Now controlling all clients');
        return self.clients.claim();
      })
  );
});

// ── FETCH ─────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and non-http requests
  if (!event.request.url.startsWith('http')) return;

  // Never cache Google Drive / OAuth API calls
  const isNeverCache = NEVER_CACHE_PATTERNS.some(p => event.request.url.includes(p));
  if (isNeverCache) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Check if this is a CDN asset
  const isCDN = CDN_CACHE_PATTERNS.some(p => event.request.url.includes(p));

  // ── Strategy: HTML → Network-first (always get latest)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirstStrategy(event.request));
    return;
  }

  // ── Strategy: CDN + Icons + Manifest → Cache-first
  if (isCDN || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json') {
    event.respondWith(cacheFirstStrategy(event.request));
    return;
  }

  // ── Default: Network-first with cache fallback
  event.respondWith(networkFirstStrategy(event.request));
});

// ── STRATEGIES ────────────────────────────────────────

// Network first — fetch from network, fall back to cache
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.warn('[SW] Network failed, trying cache:', request.url);
    const cached = await caches.match(request);
    if (cached) return cached;
    // Return offline page if main document
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

// Cache first — serve from cache, fetch & update in background
async function cacheFirstStrategy(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Update cache in background (stale-while-revalidate)
    fetch(request)
      .then(response => {
        if (response && response.status === 200) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, response));
        }
      })
      .catch(() => {});
    return cached;
  }
  // Not in cache — fetch and store
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.warn('[SW] Cache miss and network fail:', request.url);
    throw err;
  }
}

// ── MESSAGE HANDLER ───────────────────────────────────
// Allows the app to communicate with the SW (e.g. force update)
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
