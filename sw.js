// Silence console output in production (SW context)
(() => {
  try {
    const loc = self.location;
    const isDev =
      loc.protocol === 'file:' ||
      loc.hostname === 'localhost' ||
      loc.hostname === '127.0.0.1' ||
      (loc.hostname && loc.hostname.includes('dev.')) ||
      loc.port === '3000' ||
      loc.port === '8080';

    if (!isDev && self.console) {
      const noop = () => {};
      self.console.debug = noop;
      self.console.log = noop;
      self.console.info = noop;
      self.console.warn = noop;
      self.console.error = noop;
    }
  } catch {
    // ignore
  }
})();

// sw.js - Enhanced Service Worker for audio, metadata, and cover image caching
const CACHE_NAMES = {
  APP: 'resonate-v17p11',
  STATIC: 'static-v17p11',
  METADATA: 'metadata-v17p11',
  SEARCH: 'search-v17p11',
  COVERS: 'covers-v1'
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
const AUDIO_CACHE_NAME = 'resonate-audio-v1';
const AUDIO_PRECACHE_NAME = 'audio-precache-v1';
const AUDIO_PRECACHE_CHUNK_SIZE = 256 * 1024;
const AUDIO_PRECACHE_MAX_BYTES = 50 * 1024 * 1024;
let audioPrecacheQueue = Promise.resolve();

const RUNTIME_CACHE_LIMITS = {
  SEARCH_MAX_ENTRIES: 80,
  METADATA_MAX_ENTRIES: 300,
  COVERS_MAX_ENTRIES: 200
};

// Critical files for caching
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/resonate.css',
  '/css/resonate-bundle.css',
  '/js/theme.js',
  '/js/logger.js',
  '/js/A11yAnnouncer.js',
  '/js/OfflineStatusManager.js',
  '/js/cache.js',
  '/js/track-normalizer.js',
  '/js/share.js',
  '/js/album-tracks.js',
  '/js/playback.js',
  '/js/search.js',
  '/js/search-client.js',
  '/js/search-worker.js',
  '/js/search-history.js',
  '/js/ui.js',
  '/js/tracklist.js',
  '/js/offline.js',
  '/js/battery.js',
  '/js/initialization.js',
  '/js/cover-manager.js',
  '/js/wake-lock-manager.js',
  '/js/subtitle-manager.js',
  '/js/local-track-storage.js',
  '/js/local-track-storage-worker.js',
  '/js/playlist-manager.js',
  '/js/playlist-ui.js',
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

function isCoverRequest(url) {
  return isArchiveImageRequest(url);
}

function isAudioRequest(request, url) {
  if (request.destination === 'audio') return true;
  const path = url.pathname.toLowerCase();
  if (/\.(?:mp3|opus|flac)$/.test(path)) return true;
  return isSameOrigin(url) && /^\/api\/(?:.*\/)?(?:audio|stream)(?:\/|$)/.test(path);
}

function parseByteRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader || '');
  if (!match || (!match[1] && !match[2])) return null;

  const startValue = match[1] ? Number(match[1]) : null;
  const endValue = match[2] ? Number(match[2]) : null;
  if ((startValue !== null && !Number.isSafeInteger(startValue)) ||
      (endValue !== null && !Number.isSafeInteger(endValue))) {
    return null;
  }

  if (size === 0) return { unsatisfiable: true };

  let start;
  let end;
  if (startValue === null) {
    const suffixLength = endValue;
    if (suffixLength === 0) return { unsatisfiable: true };
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = startValue;
    end = endValue === null ? size - 1 : Math.min(endValue, size - 1);
  }

  if (start >= size || start > end) return { unsatisfiable: true };
  return { start, end };
}

function getAudioContentType(response, url) {
  const contentType = getContentType(response);
  if (contentType) return contentType;
  const path = url.pathname.toLowerCase();
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  if (path.endsWith('.opus')) return 'audio/ogg';
  if (path.endsWith('.flac')) return 'audio/flac';
  return 'application/octet-stream';
}

async function cacheFullAudioResponse(request, response) {
  if (!response || (response.status !== 200 && response.type !== 'opaque')) return;
  const cache = await caches.open(AUDIO_CACHE_NAME);
  await cache.put(request.url, response.clone());
}

function shouldSkipAudioPrecache() {
  const connection = self.navigator && self.navigator.connection;
  if (!connection) return false;
  return connection.saveData === true ||
    connection.type === 'cellular' ||
    connection.effectiveType === 'slow-2g' ||
    connection.effectiveType === '2g';
}

async function trimAudioPrecache(cache) {
  const keys = await cache.keys();
  let totalBytes = 0;
  const entries = [];

  for (const key of keys) {
    const response = await cache.match(key);
    const size = Number(response && response.headers.get('x-audio-precache-size')) || 0;
    entries.push({ key, size });
    totalBytes += size;
  }

  for (const entry of entries) {
    if (totalBytes <= AUDIO_PRECACHE_MAX_BYTES) break;
    await cache.delete(entry.key);
    totalBytes -= entry.size;
  }
}

async function precacheAudioUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { url, cached: false, reason: 'invalid-url' };
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return { url, cached: false, reason: 'unsupported-protocol' };
  }

  const response = await fetch(parsedUrl.href, {
    headers: { Range: `bytes=0-${AUDIO_PRECACHE_CHUNK_SIZE - 1}` },
    credentials: 'omit'
  });
  if (!response || response.status !== 206) {
    return { url: parsedUrl.href, cached: false, reason: 'not-partial-content' };
  }

  const contentRange = response.headers.get('Content-Range') || '';
  const rangeMatch = /^bytes 0-(\d+)\/(\d+|\*)$/i.exec(contentRange);
  if (!rangeMatch) {
    return { url: parsedUrl.href, cached: false, reason: 'invalid-content-range' };
  }

  const body = await response.arrayBuffer();
  const chunk = body.slice(0, AUDIO_PRECACHE_CHUNK_SIZE);
  if (!chunk.byteLength) {
    return { url: parsedUrl.href, cached: false, reason: 'empty-partial-content' };
  }

  const totalLength = rangeMatch[2];
  const cachedRange = `bytes 0-${chunk.byteLength - 1}/${totalLength}`;
  const headers = new Headers(response.headers);
  headers.delete('Content-Range');
  headers.delete('Content-Encoding');
  headers.set('Content-Length', String(chunk.byteLength));
  headers.set('X-Audio-Precache-Partial', 'true');
  headers.set('X-Audio-Precache-Content-Range', cachedRange);
  headers.set('X-Audio-Precache-Size', String(chunk.byteLength));

  const cache = await caches.open(AUDIO_PRECACHE_NAME);
  await cache.delete(parsedUrl.href);
  await cache.put(parsedUrl.href, new Response(chunk, { status: 200, headers }));
  await trimAudioPrecache(cache);

  return { url: parsedUrl.href, cached: true, bytes: chunk.byteLength };
}

function precacheTopAudio(urls) {
  const work = audioPrecacheQueue.then(async () => {
    if (shouldSkipAudioPrecache()) {
      return { skipped: true, reason: 'constrained-connection', results: [] };
    }

    const cache = await caches.open(AUDIO_PRECACHE_NAME);
    const results = [];
    for (const url of (Array.isArray(urls) ? urls.slice(0, 3) : [])) {
      try {
        results.push(await precacheAudioUrl(url));
      } catch (error) {
        results.push({
          url,
          cached: false,
          reason: 'request-failed',
          message: error && error.message ? error.message : String(error)
        });
      }
    }
    return { skipped: false, results };
  });
  audioPrecacheQueue = work.catch(() => {});
  return work;
}

async function fetchAndCacheFullAudio(request) {
  const headers = new Headers(request.headers);
  headers.delete('Range');
  const fullRequest = new Request(request, { headers });
  const response = await fetch(fullRequest);
  await cacheFullAudioResponse(request, response);
}

async function handleAudioRequest(event, request, url) {
  const rangeHeader = request.headers.get('Range');
  let cachedResponse = null;

  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    cachedResponse = await cache.match(request.url);
    if (cachedResponse) {
      if (!rangeHeader) return cachedResponse;
      if (cachedResponse.type !== 'opaque' && cachedResponse.status === 200) {
        const buffer = await cachedResponse.arrayBuffer();
        const range = parseByteRange(rangeHeader, buffer.byteLength);
        if (range && range.unsatisfiable) {
          return new Response(null, {
            status: 416,
            headers: {
              'Accept-Ranges': 'bytes',
              'Content-Range': `bytes */${buffer.byteLength}`
            }
          });
        }

        if (range) {
          const body = buffer.slice(range.start, range.end + 1);
          return new Response(body, {
            status: 206,
            headers: {
              'Accept-Ranges': 'bytes',
              'Content-Length': String(body.byteLength),
              'Content-Range': `bytes ${range.start}-${range.end}/${buffer.byteLength}`,
              'Content-Type': getAudioContentType(cachedResponse, url)
            }
          });
        }

        return cachedResponse;
      }
    }

    if (rangeHeader) {
      const precache = await caches.open(AUDIO_PRECACHE_NAME);
      const partialResponse = await precache.match(request.url);
      const partialRange = partialResponse && partialResponse.headers.get('X-Audio-Precache-Content-Range');
      const partialMatch = /^bytes 0-(\d+)\/(\d+|\*)$/i.exec(partialRange || '');
      if (partialResponse && partialMatch) {
        const range = parseByteRange(rangeHeader, Number(partialMatch[2]) || Number.MAX_SAFE_INTEGER);
        if (range && !range.unsatisfiable && range.start === 0) {
          const buffer = await partialResponse.arrayBuffer();
          const end = Math.min(range.end, buffer.byteLength - 1);
          if (end >= 0) {
            const body = buffer.slice(0, end + 1);
            return new Response(body, {
              status: 206,
              headers: {
                'Accept-Ranges': 'bytes',
                'Content-Length': String(body.byteLength),
                'Content-Range': `bytes 0-${end}/${partialMatch[2]}`,
                'Content-Type': getAudioContentType(partialResponse, url)
              }
            });
          }
        }
      }
    }
  } catch (error) {
    console.warn('SW: Audio cache lookup failed:', request.url, error);
  }

  const networkResponse = await fetch(request);

  // A range response is not a complete audio file. Fetch the full resource in
  // the background so a later offline range request can be served from cache.
  if (rangeHeader && networkResponse.status !== 200) {
    event.waitUntil(
      fetchAndCacheFullAudio(request).catch((error) => {
        console.warn('SW: Failed to cache full audio response:', request.url, error);
      })
    );
  } else if (networkResponse.status === 200 || networkResponse.type === 'opaque') {
    event.waitUntil(
      cacheFullAudioResponse(request, networkResponse).catch((error) => {
        console.warn('SW: Failed to cache audio response:', request.url, error);
      })
    );
  }

  return networkResponse;
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
            cacheName !== CACHE_NAMES.COVERS &&
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
  const audioRequest = isAudioRequest(event.request, url);

  // Archive.org file hosts may not allow CORS. Let script fetches reach the
  // browser directly; native media requests can still use the audio handler.
  if (audioRequest && isArchiveOrg(url) && event.request.mode === 'cors') {
    return;
  }

  // Never intercept the service worker script itself
  if (url.pathname === '/sw.js') {
    return; // let the browser fetch it directly
  }

  // Never intercept same-origin API requests.
  // These are dynamic and should always go to network (and avoid SW bugs/caching).
  if (isSameOrigin(url) && url.pathname.startsWith('/api/') && !audioRequest) {
    return;
  }

  // Only handle our own assets and archive.org. Avoid intercepting third-party
  // scripts (e.g. analytics) which can otherwise show confusing 503 errors.
  if (!isSameOrigin(url) && !isArchiveOrg(url)) {
    return;
  }

  if (audioRequest) {
    event.respondWith(handleAudioRequest(event, event.request, url));
    return;
  }

  // Handle Archive.org cover images with caching strategy
  if (isCoverRequest(url)) {
    event.respondWith(
      (async () => {
        let cachedResponse = null;
        try {
          const cache = await caches.open(CACHE_NAMES.COVERS);
          cachedResponse = await cache.match(event.request);
          if (cachedResponse) {
            // Cross-origin image requests are often opaque and cannot carry a
            // timestamp header, but a cached copy is still usable.
            if (cachedResponse.type === 'opaque') {
              console.log('SW: Serving cached cover:', url.pathname);
              return cachedResponse;
            }
            const dateHeader = cachedResponse.headers.get('sw-cached-date');
            const cacheAge = dateHeader ? (Date.now() - parseInt(dateHeader, 10)) : Number.POSITIVE_INFINITY;
            const sevenDays = 7 * 24 * 60 * 60 * 1000;
            if (cacheAge < sevenDays) {
              console.log('SW: Serving cached cover:', url.pathname);
              return cachedResponse;
            }
          }
        } catch {
          // ignore cache lookup failures
        }

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.type === 'opaque') {
            try {
              const cache = await caches.open(CACHE_NAMES.COVERS);
              await cache.put(event.request, networkResponse.clone());
              await trimCache(CACHE_NAMES.COVERS, RUNTIME_CACHE_LIMITS.COVERS_MAX_ENTRIES);
            } catch {
              // Keep the network response usable if opaque caching is unavailable.
            }
            return networkResponse;
          }
          if (networkResponse && networkResponse.ok) {
            try {
              const responseClone = networkResponse.clone();
              const headers = new Headers(responseClone.headers);
              headers.set('sw-cached-date', String(Date.now()));
              const body = await responseClone.blob();
              const cached = new Response(body, {
                status: responseClone.status,
                statusText: responseClone.statusText,
                headers
              });

              const cache = await caches.open(CACHE_NAMES.COVERS);
              await cache.put(event.request, cached.clone());
              await trimCache(CACHE_NAMES.COVERS, RUNTIME_CACHE_LIMITS.COVERS_MAX_ENTRIES);
              return cached;
            } catch {
              // Fall back to network response if caching fails
              return networkResponse;
            }
          }
          if (cachedResponse) return cachedResponse;
          return networkResponse;
        } catch {
          if (cachedResponse) return cachedResponse;
          return new Response('Cover not available offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
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
const METADATA_STORE = 'audioMetadata';

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

async function storeRecoveredMetadata(entry, response) {
  try {
    const db = await openAudioDb();
    if (!db.objectStoreNames.contains(METADATA_STORE)) {
      db.close();
      return;
    }

    let size = 0;
    try {
      const clone = response.clone();
      const buffer = await clone.arrayBuffer();
      size = buffer.byteLength || 0;
    } catch {
      const len = response && response.headers ? response.headers.get('content-length') : null;
      size = len ? parseInt(len, 10) || 0 : 0;
    }

    await new Promise((resolve) => {
      try {
        const tx = db.transaction([METADATA_STORE], 'readwrite');
        const store = tx.objectStore(METADATA_STORE);
        const payload = {
          url: entry.url,
          size,
          lastAccessed: Date.now(),
          cachedAt: Date.now(),
          isFavorite: !!entry.isFavorite,
          isResonte: !!entry.isFavorite,
          trackId: entry.trackId,
          albumId: entry.albumId,
          downloadOffline: entry.downloadOffline === true
        };
        store.put(payload);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });

    db.close();
  } catch {
    // ignore metadata reconciliation failures
  }
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
        await storeRecoveredMetadata(item, response);
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

  if (event.data.type === 'PRECACHE_AUDIO') {
    const operation = precacheTopAudio(event.data.urls).then(
      result => {
        const message = { type: 'PRECACHE_AUDIO_RESULT', ...result };
        if (event.ports && event.ports[0]) event.ports[0].postMessage(message);
        else if (event.source && typeof event.source.postMessage === 'function') event.source.postMessage(message);
      },
      error => {
        const message = {
          type: 'PRECACHE_AUDIO_RESULT',
          skipped: false,
          results: [],
          error: error && error.message ? error.message : String(error)
        };
        if (event.ports && event.ports[0]) event.ports[0].postMessage(message);
        else if (event.source && typeof event.source.postMessage === 'function') event.source.postMessage(message);
      }
    );
    if (typeof event.waitUntil === 'function') event.waitUntil(operation);
    return;
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    // Keep app-shell cache; clear data caches.
    Promise.allSettled([
      caches.delete(CACHE_NAMES.APP),
      caches.delete(CACHE_NAMES.METADATA),
      caches.delete(CACHE_NAMES.SEARCH),
      caches.delete(AUDIO_PRECACHE_NAME)
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
