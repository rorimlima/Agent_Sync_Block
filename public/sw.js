/// Agent Sync Block — Service Worker v4
/// PWA Builder compliant, Offline-first with proper strategies

const CACHE_VERSION = 'agent-sync-v4';
const OFFLINE_PAGE = '/offline.html';

// Assets to pre-cache during install
const PRECACHE_ASSETS = [
  '/manifest.json',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ─── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => {
        console.warn('[SW] Precache failed:', err);
        self.skipWaiting();
      })
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests (Supabase, analytics, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip HMR / dev hot-reload
  if (url.pathname.includes('_next/webpack-hmr')) return;
  if (url.pathname.startsWith('/_next/data/')) return;

  // Strategy: Cache-First for static assets
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Strategy: Network-First for pages (HTML navigation)
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // Strategy: Stale-While-Revalidate for everything else
  event.respondWith(staleWhileRevalidate(request));
});

// ─── STRATEGIES ───────────────────────────────────────────────────────────────

/**
 * Cache-First: Check cache, fall back to network, cache the response.
 * Best for: static assets (_next/static/*, icons, fonts, images)
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Network-First with Offline Fallback: Try network, fall back to cache, then offline page.
 * Best for: HTML page navigations
 */
async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Try cache
    const cached = await caches.match(request);
    if (cached) return cached;

    // Serve the offline fallback page
    const offlinePage = await caches.match(OFFLINE_PAGE);
    if (offlinePage) return offlinePage;

    // Last resort
    return new Response(getInlineOfflineHTML(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

/**
 * Stale-While-Revalidate: Return cached version immediately, update cache in background.
 * Best for: API responses, non-critical assets
 */
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        const cache = caches.open(CACHE_VERSION);
        cache.then(c => c.put(request, response.clone()));
      }
      return response;
    })
    .catch(() => cached || new Response('', { status: 503 }));

  return cached || fetchPromise;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.woff2') ||
    pathname.endsWith('.woff') ||
    pathname.endsWith('.ico')
  );
}

function getInlineOfflineHTML() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Offline — Agent Sync Block</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:#0a0a0f;color:#e4e4e7;font-family:'Inter',system-ui,sans-serif;padding:24px;text-align:center}
    .icon{width:80px;height:80px;border-radius:20px;background:rgba(99,102,241,0.15);
      display:flex;align-items:center;justify-content:center;margin-bottom:24px}
    .icon svg{width:40px;height:40px;color:#6366f1}
    h1{font-size:1.5rem;font-weight:700;margin-bottom:8px}
    p{font-size:0.95rem;color:#71717a;max-width:360px;line-height:1.6;margin-bottom:24px}
    button{padding:12px 32px;border-radius:12px;background:#6366f1;color:#fff;border:none;
      font-size:0.95rem;font-weight:600;cursor:pointer;transition:all 0.2s}
    button:hover{background:#818cf8;transform:translateY(-1px)}
    button:active{transform:translateY(0)}
  </style>
</head>
<body>
  <div class="icon">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"></line>
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
      <path d="M10.71 5.05A16 16 0 0 1 22.56 9"></path>
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
      <line x1="12" y1="20" x2="12.01" y2="20"></line>
    </svg>
  </div>
  <h1>Sem Conexão</h1>
  <p>Você está offline. Verifique sua conexão com a internet e tente novamente.</p>
  <button onclick="location.reload()">Tentar Novamente</button>
</body>
</html>`;
}

// ─── BACKGROUND SYNC ──────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending') {
    event.waitUntil(syncPendingActions());
  }
});

async function syncPendingActions() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'SYNC_PENDING' }));
}

// ─── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {
    title: 'Agent Sync Block',
    body: 'Nova atualização disponível',
  };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [100, 50, 100],
      data: { url: data.url || '/dashboard' },
    })
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ─── PERIODIC BACKGROUND SYNC ────────────────────────────────────────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(syncPendingActions());
  }
});
