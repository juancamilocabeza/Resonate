// sw.js - Enhanced Service Worker for audio and metadata caching
const CACHE_NAMES = {
  APP: 'resonate-v4',
  STATIC: 'static-v4',
  METADATA: 'metadata-v4'
};

// Critical files for caching
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/resonate.css',
  '/js/theme.js',
  '/js/logger.js',
  '/js/cache.js',
  '/js/playback.js',
  '/js/search.js',
  '/js/ui.js',
  '/js/tracklist.js',
  '/js/offline.js',
  '/js/onboarding.js',
  '/js/initialization.js',
  '/icons/favicon.svg',
  '/icons/maskable_icon_x192.png',
  '/icons/maskable_icon_x384.png',
  '/icons/maskable_icon_x512.png'
];

function isExtensionUrl(urlString) {
  return urlString.includes('chrome-extension') || urlString.includes('moz-extension');
}

function getUrl(request) {
  try {
    return new URL(request.url);
  } catch {
    return null;
  }
}

function isSameOrigin(url) {
  return url && url.origin === self.location.origin;
}

function isStaticAsset(url) {
  if (!isSameOrigin(url)) return false;
  const path = url.pathname;
  return (
    path === '/' ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.html') ||
    path.endsWith('.json') ||
    path.endsWith('.svg') ||
    path.endsWith('.png') ||
    path.endsWith('.ico')
  );
}

function isArchiveOrg(url) {
  return url && url.hostname === 'archive.org';
}

function isArchiveImageRequest(url) {
  return isArchiveOrg(url) && url.pathname.includes('/services/img/');
}

function isAudioRequest(request, url) {
  if (request.destination === 'audio') return true;
  if (!isArchiveOrg(url)) return false;
  const path = url.pathname.toLowerCase();
  return path.endsWith('.ogg') || path.endsWith('.mp3');
}

function isMetadataRequest(url) {
  return isArchiveOrg(url) && url.pathname.includes('/metadata/');
}

function offlineHtmlResponse(title, heading, bodyText) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><div style="font-family:system-ui;padding:16px;text-align:center;margin-top:48px"><h2>${heading}</h2><p>${bodyText}</p><button onclick="location.reload()" style="margin-top:16px;padding:12px 24px;font-size:16px;cursor:pointer">Reload</button></div></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html' } });
}

async function precacheStaticFiles() {
  const cache = await caches.open(CACHE_NAMES.STATIC);
  console.log('SW: Caching static files:', STATIC_FILES);

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
      console.warn('SW: Failed to fetch/cache:', file, error && error.message ? error.message : String(error));
    }
  });

  await Promise.allSettled(cachePromises);
  console.log('SW: Static files caching complete (some may have failed)');
}

async function cacheFirstWithBackgroundUpdate(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            caches.open(CACHE_NAMES.STATIC).then((cache) => {
              cache.put(request, networkResponse);
            });
          }
        })
        .catch(() => {
          /* ignore background update failures */
        });
      return cachedResponse;
    }
  } catch (cacheError) {
    console.warn('Cache lookup failed for static asset:', cacheError);
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const responseClone = networkResponse.clone();
      caches.open(CACHE_NAMES.STATIC)
        .then((cache) => cache.put(request, responseClone))
        .catch(() => {});
      return networkResponse;
    }
  } catch (networkError) {
    console.error('Failed to load static asset:', request.url, networkError);
  }

  // Critical static assets fall back to a minimal offline page
  const url = getUrl(request);
  if (url && (url.pathname.endsWith('.html') || url.pathname === '/')) {
    return offlineHtmlResponse('Offline', 'Unable to load app', 'Please check your connection and reload.');
  }

  return new Response('Service unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

async function cacheFirst(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;
  } catch (cacheError) {
    console.warn('Cache lookup failed for static asset:', cacheError);
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const responseClone = networkResponse.clone();
      caches.open(CACHE_NAMES.STATIC)
        .then((cache) => cache.put(request, responseClone))
        .catch(() => {});
      return networkResponse;
    }
  } catch (networkError) {
    console.error('Failed to load static asset:', request.url, networkError);
  }

  return new Response('Service unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

async function networkFirstExternal(request, url) {
  const audio = isAudioRequest(request, url);
  const metadata = isMetadataRequest(url);

  // For audio with Range headers, pass through to enable proper streaming
  // This allows the browser to handle partial content requests efficiently
  if (audio && request.headers.has('Range')) {
    console.log('SW: Passing through Range request for audio streaming:', request.url);
    return fetch(request);
  }

  try {
    const networkResponse = await fetch(request);

    if (!networkResponse || !networkResponse.ok || networkResponse.type === 'error') {
      console.warn('Invalid network response for:', request.url);
      throw new Error('Invalid network response');
    }

    // Cache metadata responses (separated cache); avoid duplicating audio already cached by app
    if (metadata) {
      const responseClone = networkResponse.clone();
      caches.open(CACHE_NAMES.METADATA)
        .then((cache) => cache.put(request, responseClone))
        .catch((err) => console.warn('Failed to cache metadata response:', err));
    }

    return networkResponse;
  } catch (error) {
    console.warn('Network fetch failed for:', request.url, error);

    // Try cache fallback
    try {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        console.log('Serving from cache:', request.url);
        return cachedResponse;
      }
    } catch (cacheError) {
      console.warn('Cache lookup failed:', cacheError);
    }

    // Provide meaningful offline fallbacks
    if (audio) {
      return new Response('Audio not available offline. Please check your connection and try again.', {
        status: 503,
        statusText: 'Service Unavailable - Offline',
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    if (metadata) {
      return new Response(
        JSON.stringify({
          error: 'offline',
          message: 'Metadata not available offline'
        }),
        {
          status: 503,
          statusText: 'Service Unavailable - Offline',
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (request.destination === 'document') {
      const candidates = [request, '/index.html', '/'];
      for (const candidate of candidates) {
        try {
          const resp = await caches.match(candidate);
          if (resp) return resp;
        } catch {
          // ignore and keep trying
        }
      }

      return offlineHtmlResponse('Offline', 'You are offline', 'Please reconnect and reload.');
    }

    return new Response('Service unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

// Service Worker installation - more aggressive caching
self.addEventListener('install', (event) => {
  console.log('SW: Installing service worker');
  event.waitUntil(
    precacheStaticFiles()
  );
  self.skipWaiting(); // Activate immediately
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('v1').then((cache) => {
      const resourcesToCache = [
        '/',
        '/index.html',
        '/css/resonate.css',
        '/js/ui.js',
        '/js/playback.js',
        '/js/search.js'
      ];

      return Promise.all(
        resourcesToCache.map((resource) =>
          fetch(resource).then((response) => {
            if (!response.ok) {
              throw new Error(`Failed to fetch ${resource}: ${response.statusText}`);
            }
            return cache.put(resource, response);
          })
        )
      );
    }).catch((error) => {
      console.error('Failed to cache resources during install:', error);
    })
  );
});

// Activation and cleanup of old caches
self.addEventListener('activate', (event) => {
  console.log('SW: Activating service worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      console.log('SW: Current caches:', cacheNames);
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== CACHE_NAMES.APP &&
            cacheName !== CACHE_NAMES.STATIC &&
            cacheName !== CACHE_NAMES.METADATA
          ) {
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

self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and certain destinations
  if (event.request.method !== 'GET' ||
      isExtensionUrl(event.request.url)) {
    return;
  }

  const url = getUrl(event.request);
  if (!url) return;

  // Never intercept the service worker script itself
  if (url.pathname === '/sw.js') {
    return; // let the browser fetch it directly
  }

  // Only handle our own assets and archive.org. Avoid intercepting third-party
  // scripts (e.g. analytics) which can otherwise show confusing 503 errors.
  if (!isSameOrigin(url) && !isArchiveOrg(url)) {
    return;
  }

  // Skip service worker handling for Archive.org images - let them fail naturally
  if (isArchiveImageRequest(url)) {
    return;
  }

  event.respondWith(
    (async () => {
      // Some browsers request /favicon.ico even when an SVG favicon is declared.
      // Serve our existing SVG favicon to avoid 404s and repeated network noise.
      if (url.pathname === '/favicon.ico') {
        return Response.redirect('/icons/favicon.svg', 302);
      }

      // CACHE-FIRST strategy for our static assets
      if (isStaticAsset(url)) {
        const path = url.pathname;
        const isAppShell = path === '/' || path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css');
        // Avoid background revalidation for frequently-requested assets (favicon/manifest/icons)
        // which otherwise show up as repeated downloads in DevTools.
        return isAppShell ? cacheFirstWithBackgroundUpdate(event.request) : cacheFirst(event.request);
      }

      // NETWORK_FIRST strategy for archive.org resources
      return networkFirstExternal(event.request, url);
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    // Keep app-shell cache; clear data caches.
    Promise.allSettled([
      caches.delete(CACHE_NAMES.APP),
      caches.delete(CACHE_NAMES.METADATA)
    ]).then(() => {
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
