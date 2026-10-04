// =====================================================================================
// SERVICE WORKER DE OPERATIVIDAD OFFLINE (MicroERP POS)
// Archivo: HTML/sw.js
// Alcance: /HTML/
// Objetivo: Cache Storage inmutable para garantizar carga de pantallas POS y librerías
//           estáticas incluso tras reiniciar la PC sin conexión a internet.
// =====================================================================================

const CACHE_NAME = 'microerp-pos-cache-v4';

// Recursos críticos requeridos para el rol CAJERO
const ASSETS_TO_CACHE = [
    './emitir_ticket.html',
    './arqueo_caja.html',
    './registros_historicos_ventas.html',
    './auth-guard.js',
    './sidebar.js',
    './impresora_tickets.js',
    './styles.css',
    './js_offline_pos.js',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// Instalación: Pre-cacheo seguro de recursos
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('⚡ [SW POS v3] Pre-cacheando recursos críticos del cajero...');
            return Promise.allSettled(
                ASSETS_TO_CACHE.map((url) => {
                    const isExternal = url.startsWith('http');
                    const req = isExternal ? new Request(url, { mode: 'no-cors' }) : new Request(url);
                    return fetch(req).then((res) => {
                        return cache.put(req, res);
                    }).catch((err) => {
                        console.warn(`[SW POS v3] Recurso no pre-cacheado en install (${url}):`, err);
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

    // 3. Estrategia Cache-First con Stale-While-Revalidate
    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            // A. Si es navegación de documento HTML (F5, recarga o navegación de página)
            if (request.mode === 'navigate') {
                let navResponse = await cache.match(request, { ignoreSearch: true });
                if (!navResponse) {
                    if (url.pathname.includes('emitir_ticket')) {
                        navResponse = await cache.match('./emitir_ticket.html');
                    } else if (url.pathname.includes('arqueo_caja')) {
                        navResponse = await cache.match('./arqueo_caja.html');
                    } else if (url.pathname.includes('registros_historicos_ventas')) {
                        navResponse = await cache.match('./registros_historicos_ventas.html');
                    }
                }

                if (navResponse) {
                    // Si hay conexión, refrescar la caché en segundo plano de manera silenciosa
                    fetch(request).then((res) => {
                        if (res && res.status === 200) cache.put(request, res.clone());
                    }).catch(() => {/* Offline */});
                    return navResponse;
                }
            }

            // B. Buscar coincidencia exacta o relativa en caché
            const cachedResponse = await cache.match(request);
            if (cachedResponse) {
                // Actualizar silenciosamente en segundo plano si hay red
                fetch(request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        cache.put(request, networkResponse.clone());
                    }
                }).catch(() => {/* Offline */});

                return cachedResponse;
            }

            // C. Si no estaba en caché, buscar en la red y cachear
            try {
                const networkResponse = await fetch(request);
                if (networkResponse && networkResponse.status === 200) {
                    cache.put(request, networkResponse.clone());
                }
                return networkResponse;
            } catch (networkError) {
                // Fallbacks de contingencia ante ausencia de conexión
                if (request.mode === 'navigate') {
                    if (url.pathname.includes('emitir_ticket')) {
                        const fallbackTicket = await cache.match('./emitir_ticket.html');
                        if (fallbackTicket) return fallbackTicket;
                    }
                    if (url.pathname.includes('arqueo_caja')) {
                        const fallbackArqueo = await cache.match('./arqueo_caja.html');
                        if (fallbackArqueo) return fallbackArqueo;
                    }
                    if (url.pathname.includes('registros_historicos_ventas')) {
                        const fallbackHist = await cache.match('./registros_historicos_ventas.html');
                        if (fallbackHist) return fallbackHist;
                    }
                }

                // Fallbacks limpios para scripts, estilos o imágenes (evita excepciones rojas en Chrome)
                if (request.destination === 'script') {
                    return new Response('/* offline script fallback */', {
                        headers: { 'Content-Type': 'application/javascript' }
                    });
                }
                if (request.destination === 'style') {
                    return new Response('/* offline style fallback */', {
                        headers: { 'Content-Type': 'text/css' }
                    });
                }
                if (request.destination === 'image') {
                    return new Response('', {
                        headers: { 'Content-Type': 'image/png' }
                    });
                }

                // Si no hay respuesta ni fallback, retornar 503 limpio en lugar de lanzar una excepción fatal
                return new Response('Recurso no disponible offline', {
                    status: 503,
                    statusText: 'Service Unavailable (Offline)'
                });
            }
        })
    );
});
