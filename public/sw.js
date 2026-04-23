const CACHE_NAME = 'agent-sync-v2';
const STATIC_ASSETS = [
  '/',
  '/login',
  '/dashboard',
  '/dashboard/clientes',
  '/dashboard/vendas',
  '/dashboard/inadimplencia',
  '/dashboard/importar',
  '/dashboard/bloqueados',
  '/dashboard/agente',
  '/manifest.json',
];

// Install — cache shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
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

// Fetch — Network first, fallback to cache
self.addEventListener('fetch', (e) => {
  const { request } = e;
  // Não interceptar requisições para Supabase API
  if (request.url.includes('supabase.co')) return;
  // Não interceptar POST/PUT/DELETE
  if (request.method !== 'GET') return;

  e.respondWith(
    fetch(request)
      .then(response => {
        // Cacheia a resposta atualizada
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then(r => r || caches.match('/')))
  );
});

// Background Sync
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-pending') {
    e.waitUntil(syncPendingActions());
  }
});

async function syncPendingActions() {
  // Notifica o cliente para sincronizar
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'SYNC_PENDING' }));
}

// Push notifications (futuro)
self.addEventListener('push', (e) => {
  const data = e.data?.json() || { title: 'Agent Sync Block', body: 'Nova atualização' };
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icons/icon-192x192.png' }));
});
