// ==============================================================================
// 考公工作台 · Offline Service Worker (PWA & Offline Shell)
// ==============================================================================

const CACHE_NAME = 'kaogong-shell-v1.0.0';

const PRECACHE_RESOURCES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/version.json',
  '/assets/potato-poses.png',
];

// 1. Install & Pre-cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_RESOURCES).catch((err) => {
        console.warn('[SW] Pre-caching non-fatal warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate & Clean Old Caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Dispatcher with Strict Route Isolation
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // A. API Requests: STRICT Network-Only or Network-First.
  // CRITICAL RULE: NEVER fallback to index.html for API requests!
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({
            ok: false,
            offline: true,
            code: 'OFFLINE_UNAVAILABLE',
            message: '当前设备处于离线状态，服务器接口暂时不可用。已切换至本地离线存储。',
          }),
          {
            status: 503,
            statusText: 'Service Unavailable (Offline)',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }
        );
      })
    );
    return;
  }

  // B. Version check endpoint: Network-First with cache fallback
  if (url.pathname === '/version.json') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('/version.json'))
    );
    return;
  }

  // C. Navigation requests (Page reloads, deep links): Network-First, fallback to cached /index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/index.html', clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match('/index.html').then((cached) => {
            return cached || fetch(event.request);
          });
        })
    );
    return;
  }

  // D. Static Assets (JS, CSS, Images, Fonts): Cache-First with runtime caching
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (response.ok && (url.pathname.startsWith('/assets/') || event.request.destination === 'script' || event.request.destination === 'style' || event.request.destination === 'image')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
