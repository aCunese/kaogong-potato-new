// ==============================================================================
// 考公工作台 · Offline Service Worker (PWA & Offline Shell)
//
// R16 修复（只读审查项）：
//   - /version.json 与 /api/version 是“版本核验”接口，必须【网络直通、永不缓存、绝不回退缓存】；
//     网络失败时返回 503 JSON（response.ok=false），页面因此进入 failed/offline 状态，
//     绝不会把旧缓存里的 version.json 当成“当前最新版本”。
//   - 从 PRECACHE_RESOURCES 中移除 version.json；CACHE_NAME 升级 v2 以清理历史缓存中可能残留的 version.json。
//   - 页面侧仍通过 /version.json?nonce=<一次性随机值> 服务端回显 nonce 做网络新鲜度证明（双保险）。
// ==============================================================================

const RELEASE_VERSION = '1.1.2';
const RELEASE_BUILD = '20261030.02';
const CACHE_NAME = `kaogong-shell-v5-${RELEASE_VERSION}-${RELEASE_BUILD}`;

// 注意：这里绝对不能包含 /version.json（R16：版本响应不允许被缓存）
const PRECACHE_RESOURCES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/potato-poses.png',
];

// 防御性过滤：构建期脚本（vite swPrecachePlugin）会重写上面的数组，即使它误把
// /version.json 或 /api/version 注入预缓存列表，这里也会在 install 前剔除（R16 双保险）。
const SAFE_PRECACHE_RESOURCES = PRECACHE_RESOURCES.filter(
  (resource) => !/^\/api\/version(\?|$)/.test(resource) && !/^\/version\.json(\?|$)/.test(resource)
);

// 1. Install & Pre-cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SAFE_PRECACHE_RESOURCES).catch((err) => {
        console.warn('[SW] Pre-caching non-fatal warning:', err);
      });
    })
    // DO NOT call self.skipWaiting() here! The new worker must enter waiting normally.
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
          return undefined;
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 2b. Message Listener for queries and skip-waiting
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'GET_RELEASE_INFO') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        type: 'RELEASE_INFO',
        cacheName: CACHE_NAME,
        version: RELEASE_VERSION,
        build: RELEASE_BUILD,
      });
    }
    return;
  }

  if (event.data.type === 'SKIP_WAITING') {
    if (!event.data.targetBuild || event.data.targetBuild === RELEASE_BUILD) {
      self.skipWaiting();
    }
  }
});

function offlineVersionResponse() {
  return new Response(
    JSON.stringify({
      ok: false,
      offline: true,
      code: 'VERSION_UNAVAILABLE',
      message: '版本接口当前不可达；为避免误报“已是最新”，本次核验按失败处理。',
    }),
    {
      status: 503,
      statusText: 'Service Unavailable (Offline)',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

// 3. Fetch Dispatcher with Strict Route Isolation
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // A. 版本核验接口：STRICT Network-Only（R16）
  //    - 绝不读缓存、绝不做 cache-fallback、绝不把旧 version.json 返回给页面；
  //    - 网络失败返回 503 JSON（response.ok=false，页面判定 failed/offline）。
  if (url.pathname === '/version.json' || url.pathname === '/api/version') {
    event.respondWith(
      fetch(event.request).catch(() => offlineVersionResponse())
    );
    return;
  }

  // B. API Requests: STRICT Network-Only or Network-First.
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

  // C. Navigation requests (Page reloads, deep links): Network-First, fallback to cached /index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/index.html', clone)).catch(() => {});
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
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
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
