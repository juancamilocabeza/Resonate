// sw.js - Enhanced Service Worker for audio and metadata caching
const CACHE_NAMES = {
  APP: 'resonate-v17',
  STATIC: 'static-v17',
  METADATA: 'metadata-v17',
  SEARCH: 'search-v17'
};

function deriveSwVersion() {
  try {
    const candidates = [CACHE_NAMES.STATIC, CACHE_NAMES.APP, CACHE_NAMES.METADATA, CACHE_NAMES.SEARCH].filter(Boolean);
    const raw = String(candidates[0] || '').trim();
    const m = raw.match(/-v(\d+)/i) || raw.match(/\bv(\d+)\b/i);
    return m ? String(m[1]) : (raw || 'unknown');
  } catch {
    return 'unknown';
  }
}

const SW_VERSION = deriveSwVersion();

// Must be defined before activate/fetch handlers so it can be preserved.
const AUDIO_CACHE_NAME = 'audio-cache-v1';

const RUNTIME_CACHE_LIMITS = {
  SEARCH_MAX_ENTRIES: 80,
  METADATA_MAX_ENTRIES: 300
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
  '/js/battery.js',
  '/js/initialization.js',
  '/icons/favicon.svg',
  '/icons/sprite.svg',
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

function isArchiveSearchRequest(url) {
  return isArchiveOrg(url) && url.pathname === '/advancedsearch.php';
}

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (!keys || keys.length <= maxEntries) return;
    const toDelete = keys.length - maxEntries;
    for (let i = 0; i < toDelete; i++) {
      await cache.delete(keys[i]);
    }
  } catch {
    // ignore trim failures
  }
}

async function cacheFirstWithBackgroundUpdateExternal(event, request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);

  try {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      // Update in background while serving the cached response immediately.
      event.waitUntil(
        (async () => {
          try {
            const networkResponse = await fetch(request);
            if (!networkResponse || !networkResponse.ok || networkResponse.type === 'error' || networkResponse.type === 'opaque') return;

            const contentType = networkResponse.headers && networkResponse.headers.get
              ? (networkResponse.headers.get('Content-Type') || '')
              : '';

            // Only cache JSON-like responses to avoid storing error HTML pages.
            if (contentType && !contentType.includes('application/json')) return;

            await cache.put(request, networkResponse.clone());
            if (typeof maxEntries === 'number' && maxEntries > 0) {
              await trimCache(cacheName, maxEntries);
            }
          } catch {
            // ignore background update failures
          }
        })()
      );

      return cachedResponse;
    }
  } catch {
    // ignore cache match failures
  }

  // No cached response: go to network and cache if usable.
  const networkResponse = await fetch(request);
  if (networkResponse && networkResponse.ok && networkResponse.type !== 'error' && networkResponse.type !== 'opaque') {
    const contentType = networkResponse.headers && networkResponse.headers.get
      ? (networkResponse.headers.get('Content-Type') || '')
      : '';

    if (!contentType || contentType.includes('application/json')) {
      try {
        await cache.put(request, networkResponse.clone());
        if (typeof maxEntries === 'number' && maxEntries > 0) {
          await trimCache(cacheName, maxEntries);
        }
      } catch {
        // ignore cache put failures
      }
    }
  }

  return networkResponse;
}

function offlineHtmlResponse(title, heading, bodyText) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><div style="font-family:system-ui;padding:16px;text-align:center;margin-top:48px"><h2>${heading}</h2><p>${bodyText}</p><button onclick="location.reload()" style="margin-top:16px;padding:12px 24px;font-size:16px;cursor:pointer">Reload</button></div></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html' } });
}

function getContentType(response) {
  try {
    return String(response && response.headers && response.headers.get ? (response.headers.get('Content-Type') || '') : '');
  } catch {
    return '';
  }
}

function isCacheableStaticResponse(url, response) {
  if (!(response && response.ok)) return false;
  if (!isSameOrigin(url)) return false;

  const ct = getContentType(response).toLowerCase();
  const path = url && url.pathname ? String(url.pathname).toLowerCase() : '';

  // If the server returns HTML for a JS/CSS/JSON URL (redirect, 404 rewrite, etc.),
  // caching it would brick the app. Be strict for core asset types.
  if (path.endsWith('.js')) return ct.includes('javascript');
  if (path.endsWith('.css')) return ct.includes('text/css');
  if (path.endsWith('.json')) return ct.includes('application/json');
  if (path.endsWith('.html') || path === '/' || path === '/index.html') return ct.includes('text/html');

  // For images/icons we can be a bit looser.
  if (path.endsWith('.svg')) return ct.includes('image/svg');
  if (path.endsWith('.png')) return ct.includes('image/png');
  if (path.endsWith('.ico')) return ct.includes('image/') || ct.includes('x-icon');

  return true;
}

async function precacheStaticFiles() {
  const cache = await caches.open(CACHE_NAMES.STATIC);
  console.log('SW: Caching static files:', STATIC_FILES);

  const cachePromises = STATIC_FILES.map(async (file) => {
    try {
      const response = await fetch(file);
      const url = (() => {
        try { return new URL(file, self.location.origin); } catch { return null; }
      })();
      if (response.ok && url && isCacheableStaticResponse(url, response)) {
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
          const url = getUrl(request);
          if (url && networkResponse && isCacheableStaticResponse(url, networkResponse)) {
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
    const url = getUrl(request);
    if (url && networkResponse && isCacheableStaticResponse(url, networkResponse)) {
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
    const url = getUrl(request);
    if (url && networkResponse && isCacheableStaticResponse(url, networkResponse)) {
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
  event.waitUntil(precacheStaticFiles());
  // Mode B (prompt): do not activate automatically.
  // The page will call SKIP_WAITING / SKIP_WAITING_WHEN_IDLE after the user approves.
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
            cacheName !== CACHE_NAMES.METADATA &&
            cacheName !== CACHE_NAMES.SEARCH &&
            cacheName !== AUDIO_CACHE_NAME
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

      // App-shell routing for navigations (including deep links like /?play=...)
      // Serve a stable cached HTML document regardless of query params.
      const isNavigationRequest = event.request.mode === 'navigate' || event.request.destination === 'document';
      if (isNavigationRequest && isSameOrigin(url)) {
        const shellPath = '/index.html';
        try {
          const cachedShell =
            (await caches.match(shellPath, { ignoreSearch: true })) ||
            (await caches.match('/', { ignoreSearch: true }));

          if (cachedShell) {
            // Important: keep the app shell fresh.
            // Without revalidation, users can get stuck on an old cached index.html forever.
            event.waitUntil(
              (async () => {
                try {
                  const networkShell = await fetch(shellPath, { cache: 'no-cache' });
                  if (networkShell && networkShell.ok) {
                    const cache = await caches.open(CACHE_NAMES.STATIC);
                    await cache.put(shellPath, networkShell.clone());
                  }
                } catch {
                  // ignore background update failures
                }
              })()
            );

            return cachedShell;
          }
        } catch {
          // ignore cache lookup failures
        }

        try {
          const networkShell = await fetch(shellPath, { cache: 'no-cache' });
          if (networkShell && networkShell.ok) {
            try {
              const cache = await caches.open(CACHE_NAMES.STATIC);
              await cache.put(shellPath, networkShell.clone());
            } catch {
              // ignore cache put failures
            }
            return networkShell;
          }
        } catch {
          // ignore
        }

        return offlineHtmlResponse('Offline', 'Unable to load app', 'Please check your connection and reload.');
      }

      // CACHE-FIRST strategy for our static assets
      if (isStaticAsset(url)) {
        const path = url.pathname;
        const isAppShell = path === '/' || path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css');
        // Avoid background revalidation for frequently-requested assets (favicon/manifest/icons)
        // which otherwise show up as repeated downloads in DevTools.
        return isAppShell ? cacheFirstWithBackgroundUpdate(event.request) : cacheFirst(event.request);
      }

      // Runtime cache for archive.org JSON endpoints (search + metadata)
      if (isArchiveSearchRequest(url)) {
        try {
          return await cacheFirstWithBackgroundUpdateExternal(event, event.request, CACHE_NAMES.SEARCH, RUNTIME_CACHE_LIMITS.SEARCH_MAX_ENTRIES);
        } catch (err) {
          // Cache fallback
          try {
            const cache = await caches.open(CACHE_NAMES.SEARCH);
            const cached = await cache.match(event.request);
            if (cached) return cached;
          } catch {}

          return new Response(
            JSON.stringify({ error: 'offline', message: 'Search results not available offline' }),
            { status: 503, statusText: 'Service Unavailable - Offline', headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      if (isMetadataRequest(url)) {
        try {
          return await cacheFirstWithBackgroundUpdateExternal(event, event.request, CACHE_NAMES.METADATA, RUNTIME_CACHE_LIMITS.METADATA_MAX_ENTRIES);
        } catch (err) {
          // Cache fallback
          try {
            const cache = await caches.open(CACHE_NAMES.METADATA);
            const cached = await cache.match(event.request);
            if (cached) return cached;
          } catch {}

          return new Response(
            JSON.stringify({ error: 'offline', message: 'Metadata not available offline' }),
            { status: 503, statusText: 'Service Unavailable - Offline', headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      // NETWORK_FIRST strategy for archive.org resources
      return networkFirstExternal(event.request, url);
    })()
  );
});

// === Background Sync for failed audio downloads ===
const AUDIO_DB_NAME = 'ResonateAudioCache';
const AUDIO_DB_VERSION = 9;
const FAILED_STORE = 'failedDownloads';

function openAudioDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AUDIO_DB_NAME, AUDIO_DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(FAILED_STORE)) {
        db.createObjectStore(FAILED_STORE, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function withStore(mode, fn) {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([FAILED_STORE], mode);
    const store = tx.objectStore(FAILED_STORE);
    fn(store, resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

function getAllFailedDownloads() {
  return withStore('readonly', (store, resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function deleteFailedDownload(url) {
  return withStore('readwrite', (store, resolve, reject) => {
    const req = store.delete(url);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function bumpRetryCount(entry) {
  return withStore('readwrite', (store, resolve, reject) => {
    const next = { ...entry, retryCount: (entry.retryCount || 0) + 1, lastAttempt: Date.now() };
    const req = store.put(next);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function processFailedDownloads() {
  try {
    const items = await getAllFailedDownloads();
    if (!items || items.length === 0) return;
    const cache = await caches.open(AUDIO_CACHE_NAME);

    for (const item of items) {
      try {
        const response = await fetch(item.url, { mode: 'cors' });
        if (!response || !response.ok) throw new Error(`Retry failed: ${response && response.status}`);
        await cache.put(item.url, response.clone());
        await deleteFailedDownload(item.url);
        console.log('SW: recovered failed download', item.url);
      } catch (err) {
        console.warn('SW: failed download retry', item.url, err);
        if ((item.retryCount || 0) >= 5) {
          await deleteFailedDownload(item.url);
        } else {
          await bumpRetryCount(item);
        }
      }
    }
  } catch (err) {
    console.warn('SW: processFailedDownloads error', err);
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'retry-failed-downloads') {
    event.waitUntil(processFailedDownloads());
  }
});

self.addEventListener('message', (event) => {
  if (!event || !event.data) return;

  // Version info for UI (current/waiting comparisons)
  if (event.data && event.data.type === 'GET_VERSION') {
    const payload = { version: SW_VERSION, cacheNames: CACHE_NAMES };
    try {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage(payload);
      } else if (event.source && typeof event.source.postMessage === 'function') {
        event.source.postMessage({ type: 'VERSION', ...payload });
      }
    } catch {
      // ignore
    }
    return;
  }

  // Allow clients to trigger safe activation once playback is idle
  if (event.data.type === 'SKIP_WAITING_WHEN_IDLE') {
    console.log('SW: Received safe skipWaiting signal');
    self.skipWaiting();
    return;
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    // Keep app-shell cache; clear data caches.
    Promise.allSettled([
      caches.delete(CACHE_NAMES.APP),
      caches.delete(CACHE_NAMES.METADATA),
      caches.delete(CACHE_NAMES.SEARCH)
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
