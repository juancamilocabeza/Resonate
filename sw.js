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
  '/js/resonate.js',
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
    fetch(event.request)
      .then((response) => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return caches.match(event.request);
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
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
