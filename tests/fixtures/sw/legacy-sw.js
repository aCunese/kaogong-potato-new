// ==============================================================================
// Legacy Service Worker Fixture for V10 Regression Audit
// Source: commit bc368b7:public/sw.js (pre-update-guard baseline)
// Used by: scripts/lib/boundary-checks.ts (runV10Check) to simulate upgrade
// from older SW version without relying on git objects or ignored output.
// ==============================================================================

// ==============================================================================
// 考公工作台 · Offline Service Worker (PWA & Offline Shell)
// ==============================================================================

const CACHE_NAME = 'kaogong-shell-v1.0.1-20261026.02';

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

  // D. Static Assets (JS, CSS, Images, Fonts): Cache-First with runtime caching and type checking
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          const contentType = response.headers.get('content-type') || '';
          const isImage =
            event.request.destination === 'image' ||
            url.pathname.match(/\.(png|jpg|jpeg|webp|svg|gif|ico)$/i);

          // CRITICAL SAFETY GUARD:
          // Never treat 404/503 HTML fallback pages as images or scripts
          if (isImage && contentType.includes('text/html')) {
            return new Response('Image not found', {
              status: 404,
              statusText: 'Not Found',
              headers: { 'Content-Type': 'text/plain' },
            });
          }

          if (response.ok) {
            // Verify valid content type before storing into cache
            if (isImage && !contentType.startsWith('image/') && contentType.includes('text/html')) {
              return response;
            }

            if (
              url.pathname.startsWith('/assets/') ||
              event.request.destination === 'script' ||
              event.request.destination === 'style' ||
              event.request.destination === 'image' ||
              event.request.destination === 'font'
            ) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
          }
          return response;
        })
        .catch((fetchErr) => {
          // If offline and requesting an image, return 404 text response rather than falling back to HTML
          const isImage =
            event.request.destination === 'image' ||
            url.pathname.match(/\.(png|jpg|jpeg|webp|svg|gif|ico)$/i);
          if (isImage) {
            return new Response('Offline Image Unavailable', {
              status: 404,
              statusText: 'Offline Image Unavailable',
              headers: { 'Content-Type': 'text/plain' },
            });
          }
          throw fetchErr;
        });
    })
  );
});
