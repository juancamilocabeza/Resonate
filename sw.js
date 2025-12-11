// sw.js - Enhanced Service Worker for audio and metadata caching
const CACHE_NAME = 'resonate-v1';
const STATIC_CACHE = 'static-v1';
const METADATA_CACHE = 'metadata-v1';

// Critical files for caching
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/resonate.css',
  '/sw.js',
  '/js/logger.js',
  '/js/cache.js',
  '/js/playback.js',
  '/js/search.js',
  '/js/ui.js',
  '/js/initialization.js',
  '/icons/favicon.svg',
  '/icons/maskable_icon_x192.png',
  '/icons/maskable_icon_x384.png',
  '/icons/maskable_icon_x512.png'
];

const CACHE_STRATEGIES = {
  STATIC: 'cache-first',
  AUDIO: 'cache-first',
  METADATA: 'stale-while-revalidate',
  API: 'network-first'
};

// Service Worker installation
self.addEventListener('install', (event) => {
  console.log('SW: Installing service worker');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('SW: Caching static files:', STATIC_FILES);
      return cache.addAll(STATIC_FILES).catch((error) => {
        console.error('SW: Failed to cache static files:', error);
        // Continue even if some files fail to cache
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting(); // Activate immediately
});

// Activation and cleanup of old caches
self.addEventListener('activate', (event) => {
  console.log('SW: Activating service worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      console.log('SW: Current caches:', cacheNames);
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== STATIC_CACHE && cacheName !== METADATA_CACHE) {
            console.log('SW: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('SW: Claiming clients');
      return self.clients.claim();
    })
  );
});

// Update strategy: Network First, then Cache with better offline handling
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and certain destinations
  if (event.request.method !== 'GET' ||
      event.request.url.includes('chrome-extension') ||
      event.request.url.includes('moz-extension')) {
    return;
  }

  const url = new URL(event.request.url);
  const isArchiveOrg = url.hostname === 'archive.org';
  const isImageRequest = isArchiveOrg && url.pathname.includes('/services/img/');

  // Skip service worker handling for Archive.org images - let them fail naturally
  if (isImageRequest) {
    return;
  }

  event.respondWith(
    (async () => {
      const isAudioRequest = event.request.destination === 'audio' ||
                           (isArchiveOrg && (url.pathname.toLowerCase().endsWith('.ogg') ||
                                           url.pathname.toLowerCase().endsWith('.mp3')));
      const isMetadataRequest = isArchiveOrg && url.pathname.includes('/metadata/');

      try {
        // Try network first
        const networkResponse = await fetch(event.request);

        // Validate response
        if (!networkResponse || !networkResponse.ok || networkResponse.type === 'error') {
          console.warn('Invalid network response for:', event.request.url);
          throw new Error('Invalid network response');
        }

        // Cache successful responses for audio and metadata
        if (isAudioRequest || isMetadataRequest) {
          const responseClone = networkResponse.clone();
          // Cache in background
          caches.open(CACHE_NAME).then((cache) => {
            return cache.put(event.request, responseClone);
          }).catch((err) => {
            console.warn('Failed to cache response:', err);
          });
        }

        return networkResponse;
      } catch (error) {
        console.warn('Network fetch failed for:', event.request.url, error);

        // Try cache fallback
        try {
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) {
            console.log('Serving from cache:', event.request.url);
            return cachedResponse;
          }
        } catch (cacheError) {
          console.warn('Cache lookup failed:', cacheError);
        }

        // Provide meaningful offline fallbacks
        if (isAudioRequest) {
          return new Response('Audio not available offline. Please check your connection and try again.', {
            status: 503,
            statusText: 'Service Unavailable - Offline',
            headers: { 'Content-Type': 'text/plain' }
          });
        } else if (isMetadataRequest) {
          // Return cached metadata if available, otherwise generic offline message
          return new Response(JSON.stringify({
            error: 'offline',
            message: 'Metadata not available offline'
          }), {
            status: 503,
            statusText: 'Service Unavailable - Offline',
            headers: { 'Content-Type': 'application/json' }
          });
        } else if (event.request.destination === 'document') {
          // For main app requests, try to serve app shell from cache
          const cachedApp = await caches.match('/');
          if (cachedApp) {
            return cachedApp;
          }
        }

        // Generic offline response - return empty response instead of error message
        // This prevents showing confusing error messages to users
        if (event.request.destination === 'document') {
          // For document requests, try to serve cached app shell
          const appShell = await caches.match('/');
          if (appShell) {
            return appShell;
          }
        }

        // Return no-content response to prevent error messages
        return new Response(null, {
          status: 204, // No Content
          statusText: 'Offline Mode',
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

  // Support immediate activation from the page (skipWaiting)
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('SW: receiving SKIP_WAITING from client, executing skipWaiting()');
    self.skipWaiting();
  }
});

async function handleAudioRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  // Return from cache if available
  if (cachedResponse) {
    // Update cache in background
    fetchAndCache(request, cache);
    return cachedResponse;
  }

  // If not in cache, fetch from network and cache
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.status === 200) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // If network fails, return error
    return new Response('Network error', {
      status: 408,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function handleMetadataRequest(request) {
  const cache = await caches.open(METADATA_CACHE);
  const cachedResponse = await cache.match(request);

  // Always try to get fresh data
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.status === 200) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // If network fails, use cache if available
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
    console.log('Error updating cache in background:', error);
  }
}
