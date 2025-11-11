// sw.js - Service Worker mejorado para caché de audio y metadatos
const CACHE_NAME = 'resonate-audio-cache-v3';
const STATIC_CACHE = 'static-resonate-v3';
const METADATA_CACHE = 'metadata-resonate-v2';

// Archivos críticos para caché
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Estrategias de caché
const CACHE_STRATEGIES = {
  STATIC: 'cache-first',
  AUDIO: 'cache-first',
  METADATA: 'stale-while-revalidate',
  API: 'network-first'
};

self.addEventListener('install', (event) => {
  console.log('Service Worker mejorado instalando...');
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE)
        .then(cache => {
          console.log('Cacheando archivos estáticos críticos');
          return cache.addAll(STATIC_FILES);
        }),
      caches.open(METADATA_CACHE)
        .then(cache => {
          console.log('Cache de metadatos listo');
          return true;
        })
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker mejorado activado');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Eliminar caches antiguos
          if (![STATIC_CACHE, CACHE_NAME, METADATA_CACHE].includes(cacheName)) {
            console.log('Eliminando cache antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Estrategia Cache First para archivos estáticos
  if (STATIC_FILES.some(file => url.pathname.endsWith(file))) {
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
    return;
  }

  // Estrategia Cache First para archivos de audio de archive.org
  if (url.pathname.includes('/download/') && 
      (url.pathname.endsWith('.mp3') || 
       url.pathname.endsWith('.ogg') || 
       url.pathname.endsWith('.wav'))) {
    event.respondWith(handleAudioRequest(event.request));
    return;
  }

  // Estrategia Stale-While-Revalidate para metadatos
  if (url.pathname.includes('/metadata/') || 
      url.pathname.includes('/advancedsearch.php')) {
    event.respondWith(handleMetadataRequest(event.request));
    return;
  }

  // Estrategia Network First para otras peticiones
  event.respondWith(handleApiRequest(event.request));
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

// Manejar mensajes para limpiar caché
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});