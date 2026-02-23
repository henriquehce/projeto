/* ═══════════════════════════════════════
   TASKFLOW — Service Worker (PWA)
   Versão: 1.0.0
═══════════════════════════════════════ */

const CACHE_NAME    = 'taskflow-v1';
const CACHE_STATIC  = 'taskflow-static-v1';

// Arquivos essenciais para cachear (shell do app)
const STATIC_ASSETS = [
    '/',
    '/static/css/style.css',
    '/static/js/app.js',
    '/static/manifest.json',
    '/static/icons/icon-192.png',
    '/static/icons/icon-512.png',
    'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap'
];

// ─────────────────────────────────────────
// INSTALL — Cacheia o shell do app
// ─────────────────────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando...');
    event.waitUntil(
        caches.open(CACHE_STATIC)
            .then(cache => {
                console.log('[SW] Cacheando assets estáticos');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// ─────────────────────────────────────────
// ACTIVATE — Limpa caches antigos
// ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
    console.log('[SW] Ativando...');
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(k => k !== CACHE_STATIC && k !== CACHE_NAME)
                    .map(k => {
                        console.log('[SW] Removendo cache antigo:', k);
                        return caches.delete(k);
                    })
            ))
            .then(() => self.clients.claim())
    );
});

// ─────────────────────────────────────────
// FETCH — Estratégia de Cache
// ─────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Requisições de API — sempre rede (dados precisam ser em tempo real)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // Assets estáticos — cache primeiro
    if (
        url.pathname.startsWith('/static/') ||
        url.hostname === 'fonts.googleapis.com' ||
        url.hostname === 'fonts.gstatic.com'
    ) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // Navegação (HTML) — rede primeiro, cache como fallback
    if (event.request.mode === 'navigate') {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // Padrão: rede primeiro
    event.respondWith(networkFirst(event.request));
});

// ─────────────────────────────────────────
// ESTRATÉGIAS DE CACHE
// ─────────────────────────────────────────

/** Cache First: usa cache, vai à rede apenas se não tiver */
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_STATIC);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Recurso não disponível offline', { status: 503 });
    }
}

/** Network First: tenta a rede, usa cache como fallback */
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok && request.method === 'GET') {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;

        // Fallback offline para navegação
        if (request.mode === 'navigate') {
            const offlinePage = await caches.match('/');
            return offlinePage || new Response(
                '<h1>Offline</h1><p>Conecte-se à internet para usar o TaskFlow.</p>',
                { headers: { 'Content-Type': 'text/html' } }
            );
        }
        return new Response('Offline', { status: 503 });
    }
}

// ─────────────────────────────────────────
// SYNC — Sincronização em background (futuro)
// ─────────────────────────────────────────
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-comentarios') {
        console.log('[SW] Sincronizando comentários pendentes...');
        // Aqui você pode adicionar lógica de sync offline no futuro
    }
});

// ─────────────────────────────────────────
// PUSH NOTIFICATIONS (estrutura base)
// ─────────────────────────────────────────
self.addEventListener('push', (event) => {
    if (!event.data) return;
    const data = event.data.json();
    event.waitUntil(
        self.registration.showNotification(data.title || 'TaskFlow', {
            body: data.body || 'Nova notificação',
            icon: '/static/icons/icon-192.png',
            badge: '/static/icons/icon-192.png',
            vibrate: [100, 50, 100],
            data: { url: data.url || '/' }
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url || '/')
    );
});
