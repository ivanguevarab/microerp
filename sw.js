// =====================================================================================
// SERVICE WORKER DE OPERATIVIDAD OFFLINE (MicroERP POS)
// Archivo: HTML/sw.js
// Alcance: /HTML/
// Objetivo: Cache Storage inmutable para garantizar carga de pantallas POS y librerías
//           estáticas incluso tras reiniciar la PC sin conexión a internet.
// =====================================================================================

const CACHE_NAME = 'microerp-pos-cache-v1';

// Recursos críticos requeridos para el rol CAJERO
const ASSETS_TO_CACHE = [
    './emitir_ticket.html',
    './arqueo_caja.html',
    './registros_historicos_ventas.html',
    './auth-guard.js',
    './impresora_tickets.js',
    './styles.css',
    './js_offline_pos.js',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11'
];

// Instalación: Pre-cacheo seguro de recursos
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('⚡ [SW POS] Pre-cacheando recursos críticos del cajero...');
            return Promise.allSettled(
                ASSETS_TO_CACHE.map((url) => {
                    return cache.add(url).catch((err) => {
                        console.warn(`[SW POS] Recurso no pre-cacheado en install (${url}):`, err);
                    });
                })
            );
        }).then(() => self.skipWaiting())
    );
});

// Activación: Limpieza de versiones antiguas de caché
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('🧹 [SW POS] Purgando caché obsoleta:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Intercepción de Peticiones (Fetch)
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // 1. Las peticiones a Supabase API se gestionan siempre por la red (IndexedDB es el fallback de datos)
    if (url.hostname.includes('supabase.co')) {
        return; // Pasa directo a la red
    }

    // 2. Solo interceptar peticiones GET
    if (request.method !== 'GET') {
        return;
    }

    // 3. Estrategia Cache-First con actualización silenciosa en segundo plano (Stale-While-Revalidate)
    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cachedResponse = await cache.match(request);
            
            // Si está en caché, responder de inmediato
            if (cachedResponse) {
                // Actualizar silenciosamente en segundo plano si hay red
                fetch(request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        cache.put(request, networkResponse.clone());
                    }
                }).catch(() => {/* En offline no hace nada */});
                
                return cachedResponse;
            }

            // Si no estaba en caché, buscar en la red y guardar en caché
            try {
                const networkResponse = await fetch(request);
                if (networkResponse && networkResponse.status === 200) {
                    cache.put(request, networkResponse.clone());
                }
                return networkResponse;
            } catch (networkError) {
                // Si la red falló y era una navegación a una página HTML del cajero, retornar la versión cacheada
                if (request.mode === 'navigate') {
                    if (url.pathname.includes('emitir_ticket.html')) {
                        const fallbackTicket = await cache.match('./emitir_ticket.html');
                        if (fallbackTicket) return fallbackTicket;
                    }
                    if (url.pathname.includes('arqueo_caja.html')) {
                        const fallbackArqueo = await cache.match('./arqueo_caja.html');
                        if (fallbackArqueo) return fallbackArqueo;
                    }
                    if (url.pathname.includes('registros_historicos_ventas.html')) {
                        const fallbackHist = await cache.match('./registros_historicos_ventas.html');
                        if (fallbackHist) return fallbackHist;
                    }
                }
                throw networkError;
            }
        })
    );
});
