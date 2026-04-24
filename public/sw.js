const CACHE_NAME = 'agent-sync-v3';
const STATIC_ASSETS = [
  '/manifest.json',
];

// Install — cache apenas assets essenciais (não rotas Next.js dinâmicas)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .catch(err => console.warn('SW install cache failed:', err))
  );
  self.skipWaiting();
});

// Activate — limpa caches antigos
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — Stale-while-revalidate para pages, network-first para API
self.addEventListener('fetch', (e) => {
  const { request } = e;

  // Não interceptar Supabase API
  if (request.url.includes('supabase.co')) return;
  // Não interceptar POST/PUT/DELETE
  if (request.method !== 'GET') return;
  // Não interceptar Chrome extensions, HMR, etc
  if (request.url.startsWith('chrome-extension://')) return;
  if (request.url.includes('_next/webpack-hmr')) return;

  // Para assets estáticos (_next/static) — cache-first
  if (request.url.includes('/_next/static/') || request.url.includes('/icons/')) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // Para pages/navigation — stale-while-revalidate
  e.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline: retornar cache ou página base
          if (cached) return cached;
          // Tentar retornar a página raiz cacheada
          return caches.match('/').then(root => root || new Response(
            '<!DOCTYPE html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#0f0f23;color:#a1a1aa"><p>Sem conexão. Reconecte e tente novamente.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          ));
        });

      // Retorna cache imediato se disponível, atualiza em background
      return cached || networkFetch;
    })
  );
});

// Background Sync
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-pending') {
    e.waitUntil(syncPendingActions());
  }
});

async function syncPendingActions() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'SYNC_PENDING' }));
}

// Push notifications (futuro)
self.addEventListener('push', (e) => {
  const data = e.data?.json() || { title: 'Agent Sync Block', body: 'Nova atualização' };
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icons/icon-192.png' }));
});
