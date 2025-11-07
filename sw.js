// Service Worker para Resonate - Reproductor de Música
const CACHE_NAME = 'resonate-v2.1.1';
const STATIC_CACHE = 'resonate-static-v2.1.1';
const AUDIO_CACHE = 'resonate-audio-v2.1.1';

// Archivos críticos para el funcionamiento de la app
const STATIC_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-72x72.png',
  './icons/icon-96x96.png',
  './icons/icon-128x128.png',
  './icons/icon-144x144.png',
  './icons/icon-152x152.png',
  './icons/icon-192x192.png',
  './icons/icon-384x384.png',
  './icons/icon-512x512.png'
];

// Instalación del Service Worker
self.addEventListener('install', (event) => {
  console.log('Service Worker: Instalando...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('Service Worker: Cacheando archivos estáticos');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        console.log('Service Worker: Instalación completada');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Error en instalación', error);
      })
  );
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activando...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Eliminar caches antiguos
          if (cacheName !== STATIC_CACHE && cacheName !== AUDIO_CACHE && cacheName !== CACHE_NAME) {
            console.log('Service Worker: Eliminando cache antiguo', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker: Activación completada');
      return self.clients.claim();
    })
  );
});

// Estrategia de cache para archivos de audio
self.addEventListener('fetch', (event) => {
  // Solo manejar peticiones HTTP/HTTPS
  if (!event.request.url.startsWith('http')) {
    return;
  }

  const url = new URL(event.request.url);
  
  // Estrategia para archivos de audio
  if (url.pathname.includes('/download/') || 
      event.request.headers.get('accept')?.includes('audio') ||
      url.pathname.endsWith('.mp3') || 
      url.pathname.endsWith('.ogg') || 
      url.pathname.endsWith('.wav') ||
      url.pathname.endsWith('.flac') ||
      url.pathname.endsWith('.m4a')) {
    
    event.respondWith(
      caches.open(AUDIO_CACHE).then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response) {
            // Devolver desde cache y actualizar en segundo plano
            fetchAndCache(event.request, cache);
            return response;
          }
          
          // Si no está en cache, buscar en la red
          return fetchAndCache(event.request, cache);
        });
      }).catch(() => {
        // Fallback si todo falla
        return fetch(event.request);
      })
    );
    return;
  }
  
  // Estrategia para archivos estáticos (Cache First)
  if (STATIC_FILES.some(file => url.pathname.endsWith(file))) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }
  
  // Estrategia para API requests (Network First)
  if (url.href.includes('archive.org')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cachear respuestas exitosas de API
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback a cache si no hay conexión
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Estrategia por defecto (Network First)
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});

// Función auxiliar para buscar y cachear
function fetchAndCache(request, cache) {
  return fetch(request).then((response) => {
    if (response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch((error) => {
    console.log('Error en fetchAndCache:', error);
    throw error;
  });
}

// Manejo de mensajes desde la aplicación
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_AUDIO_CACHE') {
    caches.delete(AUDIO_CACHE).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});

// Manejo de sincronización en background
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    console.log('Service Worker: Sincronización en background');
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Aquí puedes implementar sincronización de datos
  // como favoritos, listas de reproducción, etc.
  console.log('Realizando sincronización en background...');
}

// Manejo de notificaciones push
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || 'Nueva notificación de Resonate',
    icon: './icons/icon-192x192.png',
    badge: './icons/icon-72x72.png',
    tag: 'resonate-notification',
    renotify: true,
    actions: [
      {
        action: 'play',
        title: 'Reproducir'
      },
      {
        action: 'dismiss',
        title: 'Cerrar'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Resonate', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'play') {
    // Enfocar o abrir la aplicación y reproducir
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus().then(() => {
              // Enviar mensaje para reproducir
              return client.postMessage({ action: 'play' });
            });
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('./');
        }
      })
    );
  } else {
    // Acción por defecto: abrir la aplicación
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('./');
        }
      })
    );
  }
});