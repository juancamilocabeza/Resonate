// sw.js - Service Worker mejorado para caché de audio y metadatos
const CACHE_NAME = 'resonate-v1';
const STATIC_CACHE = 'static-v1';
const METADATA_CACHE = 'metadata-v1';

// Archivos críticos para caché
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/resonate.css',
  '/sw.js'
];

const CACHE_STRATEGIES = {
  STATIC: 'cache-first',
  AUDIO: 'cache-first',
  METADATA: 'stale-while-revalidate',
  API: 'network-first'
};

// Instalación del Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_FILES);
    })
  );
  self.skipWaiting(); // Activar inmediatamente
});

// Activación y limpieza de cachés antiguos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Estrategia de actualización: Network First, luego Cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(event.request);

        // Validar que la respuesta sea válida
        if (!networkResponse || !networkResponse.ok || networkResponse.type === 'error') {
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) {
            return cachedResponse;
          }
          // Si no hay cache y respuesta inválida, retornar error
          return new Response('Network error', {
            status: 408,
            statusText: 'Request Timeout',
            headers: { 'Content-Type': 'text/plain' }
          });
        }

        // Cache exitoso si es audio o metadatos (solo .ogg y .mp3 para audio)
        const url = new URL(event.request.url);
        if (url.hostname === 'archive.org' && (
          (event.request.destination === 'audio' && (url.pathname.toLowerCase().endsWith('.ogg') || url.pathname.toLowerCase().endsWith('.mp3'))) ||
          url.pathname.includes('/metadata/') ||
          url.pathname.includes('/services/img/') ||
          (url.pathname.includes('/download/') && url.pathname.toLowerCase().endsWith('.ogg'))
        )) {
          // Clonar la respuesta ANTES de retornarla para evitar que el body sea consumido
          const responseClone = networkResponse.clone();
          // Cache en segundo plano para no bloquear
          caches.open(CACHE_NAME).then((cache) => {
            return cache.put(event.request, responseClone);
          }).catch((err) => {
            console.warn('Failed to cache response:', err);
          });
        }

        return networkResponse;
      } catch (error) {
        console.warn('Network fetch failed for:', event.request.url, error);
        // Intentar desde caché
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        // Si no hay cache disponible
        return new Response('Network unavailable and not in cache', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: true });
      }
    });
  }

  // Soporta activación inmediata desde la página (skipWaiting)
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('SW: recibir SKIP_WAITING desde cliente, ejecutando skipWaiting()');
    self.skipWaiting();
  }
});

async function handleAudioRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  // Devolver desde caché si está disponible
  if (cachedResponse) {
    // Actualizar caché en segundo plano
    fetchAndCache(request, cache);
    return cachedResponse;
  }

  // Si no está en caché, buscar en red y cachear
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.status === 200) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Si falla la red, devolver error
    return new Response('Network error', {
      status: 408,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function handleMetadataRequest(request) {
  const cache = await caches.open(METADATA_CACHE);
  const cachedResponse = await cache.match(request);

  // Siempre intentar obtener datos frescos
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.status === 200) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Si falla la red, usar caché si está disponible
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

async function handleApiRequest(request) {
  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

async function fetchAndCache(request, cache) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.status === 200) {
      await cache.put(request, networkResponse);
    }
  } catch (error) {
    console.log('Error actualizando caché en segundo plano:', error);
  }
}
