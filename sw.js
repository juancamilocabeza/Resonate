// sw.js - Service Worker mejorado para Android Auto
const CACHE_NAME = 'resonate-v2.1.0';
const STATIC_CACHE = 'static-v2.1.0';
const AUDIO_CACHE = 'audio-cache-v1';

// Archivos críticos para caché
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/favicon-192.png',
  '/icons/favicon-512.png'
];

self.addEventListener('install', (event) => {
  console.log('Service Worker instalando...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('Cacheando archivos estáticos');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activado');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== STATIC_CACHE && cacheName !== AUDIO_CACHE) {
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
  
  // Estrategia Network First para audio (para Android Auto)
  if (event.request.url.includes('archive.org/download') || 
      event.request.headers.get('accept')?.includes('audio')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cachear respuesta de audio para uso offline
          const responseClone = response.clone();
          caches.open(AUDIO_CACHE)
            .then(cache => cache.put(event.request, responseClone));
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Para otras peticiones
  event.respondWith(fetch(event.request));
});

// Background Sync para Android Auto
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-audio-sync') {
    console.log('Background sync para audio');
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Sincronización en segundo plano para precargar contenido
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'BACKGROUND_SYNC',
      message: 'Precargando contenido para Android Auto'
    });
  });
}