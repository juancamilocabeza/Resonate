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

// Service Worker installation - more aggressive caching
self.addEventListener('install', (event) => {
  console.log('SW: Installing service worker');
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      console.log('SW: Caching static files:', STATIC_FILES);
      
      // Cache files one by one with better error handling
      const cachePromises = STATIC_FILES.map(async (file) => {
        try {
          const response = await fetch(file);
          if (response.ok) {
            await cache.put(file, response);
            console.log('SW: Cached:', file);
          } else {
            console.warn('SW: Failed to cache (non-OK response):', file, response.status);
          }
        } catch (error) {
          console.warn('SW: Failed to fetch/cache:', file, error.message);
        }
      });
      
      await Promise.allSettled(cachePromises);
      console.log('SW: Static files caching complete (some may have failed)');
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

// Cache-first for own assets, Network-first for external resources
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
  const isSameOrigin = url.origin === self.location.origin;
  
  // Identify static assets (our own files)
  const isStaticAsset = isSameOrigin && (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname === '/'
  );

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

      // CACHE-FIRST strategy for our static assets
      if (isStaticAsset) {
        try {
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) {
            console.log('Serving static asset from cache:', event.request.url);
            // Update cache in background
            fetch(event.request).then(networkResponse => {
              if (networkResponse && networkResponse.ok) {
                caches.open(STATIC_CACHE).then(cache => {
                  cache.put(event.request, networkResponse);
                });
              }
            }).catch(() => {/* ignore background update failures */});
            return cachedResponse;
          }
        } catch (cacheError) {
          console.warn('Cache lookup failed for static asset:', cacheError);
        }

        // If not in cache, try network
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(STATIC_CACHE).then(cache => {
              cache.put(event.request, responseClone);
            }).catch(() => {});
            return networkResponse;
          }
        } catch (networkError) {
          console.error('Failed to load static asset:', event.request.url, networkError);
          // For critical static assets, return error page
          if (url.pathname.endsWith('.html') || url.pathname === '/') {
            const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title></head><body><div style="font-family:system-ui;padding:16px;text-align:center;margin-top:48px"><h2>Unable to load app</h2><p>Please check your connection and reload.</p><button onclick="location.reload()" style="margin-top:16px;padding:12px 24px;font-size:16px;cursor:pointer">Reload</button></div></body></html>';
            return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html' } });
          }
        }
      }

      // NETWORK-FIRST strategy for external resources (archive.org)
      try {
        // Try network first
        const networkResponse = await fetch(event.request);

        // Validate response
        if (!networkResponse || !networkResponse.ok || networkResponse.type === 'error') {
          console.warn('Invalid network response for:', event.request.url);
          throw new Error('Invalid network response');
        }

        // Cache metadata only; avoid duplicating audio already cached by app
        if (isMetadataRequest) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            return cache.put(event.request, responseClone);
          }).catch((err) => {
            console.warn('Failed to cache metadata response:', err);
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
        }
        
        if (isMetadataRequest) {
          // Return cached metadata if available, otherwise generic offline message
          return new Response(JSON.stringify({
            error: 'offline',
            message: 'Metadata not available offline'
          }), {
            status: 503,
            statusText: 'Service Unavailable - Offline',
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        if (event.request.destination === 'document') {
          // Robust app shell fallback: try request, index.html, and root
          const candidates = [event.request, '/index.html', '/'];
          for (const candidate of candidates) {
            try {
              const resp = await caches.match(candidate);
              if (resp) return resp;
            } catch {}
          }
          
          // Final fallback: return a minimal offline page
          const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title></head><body><div style="font-family:system-ui;padding:16px;text-align:center;margin-top:48px"><h2>You are offline</h2><p>Please reconnect and reload.</p><button onclick="location.reload()" style="margin-top:16px;padding:12px 24px;font-size:16px;cursor:pointer">Reload</button></div></body></html>';
          return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html' } });
        }

        // For other external requests, return 503 (not 408)
        return new Response('Service unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } });
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

  // Clear old audio cache to reclaim disk (one-time)
  if (event.data && event.data.type === 'CLEAR_AUDIO_CACHE') {
    console.log('SW: Clearing old audio cache (resonate-v1) to reclaim disk space');
    caches.delete('resonate-v1').then(() => {
      console.log('SW: Old audio cache deleted successfully');
    }).catch(err => {
      console.warn('SW: Failed to delete old audio cache:', err);
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
