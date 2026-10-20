import assert from 'assert/strict';
import { readFile } from 'fs/promises';
import { performance } from 'perf_hooks';
import vm from 'vm';

const projectRoot = new URL('../', import.meta.url);
const testCases = [];

function test(name, run) {
  testCases.push({ name, run });
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      listeners.set(type, registered.filter(item => item !== listener));
    },
    dispatchEvent(event) {
      const dispatchedEvent = { target: this, preventDefault() {}, ...event };
      for (const listener of listeners.get(event.type) || []) listener.call(this, dispatchedEvent);
    }
  };
}

function createClassList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); },
    toggle(value, force) {
      const shouldAdd = force === undefined ? !values.has(value) : !!force;
      if (shouldAdd) values.add(value);
      else values.delete(value);
      return shouldAdd;
    }
  };
}

function createMockElement(tagName = 'DIV') {
  const attributes = {};
  const children = [];
  const element = Object.assign(createEventTarget(), {
    tagName,
    id: '',
    dataset: {},
    style: { transform: '' },
    classList: createClassList(),
    disabled: false,
    offsetParent: {},
    offsetWidth: 100,
    textContent: '',
    children,
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] ?? null; },
    removeAttribute(name) { delete attributes[name]; },
    appendChild(child) { children.push(child); return child; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains(target) { return target === this || children.includes(target); },
    focus() { this.ownerDocument.activeElement = this; },
    blur() {
      if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
    }
  });
  return element;
}

function createButton() {
  const icon = { className: 'transport-icon' };
  return {
    dataset: { state: 'play' },
    attributes: { 'aria-label': 'Play' },
    querySelector: () => icon,
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
}

async function createPlayer() {
  const audio = Object.assign(createEventTarget(), {
    paused: true,
    ended: false,
    src: 'https://archive.org/audio.mp3',
    currentTime: 0,
    duration: 120,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      this.playCalls += 1;
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    }
  });
  const playButton = createButton();
  const document = Object.assign(createEventTarget(), {
    readyState: 'loading',
    hidden: false,
    getElementById: () => null,
    createElement: () => ({ className: '', setAttribute() {} })
  });
  const storage = new Map();
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const state = {
    currentTrack: null,
    favorites: [],
    resontes: [],
    searchResults: [],
    playbackQueue: [],
    playbackHistory: [],
    playbackForward: [],
    shuffleFavorites: false,
    isLoading: false,
    isPlayingFavorites: false,
    userInteracted: false,
    networkOnline: true
  };
  const announcements = [];
  const context = {
    URL,
    URLSearchParams,
    performance,
    console,
    document,
    localStorage,
    navigator: { userAgent: '' },
    location: { href: 'https://resonate.test/', hostname: 'resonate.test', protocol: 'https:', search: '' },
    state,
    A11yAnnouncer: {
      announce(message, priority) {
        announcements.push({ message, priority });
      }
    },
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    fetch: async () => { throw new Error('Unexpected fetch in playback unit test'); },
    showStatus() {}
  };
  context.window = context;
  context.elements = { audio, playBtn: playButton };
  context.addEventListener = () => {};
  context.getComputedStyle = () => ({ display: 'none' });

  vm.createContext(context);
  const normalizerSource = await readFile(new URL('js/track-normalizer.js', projectRoot), 'utf8');
  const playbackSource = await readFile(new URL('js/playback.js', projectRoot), 'utf8');
  vm.runInContext(normalizerSource, context, { filename: 'js/track-normalizer.js' });
  vm.runInContext(playbackSource, context, { filename: 'js/playback.js' });

  return { context, audio, playButton, state, announcements };
}

async function createSandbox(globals = {}) {
  const storage = new Map();
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const context = {
    URL,
    URLSearchParams,
    performance,
    console,
    localStorage,
    navigator: { userAgent: '', onLine: true },
    location: { href: 'https://resonate.test/', origin: 'https://resonate.test', hostname: 'resonate.test', protocol: 'https:', search: '' },
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    ...globals
  };
  context.window = context;
  context.addEventListener = () => {};
  context.removeEventListener = () => {};
  vm.createContext(context);
  return { context, storage, localStorage };
}

async function evaluateScript(context, relativePath) {
  const source = await readFile(new URL(relativePath, projectRoot), 'utf8');
  vm.runInContext(source, context, { filename: relativePath });
}

async function evaluateSearchScripts(context) {
  await evaluateScript(context, 'js/search-query.js');
  await evaluateScript(context, 'js/search.js');
}

test('Offline favorites preloading is opt-in and saved preferences are preserved', async () => {
  const uiSource = await readFile(new URL('js/ui.js', projectRoot), 'utf8');
  assert.match(uiSource, /favoritesPreloadEnabled:\s*false/);
  assert.match(uiSource, /resontesPreloadEnabled:\s*false/);

  for (const preference of [
    {
      name: 'loadFavoritesPreloadPreference',
      stateKey: 'favoritesPreloadEnabled',
      storageKey: 'resonate_preload_favorites_enabled',
      toggleKey: 'preloadFavoritesToggle'
    },
    {
      name: 'loadResontesPreloadPreference',
      stateKey: 'resontesPreloadEnabled',
      storageKey: 'resonate_preload_resontes_enabled',
      toggleKey: 'preloadResontesToggle'
    }
  ]) {
    const preferenceSource = uiSource.match(
      new RegExp(`function ${preference.name}\\(\\) \\{[\\s\\S]*?\\n\\}`)
    );
    assert.ok(preferenceSource, `${preference.name} should exist`);

    for (const [savedValue, expected] of [[null, false], ['true', true], ['false', false]]) {
      const toggle = { checked: null };
      const context = {
        state: { [preference.stateKey]: true },
        localStorage: { getItem: key => key === preference.storageKey ? savedValue : null },
        elements: { [preference.toggleKey]: toggle },
        window: { logger: { warn() {} } }
      };
      vm.runInNewContext(
        `${preferenceSource[0]}; ${preference.name}();`,
        context
      );

      assert.equal(context.state[preference.stateKey], expected);
      assert.equal(toggle.checked, expected);
    }
  }
});

test('Production logger silences invalid and NONE levels while INFO filters debug traces', async () => {
  for (const search of ['?log=NONE', '?log=unexpected']) {
    const output = [];
    const console = {
      debug: (...args) => output.push(['debug', ...args]),
      log: (...args) => output.push(['log', ...args]),
      info: (...args) => output.push(['info', ...args]),
      warn: (...args) => output.push(['warn', ...args]),
      error: (...args) => output.push(['error', ...args])
    };
    const { context } = await createSandbox({
      console,
      location: {
        href: `https://resonate.test/${search}`,
        hostname: 'resonate.test',
        protocol: 'https:',
        hash: '',
        search
      }
    });
    await evaluateScript(context, 'js/logger.js');

    assert.equal(context.logger.config.enabled, false);
    context.console.log('should be silenced');
    assert.deepEqual(output, []);
  }

  const output = [];
  const console = {
    debug: (...args) => output.push(['debug', ...args]),
    log: (...args) => output.push(['log', ...args]),
    info: (...args) => output.push(['info', ...args]),
    warn: (...args) => output.push(['warn', ...args]),
    error: (...args) => output.push(['error', ...args])
  };
  const { context } = await createSandbox({
    console,
    location: {
      href: 'https://resonate.test/?log=INFO',
      hostname: 'resonate.test',
      protocol: 'https:',
      hash: '',
      search: '?log=INFO'
    }
  });
  await evaluateScript(context, 'js/logger.js');

  context.console.log('raw console output should be silenced');
  context.logger.debug('debug trace', 'PLAYBACK');
  context.logger.info('useful info', 'SYSTEM');
  assert.equal(output.length, 1);
  assert.equal(output[0][0], 'log');
  assert.match(output[0][1], /useful info/);
});

test('Share module builds canonical links and shares track metadata', async () => {
  const shareCalls = [];
  const statuses = [];
  const document = {
    title: '',
    head: { appendChild() {} },
    querySelector() { return null; },
    createElement() { return { setAttribute() {} }; }
  };
  const { context } = await createSandbox({
    document,
    location: {
      href: 'http://resonateplayer.com/player?old=1#track',
      origin: 'http://resonateplayer.com',
      hostname: 'www.resonateplayer.com',
      protocol: 'http:',
      search: '?old=1'
    },
    navigator: {
      userAgent: '',
      async share(data) { shareCalls.push(data); }
    },
    state: {
      currentTrack: { id: 'track-1', creator: ' Artist ', album: 'Album', trackIndex: 3 }
    },
    CoverManager: { async getCoverImageForSharing() { return null; } },
    showStatus: (...args) => statuses.push(args)
  });
  await evaluateScript(context, 'js/share.js');

  assert.equal(
    context.ResonateShare.buildShareUrl('track/1', 2.8),
    'https://www.resonateplayer.com/?play=track%2F1&t=2'
  );
  await context.ResonateShare.shareTrack('track-1', ' Song ', null, null, 'track');

  assert.equal(shareCalls.length, 1);
  assert.equal(shareCalls[0].title, 'Album — Song');
  assert.equal(shareCalls[0].url, 'https://www.resonateplayer.com/?play=track-1&t=3');
  assert.match(shareCalls[0].text, /Artist/);
  assert.equal(document.title, 'Album — Song - Artist | Resonate Player');
  assert.deepEqual(statuses[0], ['Track shared successfully', 'info', 6000]);
});

test('Share module copies canonical link when Web Share is unavailable', async () => {
  const copied = [];
  const statuses = [];
  const document = {
    title: '',
    head: { appendChild() {} },
    querySelector() { return null; },
    createElement() { return { setAttribute() {} }; }
  };
  const { context } = await createSandbox({
    document,
    navigator: {
      userAgent: '',
      clipboard: { async writeText(text) { copied.push(text); } }
    },
    CoverManager: { async getCoverImageForSharing() { return null; } },
    showStatus: (...args) => statuses.push(args)
  });
  await evaluateScript(context, 'js/share.js');

  await context.ResonateShare.shareTrack('track-2', 'Track');

  assert.deepEqual(copied, ['https://resonate.test/?play=track-2']);
  assert.deepEqual(statuses[0], ['Link copied to clipboard', 'info', 4000]);
});

test('Uncached Archive.org audio uses native streaming instead of cross-origin fetches', async () => {
  const requestedUrls = [];
  const { context } = await createSandbox({
    fetch: async url => {
      requestedUrls.push(url);
      return { ok: true };
    }
  });
  await evaluateScript(context, 'js/cache.js');

  const cache = context.audioCache;
  cache.isInitialized = true;
  cache.cache = { match: async () => null };
  cache.shouldPrefetch = async () => true;
  cache.put = async () => {};

  await cache.prefetchAudio('https://archive.org/download/item/track.mp3', { streamingOnly: true });
  assert.deepEqual(requestedUrls, []);

  await cache.prefetchAudio('https://archive.org/download/item/track.mp3');
  assert.deepEqual(requestedUrls, []);

  assert.equal(await cache.get('https://archive.org/download/item/track.mp3', true), null);
  assert.deepEqual(requestedUrls, []);
});

test('Archive.org playback streams directly when its audio is not cached', async () => {
  const { context } = await createPlayer();
  let fetches = 0;
  context.fetch = async () => {
    fetches += 1;
    throw new Error('Archive.org audio should not be fetched as a cross-origin blob');
  };
  context.audioCache = { get: async () => null };

  const url = 'https://archive.org/download/item/track.mp3';
  assert.equal(await context.loadAudioWithCache({ url, title: 'Track' }), url);
  assert.equal(fetches, 0);
});

test('Audio cache initialization is shared by concurrent callers', async () => {
  let cacheOpens = 0;
  let databaseOpens = 0;
  let connectionListeners = 0;
  const db = {};
  const { context } = await createSandbox({
    navigator: {
      userAgent: '',
      onLine: true,
      connection: {
        addEventListener() { connectionListeners += 1; }
      }
    },
    caches: {
      async open() {
        cacheOpens += 1;
        return {};
      }
    },
    indexedDB: {
      open() {
        databaseOpens += 1;
        const request = { result: db };
        queueMicrotask(() => request.onsuccess());
        return request;
      }
    }
  });
  await evaluateScript(context, 'js/cache.js');

  await Promise.all([context.audioCache.init(), context.audioCache.init()]);

  assert.equal(cacheOpens, 1);
  assert.equal(databaseOpens, 1);
  assert.equal(connectionListeners, 1);
  assert.equal(context.audioCache.isInitialized, true);
});

test('Audio cache routes context preloads through one deduplicated flow', async () => {
  const { context } = await createSandbox();
  await evaluateScript(context, 'js/cache.js');

  const cache = context.audioCache;
  cache.isInitialized = true;
  const preloads = [];
  const priorities = [];
  cache.shouldPrefetch = async priority => {
    priorities.push(priority);
    return true;
  };
  cache.ensureMinTracksPerContext = async (contextName, tracks) => {
    preloads.push({ context: contextName, tracks });
  };

  const resontes = [{ url: 'https://archive.org/download/item/resonte.mp3' }];
  const searches = [{ url: 'https://archive.org/download/item/search.mp3' }];
  const offline = [{ url: 'https://archive.org/download/item/offline.mp3' }];

  await Promise.all([
    cache.preloadResontes(resontes),
    cache.preloadResontes(resontes),
    cache.preloadSearchResults(searches),
    cache.preloadOffline(offline)
  ]);
  await cache.preloadResontes(resontes);

  assert.deepEqual(
    preloads.map(({ context: preloadContext }) => preloadContext),
    ['resontes', 'search', 'offline']
  );
  assert.deepEqual(priorities, [true, false, false]);
});

test('Audio cache deduplicates concurrent requests for the same URL', async () => {
  const fetches = [];
  const { context } = await createSandbox({
    fetch: async url => {
      fetches.push(url);
      return new Response('audio-bytes', { headers: { 'Content-Type': 'audio/mpeg' } });
    }
  });
  await evaluateScript(context, 'js/cache.js');

  const cache = context.audioCache;
  cache.isInitialized = true;
  cache.cache = { match: async () => null };
  cache.put = async () => {};

  const url = 'https://media.example.test/download/item/track.mp3';
  const [first, second] = await Promise.all([
    cache.get(url, true),
    cache.get(url, true)
  ]);

  assert.equal(fetches.length, 1);
  assert.equal(first?.blob?.size, second?.blob?.size);
});

async function createServiceWorkerHarness({ fetch, audioEntries = [], precacheEntries = [], connection = null }) {
  const listeners = new Map();
  const audioCacheEntries = new Map(audioEntries);
  const audioPrecacheEntries = new Map(precacheEntries);
  const makeCache = entries => ({
    async match(key) {
      const response = entries.get(typeof key === 'string' ? key : key.url);
      return response ? response.clone() : null;
    },
    async put(key, response) {
      entries.set(typeof key === 'string' ? key : key.url, response);
    },
    async delete(key) {
      return entries.delete(typeof key === 'string' ? key : key.url);
    },
    async keys() {
      return [...entries.keys()].map(url => ({ url }));
    }
  });
  const audioCache = makeCache(audioCacheEntries);
  const audioPrecache = makeCache(audioPrecacheEntries);
  const serviceWorkerConsole = {
    debug() {},
    log() {},
    info() {},
    warn() {},
    error() {}
  };
  const serviceWorker = {
    location: {
      protocol: 'https:',
      hostname: 'resonate.test',
      origin: 'https://resonate.test',
      port: ''
    },
    navigator: connection ? { connection } : undefined,
    console: serviceWorkerConsole,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    }
  };
  const { context } = await createSandbox({
    self: serviceWorker,
    console: serviceWorkerConsole,
    caches: {
      open: async name => (name === 'search-precache-v1' ? audioPrecache : audioCache),
      async delete(name) {
        if (name === 'search-precache-v1') audioPrecacheEntries.clear();
        else if (name === 'continuous-queue-v1') audioCacheEntries.clear();
        return true;
      }
    },
    fetch,
    Request,
    Response,
    Headers
  });
  await evaluateScript(context, 'sw.js');

  return {
    audioCacheEntries,
    audioPrecacheEntries,
    async dispatch(request) {
      let responsePromise = null;
      const backgroundTasks = [];
      for (const handler of listeners.get('fetch') || []) {
        handler({
          request,
          respondWith(response) {
            responsePromise = Promise.resolve(response);
          },
          waitUntil(task) {
            backgroundTasks.push(Promise.resolve(task));
          }
        });
      }
      return {
        intercepted: responsePromise !== null,
        response: responsePromise ? await responsePromise : null,
        backgroundTasks
      };
    },
    async dispatchMessage(data) {
      const replies = [];
      const backgroundTasks = [];
      for (const handler of listeners.get('message') || []) {
        handler({
          data,
          source: { postMessage: message => replies.push(message) },
          waitUntil(task) {
            backgroundTasks.push(Promise.resolve(task));
          }
        });
      }
      await Promise.all(backgroundTasks);
      return replies;
    }
  };
}

test('Service worker serves cached audio byte ranges with partial content headers', async () => {
  let networkRequests = 0;
  const url = 'https://archive.org/download/item/track.mp3';
  const harness = await createServiceWorkerHarness({
    fetch: async () => {
      networkRequests += 1;
      throw new Error('Cached audio should not trigger a network request');
    },
    audioEntries: [[url, new Response('0123456789', {
      headers: { 'Content-Type': 'audio/mpeg' }
    })]]
  });

  const { intercepted, response } = await harness.dispatch(new Request(url, {
    mode: 'no-cors',
    headers: { Range: 'bytes=2-5' }
  }));
  assert.equal(intercepted, true);
  assert.equal(response.status, 206);
  assert.equal(await response.text(), '2345');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('Content-Length'), '4');
  assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal(networkRequests, 0);

  const suffix = await harness.dispatch(new Request(url, {
    mode: 'no-cors',
    headers: { Range: 'bytes=-3' }
  }));
  assert.equal(await suffix.response.text(), '789');
  assert.equal(suffix.response.headers.get('Content-Range'), 'bytes 7-9/10');

  const unsatisfiable = await harness.dispatch(new Request(url, {
    mode: 'no-cors',
    headers: { Range: 'bytes=10-' }
  }));
  assert.equal(unsatisfiable.response.status, 416);
  assert.equal(unsatisfiable.response.headers.get('Content-Range'), 'bytes */10');
  assert.equal(networkRequests, 0);
});

test('Service worker prioritizes continuous-queue audio over search precache', async () => {
  const url = 'https://archive.org/download/item/track.mp3';
  const harness = await createServiceWorkerHarness({
    fetch: async () => {
      throw new Error('Cached audio should not trigger a network request');
    },
    audioEntries: [[url, new Response('queue-audio', {
      headers: { 'Content-Type': 'audio/mpeg' }
    })]],
    precacheEntries: [[url, new Response('search-audio', {
      headers: {
        'Content-Type': 'audio/mpeg',
        'X-Audio-Precache-Content-Range': 'bytes 0-11/12'
      }
    })]]
  });

  const { response } = await harness.dispatch(new Request(url, {
    mode: 'no-cors',
    headers: { Range: 'bytes=0-4' }
  }));
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'queue');
});

test('Service worker precaches 256 KB audio ranges and serves cached initial playback ranges', async () => {
  const requested = [];
  const urls = Array.from({ length: 4 }, (_, index) =>
    `https://archive.org/download/item/track-${index}.mp3`
  );
  const chunk = new Uint8Array(256 * 1024);
  chunk.fill(65);
  const harness = await createServiceWorkerHarness({
    fetch: async (url, options) => {
      requested.push({ url: String(url), options });
      return new Response(chunk, {
        status: 206,
        headers: {
          'Content-Range': 'bytes 0-262143/1000000',
          'Content-Type': 'audio/mpeg'
        }
      });
    }
  });

  const [message] = await harness.dispatchMessage({ type: 'PRECACHE_AUDIO', urls });
  assert.equal(message.type, 'PRECACHE_AUDIO_RESULT');
  assert.equal(message.skipped, false);
  assert.equal(message.results.length, 3);
  assert.equal(requested.length, 3);
  assert.ok(requested.every(item => item.options.headers.Range === 'bytes=0-262143'));
  assert.equal(harness.audioPrecacheEntries.size, 3);

  const partial = harness.audioPrecacheEntries.get(urls[0]);
  assert.equal(partial.status, 200);
  assert.equal(partial.headers.get('X-Audio-Precache-Partial'), 'true');
  assert.equal(partial.headers.get('X-Audio-Precache-Content-Range'), 'bytes 0-262143/1000000');

  const playbackRange = await harness.dispatch(new Request(urls[0], {
    mode: 'no-cors',
    headers: { Range: 'bytes=0-9' }
  }));
  assert.equal(playbackRange.response.status, 206);
  assert.equal(await playbackRange.response.arrayBuffer().then(buffer => buffer.byteLength), 10);
  assert.equal(playbackRange.response.headers.get('Content-Range'), 'bytes 0-9/1000000');
  assert.equal(requested.length, 3);
});

test('Service worker skips audio precaching on cellular and data-saving connections', async () => {
  for (const connection of [
    { type: 'cellular', saveData: false },
    { type: 'wifi', saveData: true }
  ]) {
    let networkRequests = 0;
    const harness = await createServiceWorkerHarness({
      fetch: async () => {
        networkRequests += 1;
        return new Response(new Uint8Array([1]), {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-0/10' }
        });
      },
      connection
    });

    const [message] = await harness.dispatchMessage({
      type: 'PRECACHE_AUDIO',
      urls: ['https://archive.org/download/item/track.mp3']
    });
    assert.equal(message.skipped, true);
    assert.equal(networkRequests, 0);
    assert.equal(harness.audioPrecacheEntries.size, 0);
  }
});

test('Service worker keeps search precache at or below 20 MB using Content-Length FIFO eviction', async () => {
  const urls = Array.from({ length: 81 }, (_, index) =>
    `https://archive.org/download/item/fifo-${index}.mp3`
  );
  const chunk = new Uint8Array(256 * 1024);
  const harness = await createServiceWorkerHarness({
    fetch: async () => new Response(chunk, {
      status: 206,
      headers: { 'Content-Range': 'bytes 0-262143/1000000' }
    })
  });

  for (let index = 0; index < urls.length; index += 3) {
    await harness.dispatchMessage({
      type: 'PRECACHE_AUDIO',
      urls: urls.slice(index, index + 3)
    });
  }

  const cachedBytes = [...harness.audioPrecacheEntries.values()]
    .reduce((total, response) => total + Number(response.headers.get('Content-Length')), 0);
  assert.ok(cachedBytes <= 20 * 1024 * 1024);
  assert.equal(harness.audioPrecacheEntries.size, 80);
  assert.equal(harness.audioPrecacheEntries.has(urls[0]), false);
  assert.equal(harness.audioPrecacheEntries.has(urls[80]), true);
});

test('Service worker caches a complete response after an uncached audio range request', async () => {
  const url = 'https://archive.org/download/item/track.opus';
  const requests = [];
  const harness = await createServiceWorkerHarness({
    fetch: async request => {
      requests.push(request);
      if (request.headers.has('Range')) {
        return new Response('0123', {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-3/10', 'Content-Type': 'audio/ogg' }
        });
      }
      return new Response('0123456789', {
        headers: { 'Content-Type': 'audio/ogg' }
      });
    }
  });

  const first = await harness.dispatch(new Request(url, {
    mode: 'no-cors',
    headers: { Range: 'bytes=0-3' }
  }));
  assert.equal(first.response.status, 206);
  await Promise.all(first.backgroundTasks);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers.has('Range'), false);
  assert.equal(await harness.audioCacheEntries.get(url).clone().text(), '0123456789');

  const second = await harness.dispatch(new Request(url, {
    mode: 'no-cors',
    headers: { Range: 'bytes=4-' }
  }));
  assert.equal(second.response.status, 206);
  assert.equal(await second.response.text(), '456789');
  assert.equal(second.response.headers.get('Content-Range'), 'bytes 4-9/10');
  assert.equal(requests.length, 2);
});

test('Service worker does not intercept CORS fetches for Archive.org audio', async () => {
  let networkRequests = 0;
  const harness = await createServiceWorkerHarness({
    fetch: async () => {
      networkRequests += 1;
      return new Response('audio');
    }
  });

  const { intercepted } = await harness.dispatch(new Request(
    'https://archive.org/download/item/track.mp3',
    { mode: 'cors' }
  ));

  assert.equal(intercepted, false);
  assert.equal(networkRequests, 0);
});

test('Service worker intercepts API audio streams but leaves other API calls alone', async () => {
  const requestedUrls = [];
  const harness = await createServiceWorkerHarness({
    fetch: async request => {
      requestedUrls.push(request.url);
      return new Response('stream', { headers: { 'Content-Type': 'audio/mpeg' } });
    }
  });

  const stream = await harness.dispatch(new Request('https://resonate.test/api/stream/track'));
  assert.equal(stream.intercepted, true);
  assert.equal(await stream.response.text(), 'stream');
  await Promise.all(stream.backgroundTasks);

  const metadata = await harness.dispatch(new Request('https://resonate.test/api/archive/metadata/item'));
  assert.equal(metadata.intercepted, false);
  assert.deepEqual(requestedUrls, ['https://resonate.test/api/stream/track']);
});

test('Service worker does not intercept unrelated API requests', async () => {
  const harness = await createServiceWorkerHarness({
    fetch: async () => new Response('unused')
  });
  const { intercepted } = await harness.dispatch(new Request('https://resonate.test/api/search'));
  assert.equal(intercepted, false);
});

test('Play starts the loaded track and updates the transport button', async () => {
  const { context, audio, playButton, state } = await createPlayer();

  context.togglePlay();
  await Promise.resolve();

  assert.equal(audio.playCalls, 1);
  assert.equal(state.userPaused, false);
  assert.equal(playButton.dataset.state, 'pause');
  assert.equal(playButton.attributes['aria-label'], 'Pause');
});

test('Pause stops the track and updates the transport button', async () => {
  const { context, audio, playButton, state } = await createPlayer();
  audio.paused = false;

  context.togglePlay();

  assert.equal(audio.pauseCalls, 1);
  assert.equal(state.userPaused, true);
  assert.equal(playButton.dataset.state, 'play');
  assert.equal(playButton.attributes['aria-label'], 'Play');
});

test('Playback controls are ignored while a track is loading', async () => {
  const { context, audio, state } = await createPlayer();
  state.isLoading = true;
  audio.paused = false;

  context.togglePlay();

  assert.equal(audio.playCalls, 0);
  assert.equal(audio.pauseCalls, 0);
});

test('Keyboard seeking clamps at track boundaries and supports Home/End', async () => {
  const { context, audio } = await createPlayer();
  const progressBar = Object.assign(createEventTarget(), {
    classList: createClassList(),
    getBoundingClientRect: () => ({ left: 0, width: 120 }),
    setAttribute() {},
    closest: () => null
  });
  context.elements.progressBar = progressBar;
  context.elements.progress = { style: {} };
  context.elements.currentTime = { textContent: '', offsetWidth: 0 };
  context.elements.totalTime = { textContent: '', offsetWidth: 0 };
  let progressUpdates = 0;
  context.updateProgressBar = () => { progressUpdates += 1; };
  context.setupProgressBarInteraction();

  const press = key => progressBar.dispatchEvent({ type: 'keydown', key });
  audio.currentTime = 2;
  press('ArrowLeft');
  assert.equal(audio.currentTime, 0);
  press('PageUp');
  assert.equal(audio.currentTime, 10);
  press('End');
  assert.equal(audio.currentTime, 119);
  press('Home');
  assert.equal(audio.currentTime, 0);
  assert.equal(progressUpdates, 4);
});

test('Clicking the progress bar seeks to the selected position and updates ARIA feedback', async () => {
  const { context, audio } = await createPlayer();
  const attributes = {};
  const progressBar = Object.assign(createEventTarget(), {
    classList: createClassList(),
    getBoundingClientRect: () => ({ left: 0, width: 100 }),
    setAttribute(name, value) { attributes[name] = value; },
    closest: () => null
  });
  const progress = { style: {} };
  const progressThumb = { style: {} };
  const currentTime = { textContent: '', offsetWidth: 0 };
  context.elements.progressBar = progressBar;
  context.elements.progress = progress;
  context.elements.progressThumb = progressThumb;
  context.elements.currentTime = currentTime;
  context.elements.totalTime = { textContent: '', offsetWidth: 0 };
  context.setupProgressBarInteraction();

  progressBar.dispatchEvent({ type: 'click', clientX: 25 });

  assert.equal(audio.currentTime, 30);
  assert.equal(progress.style.transform, 'scaleX(0.25)');
  assert.equal(progressThumb.style.transform, 'translate3d(25%, 0, 0)');
  assert.equal(attributes['aria-valuenow'], 25);
  assert.equal(attributes['aria-valuetext'], '0:30 de 2:00');
});

test('Pointer dragging batches seek updates to one animation frame', async () => {
  const { context, audio } = await createPlayer();
  const attributes = {};
  const progressBar = Object.assign(createEventTarget(), {
    classList: createClassList(),
    getBoundingClientRect: () => ({ left: 0, width: 100 }),
    setAttribute(name, value) { attributes[name] = value; },
    closest: () => null
  });
  const progress = { style: {} };
  const progressThumb = { style: {} };
  context.elements.progressBar = progressBar;
  context.elements.progress = progress;
  context.elements.progressThumb = progressThumb;
  context.elements.currentTime = { textContent: '', offsetWidth: 0 };
  context.elements.totalTime = { textContent: '', offsetWidth: 0 };

  let nextFrameId = 0;
  const frames = new Map();
  context.requestAnimationFrame = callback => {
    const id = ++nextFrameId;
    frames.set(id, callback);
    return id;
  };
  context.cancelAnimationFrame = id => frames.delete(id);
  context.setupProgressBarInteraction();

  progressBar.dispatchEvent({
    type: 'pointerdown',
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    clientX: 10,
    cancelable: true
  });
  context.document.dispatchEvent({
    type: 'pointermove',
    pointerId: 1,
    clientX: 70,
    cancelable: true
  });

  assert.equal(frames.size, 1);
  assert.equal(audio.currentTime, 0);
  const [frameId, renderFrame] = frames.entries().next().value;
  frames.delete(frameId);
  renderFrame();
  assert.equal(audio.currentTime, 84);
  assert.equal(progress.style.transform, 'scaleX(0.7)');
  assert.equal(progressThumb.style.transform, 'translate3d(70%, 0, 0)');
  assert.equal(attributes['aria-valuenow'], 70);

  context.document.dispatchEvent({
    type: 'pointerup',
    pointerId: 1,
    clientX: 75
  });
  assert.equal(audio.currentTime, 90);
  assert.equal(context.state.isSeeking, false);
});

test('Playback time updates coalesce and render the latest position in one animation frame', async () => {
  const { context, audio } = await createPlayer();
  const progressBar = Object.assign(createEventTarget(), {
    setAttribute(name, value) { this[name] = value; }
  });
  const progress = { style: {} };
  const progressThumb = { style: {} };
  const currentTime = { textContent: '' };
  const totalTime = { textContent: '' };
  context.elements.progressBar = progressBar;
  context.elements.progress = progress;
  context.elements.progressThumb = progressThumb;
  context.elements.progressBuffered = { style: {} };
  context.elements.currentTime = currentTime;
  context.elements.totalTime = totalTime;
  audio.buffered = { length: 0 };

  let nextFrameId = 0;
  const frames = new Map();
  context.requestAnimationFrame = callback => {
    const id = ++nextFrameId;
    frames.set(id, callback);
    return id;
  };
  context.cancelAnimationFrame = id => frames.delete(id);
  let mediaPositionUpdates = 0;
  context.updateMediaPositionState = () => { mediaPositionUpdates += 1; };

  context.updateProgressBar();
  audio.currentTime = 45;
  context.updateProgressBar();
  assert.equal(frames.size, 1);

  const [frameId, renderFrame] = frames.entries().next().value;
  frames.delete(frameId);
  renderFrame();
  assert.equal(progress.style.transform, 'scaleX(0.375)');
  assert.equal(progressThumb.style.transform, 'translate3d(37.5%, 0, 0)');
  assert.equal(currentTime.textContent, '0:45');
  assert.equal(totalTime.textContent, '2:00');
  assert.equal(progressBar['aria-valuenow'], 38);
  assert.equal(mediaPositionUpdates, 1);
});

test('Playlist queue filters invalid tracks and starts from the requested index', async () => {
  const { context, state } = await createPlayer();
  const tracks = [
    { url: 'https://archive.org/first.mp3', title: 'First' },
    { url: 'https://archive.org/undefined.mp3', title: 'Invalid' },
    { url: 'https://archive.org/third.mp3?download=1', title: 'Third' },
    { title: 'Missing URL' }
  ];

  context.loadPlaybackQueue('playlist', tracks, 1);

  assert.deepEqual(
    Array.from(state.playbackQueue, track => track.title),
    ['Third', 'First']
  );
  assert.equal(state.playbackQueue[0].trackIndex, 2);
});

test('Search queue accepts identifier-only results', async () => {
  const { context, state } = await createPlayer();

  context.loadPlaybackQueue('search', [
    { identifier: 'release-one', title: 'Release one' },
    { title: 'No identifier or URL' }
  ]);

  assert.deepEqual(
    Array.from(state.playbackQueue, track => track.identifier),
    ['release-one']
  );
});

test('Sequential context navigation advances, wraps, and goes back', async () => {
  const { context } = await createPlayer();
  const tracks = [
    { url: 'https://archive.org/one.mp3' },
    { url: 'https://archive.org/two.mp3' }
  ];
  const manager = context.playbackManager;

  manager.setContext('album', tracks, 0, 'release');

  assert.equal(manager.getNextTrack(), tracks[1]);
  assert.equal(manager.getNextTrack(), tracks[0]);
  assert.equal(manager.getPreviousTrack(), tracks[1]);
  assert.equal(manager.getCurrentAlbumId(), 'release');
});

test('The shuffle button interaction toggles the persisted mode and rebuilds the queue', async () => {
  const { context, state, announcements } = await createPlayer();
  const shuffleButton = Object.assign(createMockElement('BUTTON'), {
    dataset: {},
    disabled: false
  });
  context.elements.shuffleFavoritesBtn = shuffleButton;
  context.playbackManager.setAlbumPlaylist('release', [
    { url: 'https://archive.org/one.mp3' },
    { url: 'https://archive.org/two.mp3' },
    { url: 'https://archive.org/three.mp3' }
  ]);

  context.toggleShuffleFavorites();
  assert.equal(state.shuffleFavorites, true);
  assert.equal(context.playbackStateManager.getShuffleMode(), true);
  assert.equal(context.localStorage.getItem('resonate_shuffle_enabled'), 'true');
  assert.equal(shuffleButton.classList.contains('active'), true);
  assert.match(announcements[0].message, /Modo aleatorio activado/);

  context.toggleShuffleFavorites();
  assert.equal(state.shuffleFavorites, false);
  assert.equal(context.playbackStateManager.getShuffleMode(), false);
  assert.equal(shuffleButton.classList.contains('active'), false);
  assert.match(announcements[1].message, /Modo aleatorio desactivado/);
});

test('Loading a changed continuous playback queue announces its size', async () => {
  const { context, state, announcements } = await createPlayer();
  state.networkOnline = false;

  context.loadPlaybackQueue('playlist', [
    { url: 'https://archive.org/one.mp3' },
    { url: 'https://archive.org/two.mp3' }
  ]);

  assert.equal(state.playbackQueue.length, 2);
  assert.match(announcements[0].message, /Cola de reproducción continua actualizada: 2 pistas/);

  context.loadPlaybackQueue('playlist', [
    { url: 'https://archive.org/one.mp3' },
    { url: 'https://archive.org/two.mp3' }
  ]);
  assert.equal(announcements.length, 1);
});

test('Playback track announcements include the track and artist', async () => {
  const { context, announcements } = await createPlayer();

  context.announcePlaybackTrack({ title: 'A New Track', artist: 'An Artist' });

  assert.equal(announcements[0].message, 'Reproduciendo: A New Track, An Artist');
});

test('Offline playback refuses tracks absent from offline caches and announces why', async () => {
  const { context, audio, state, announcements } = await createPlayer();
  const statuses = [];
  state.networkOnline = false;
  context.showStatus = (...args) => statuses.push(args);
  context.OfflineStatusManager = {
    async checkTrackAvailability() {
      return { available: false, complete: false, partial: false };
    }
  };

  const result = await context.playAudioTrackOptimized({
    url: 'https://archive.org/not-cached.mp3',
    title: 'Uncached track'
  });

  assert.equal(result, false);
  assert.equal(audio.playCalls, 0);
  assert.match(statuses[0][0], /no está disponible sin conexión/);
  assert.equal(announcements[0].priority, 'assertive');
});

test('Loading an empty queue clears any previous queue', async () => {
  const { context, state } = await createPlayer();
  state.playbackQueue = [{ url: 'https://archive.org/stale.mp3' }];

  context.loadPlaybackQueue('playlist', []);

  assert.deepEqual(Array.from(state.playbackQueue), []);
});

test('Play without a loaded track does not start audio when there are no saved tracks', async () => {
  const { context, audio, state } = await createPlayer();
  audio.src = '';

  context.togglePlay();

  assert.equal(audio.playCalls, 0);
  assert.equal(state.userInteracted, false);
});

test('A rejected audio play leaves the button in Play state and reports the error', async () => {
  const { context, audio, playButton } = await createPlayer();
  const statuses = [];
  audio.play = () => Promise.reject(new Error('Audio device unavailable'));
  context.showStatus = (...args) => statuses.push(args);

  context.togglePlay();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(playButton.dataset.state, 'play');
  assert.ok(statuses.some(([message, type]) => message === 'Playback encountered an error' && type === 'error'));
});

test('The playback manager keeps continuous repeat mode and persists shuffle changes', async () => {
  const { context, state } = await createPlayer();
  const manager = context.playbackStateManager;

  assert.equal(manager.getRepeatMode(), 'all');
  manager.setShuffleMode(true);
  assert.equal(manager.getShuffleMode(), true);
  assert.equal(context.localStorage.getItem('resonate_shuffle_enabled'), 'true');
  assert.equal(context.localStorage.getItem('playbackConfig'), JSON.stringify({ shuffle: true }));
  assert.equal(state.shuffleFavorites, false);
});

test('Track-end and recovery requests share one in-flight transition', async () => {
  const { context } = await createPlayer();
  const controller = context.enhancedPlaybackController;
  let resolveTransition;
  let transitionCalls = 0;
  controller.currentHandler = {
    handleTrackEnd() {
      transitionCalls += 1;
      return new Promise(resolve => { resolveTransition = resolve; });
    }
  };

  const endedTransition = controller.handleTrackEnd();
  const duplicateTransition = controller.handleTrackEnd();
  const recoveryTransition = context.playNextInContext();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(transitionCalls, 1);
  assert.equal(controller.isTransitioning(), true);
  resolveTransition();
  await Promise.all([endedTransition, duplicateTransition, recoveryTransition]);
  assert.equal(controller.isTransitioning(), false);
});

test('Context playback advances and loops continuously at the end of the queue', async () => {
  const { context } = await createPlayer();
  const tracks = [
    { url: 'https://archive.org/first.mp3', title: 'First' },
    { url: 'https://archive.org/second.mp3', title: 'Second' }
  ];
  const played = [];
  context.playbackManager.setSearchPlaylist(tracks, 0);
  context.enhancedPlaybackController.setContext('searchPlaylist');
  context.playAudioTrackOptimized = async track => { played.push(track.title); };

  await context.enhancedPlaybackController.handleTrackEnd();
  await context.enhancedPlaybackController.handleTrackEnd();

  assert.deepEqual(played, ['Second', 'First']);
});

test('Cast playback advances the queue on the receiver without starting local audio', async () => {
  const { context, audio, state } = await createPlayer();
  const tracks = [
    { url: 'https://archive.org/first.mp3', title: 'First' },
    { url: 'https://archive.org/second.mp3', title: 'Second' }
  ];
  const loadedOnReceiver = [];
  context.elements.title = { textContent: '' };
  context.elements.creator = { textContent: '' };
  context.setArtwork = async () => {};
  context.updateFavoriteButton = () => {};
  context.updateMediaSessionMetadata = () => {};
  context.CastManager = {
    isSessionActive: () => true,
    async loadMediaFromTrack(track, url, currentTime, duration, options) {
      loadedOnReceiver.push({ title: track.title, url, currentTime, duration, force: options.force });
    }
  };
  context.playbackManager.setSearchPlaylist(tracks, 0);
  context.enhancedPlaybackController.setContext('searchPlaylist');

  await context.enhancedPlaybackController.handleTrackEnd();
  await context.enhancedPlaybackController.handleTrackEnd();

  assert.deepEqual(
    loadedOnReceiver.map(item => item.title),
    ['Second', 'First']
  );
  assert.ok(loadedOnReceiver.every(item => item.force));
  assert.equal(audio.playCalls, 0);
  assert.equal(audio.pauseCalls, 0);
  assert.equal(audio.src, 'https://archive.org/audio.mp3');
  assert.equal(state.isLoading, false);
});

test('A failed track transition releases its lock and propagates the error', async () => {
  const { context } = await createPlayer();
  const controller = context.enhancedPlaybackController;
  controller.currentHandler = {
    async handleTrackEnd() {
      throw new Error('Track transition failed');
    }
  };

  await assert.rejects(controller.handleTrackEnd(), /Track transition failed/);
  assert.equal(controller.isTransitioning(), false);
  assert.equal(context.playbackStateManager.state.stats.consecutiveFailures, 1);
});

test('Playback history retains only the newest 50 played tracks and 20 skipped tracks', async () => {
  const { context } = await createPlayer();
  const manager = context.playbackStateManager;

  for (let index = 0; index < 55; index += 1) {
    manager.addToHistory({ title: `Played ${index}` });
  }
  for (let index = 0; index < 25; index += 1) {
    manager.addToHistory({ title: `Skipped ${index}` }, 'skipped');
  }

  assert.equal(manager.state.history.played.length, 50);
  assert.equal(manager.state.history.played[0].title, 'Played 54');
  assert.equal(manager.state.history.played[49].title, 'Played 5');
  assert.equal(manager.state.history.skipped.length, 20);
  assert.equal(manager.state.history.skipped[0].title, 'Skipped 24');
});

test('Track normalization cleans creator noise, parses duration, and filters tracks without URLs', async () => {
  const { context } = await createSandbox();
  await evaluateScript(context, 'js/track-normalizer.js');
  const normalized = context.TrackNormalizer.normalizeTrack({
    title: 'Artist Name - A Song',
    creator: 'Artist Name',
    duration: '3:05',
    url: 'https://archive.org/song.mp3'
  });

  assert.equal(normalized.title, 'A Song');
  assert.equal(normalized.duration, 185);
  assert.equal(normalized.trackIndex, undefined);
  assert.equal(context.TrackNormalizer.normalizeTrackList([
    { url: 'https://archive.org/valid.mp3' },
    { title: 'Missing URL' }
  ]).length, 1);
});

test('Playlist creation, renaming, duplicate prevention, removal, and deletion persist correctly', async () => {
  const { context, localStorage } = await createSandbox();
  await evaluateScript(context, 'js/playlist-manager.js');
  context.setTimeout = setTimeout;
  context.clearTimeout = clearTimeout;
  const playlists = context.PlaylistManager;
  const playlist = playlists.createPlaylist('  Road trip  ', { immediateSave: true });
  const track = {
    url: 'https://archive.org/track.mp3?utm_source=test',
    title: 'Track',
    creator: 'Artist',
    duration: '90'
  };

  assert.equal(playlist.name, 'Road trip');
  assert.equal(playlists.addTrack(playlist.id, track, { immediateSave: true }), true);
  assert.equal(playlists.addTrack(playlist.id, { ...track, url: 'https://archive.org/track.mp3' }), false);
  assert.equal(playlists.getById(playlist.id).tracks.length, 1);
  assert.equal(playlists.renamePlaylist(playlist.id, '  Commute  '), true);
  assert.equal(playlists.getById(playlist.id).name, 'Commute');
  assert.equal(playlists.removeTrack(playlist.id, 'https://archive.org/track.mp3'), true);
  assert.equal(playlists.getById(playlist.id).tracks.length, 0);
  assert.equal(playlists.deletePlaylist(playlist.id), true);
  assert.equal(playlists.getById(playlist.id), null);
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.deepEqual(JSON.parse(localStorage.getItem('resonate_playlists')), []);
});

test('Invalid playlist tracks and unknown playlist operations are rejected', async () => {
  const { context } = await createSandbox();
  await evaluateScript(context, 'js/playlist-manager.js');
  const playlists = context.PlaylistManager;

  assert.equal(playlists.addTrack('missing', { url: 'https://archive.org/a.mp3' }), false);
  assert.equal(playlists.addTrack(playlists.createPlaylist('Valid').id, { title: 'No URL' }), false);
  assert.equal(playlists.renamePlaylist('missing', 'Name'), false);
  assert.equal(playlists.removeTrack('missing', 'https://archive.org/a.mp3'), false);
  assert.equal(playlists.deletePlaylist('missing'), false);
});

test('Stored playlists sanitize tracks and remove normalized URL duplicates', async () => {
  const { context, localStorage } = await createSandbox();
  localStorage.setItem('resonate_playlists', JSON.stringify([{
    id: 'stored',
    name: 'Stored playlist',
    tracks: [
      { url: 'https://archive.org/track.mp3?utm_source=import', title: 'Track' },
      { url: 'https://archive.org/track.mp3', title: 'Duplicate' },
      { title: 'Missing URL' }
    ]
  }]));
  await evaluateScript(context, 'js/playlist-manager.js');

  const [playlist] = context.PlaylistManager.getAll();
  assert.equal(playlist.tracks.length, 1);
  assert.equal(playlist.tracks[0].url, 'https://archive.org/track.mp3');
  assert.equal(playlist.tracks[0].title, 'Track');
});

test('Playlist import sanitizes items and drops duplicate or invalid URLs', async () => {
  class MockFileReader {
    readAsText(file) {
      this.onload({ target: { result: file.contents } });
    }
  }
  const { context, localStorage } = await createSandbox({ FileReader: MockFileReader });
  await evaluateScript(context, 'js/playlist-manager.js');
  const imported = await context.PlaylistManager.importFromGrayjay({
    name: 'grayjay-export.json',
    contents: JSON.stringify({
      name: 'Imported favorites',
      items: [
        { url: 'https://archive.org/one.mp3?utm_source=export', name: 'One', author: 'Artist' },
        { url: 'https://archive.org/one.mp3', name: 'Duplicate' },
        { name: 'Invalid' }
      ]
    })
  });

  assert.equal(imported.name, 'Imported favorites');
  assert.equal(imported.tracks.length, 1);
  assert.equal(imported.tracks[0].title, 'One');
  assert.equal(JSON.parse(localStorage.getItem('resonate_playlists')).length, 1);
  await assert.rejects(context.PlaylistManager.importFromGrayjay(null), /No file provided/);
});

test('Theme cycling follows Day, Night, Eco during daytime and persists each user choice', async () => {
  const root = createMockElement();
  const themeToggle = createMockElement('BUTTON');
  const metaTheme = createMockElement('META');
  const document = Object.assign(createEventTarget(), {
    readyState: 'loading',
    documentElement: root,
    body: createMockElement('BODY'),
    getElementById: id => id === 'theme-toggle' ? themeToggle : null,
    querySelector: selector => selector === 'meta[name="theme-color"]' ? metaTheme : null,
    createElement: tagName => createMockElement(tagName.toUpperCase()),
    createElementNS: (_namespace, tagName) => createMockElement(tagName.toUpperCase())
  });
  root.ownerDocument = document;
  themeToggle.ownerDocument = document;
  metaTheme.ownerDocument = document;
  class MiddayDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [2026, 5, 1, 12]));
    }
  }
  const { context, localStorage } = await createSandbox({
    document,
    Date: MiddayDate,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: true, addEventListener() {} })
  });
  await evaluateScript(context, 'js/theme.js');
  document.dispatchEvent({ type: 'DOMContentLoaded' });

  assert.equal(context.ThemeManager.getCurrentTheme(), 'day');
  assert.equal(root.getAttribute('data-theme'), 'day');
  themeToggle.dispatchEvent({ type: 'click' });
  assert.equal(root.getAttribute('data-theme'), 'night');
  assert.equal(localStorage.getItem('resonate-theme'), 'night');
  themeToggle.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(root.getAttribute('data-theme'), 'night');
  themeToggle.dispatchEvent({ type: 'click' });
  assert.equal(root.getAttribute('data-theme'), 'energy-saver');
  assert.equal(localStorage.getItem('resonate-theme'), 'energy-saver');
  assert.equal(themeToggle.dataset.theme, 'energy-saver');
});

test('Theme manager stays usable without a toggle and cycles from the active theme', async () => {
  const root = createMockElement();
  const document = Object.assign(createEventTarget(), {
    readyState: 'loading',
    documentElement: root,
    getElementById: () => null,
    querySelector: () => null
  });
  const { context, storage } = await createSandbox({
    document,
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  });
  storage.set('resonate-theme', 'night');

  await evaluateScript(context, 'js/theme.js');
  document.dispatchEvent({ type: 'DOMContentLoaded' });
  assert.equal(root.getAttribute('data-theme'), 'night');

  context.ThemeManager.applyTheme('energy-saver');
  context.ThemeManager.cycleTheme();

  assert.equal(root.getAttribute('data-theme'), 'day');
  assert.equal(context.ThemeManager.getCurrentTheme(), 'day');
  assert.equal(storage.get('resonate-theme'), 'day');
});

test('Production hosts skip the archive proxy unless explicitly enabled', async () => {
  const { context } = await createSandbox({
    location: { href: 'https://www.resonateplayer.com/', hostname: 'www.resonateplayer.com', protocol: 'https:', search: '' }
  });
  await evaluateSearchScripts(context);

  assert.equal(context.shouldPreferArchiveProxy(), false);
  context.location.search = '?proxy=1';
  assert.equal(context.shouldPreferArchiveProxy(), true);

  const local = await createSandbox({
    location: { href: 'http://localhost:8000/?proxy=1', hostname: 'localhost', protocol: 'http:', search: '?proxy=1' }
  });
  await evaluateSearchScripts(local.context);
  assert.equal(local.context.shouldPreferArchiveProxy(), true);
});

test('Service worker caches opaque Archive.org cover responses', async () => {
  const entries = new Map();
  const cache = {
    async match(request) { return entries.get(request.url) || null; },
    async put(request, response) { entries.set(request.url, response); },
    async keys() { return Array.from(entries.keys(), url => ({ url })); },
    async delete(request) { return entries.delete(request.url); }
  };
  const fetchHandlers = [];
  let networkCalls = 0;
  const opaqueResponse = {
    type: 'opaque',
    ok: false,
    headers: new Headers(),
    clone() { return this; }
  };
  const { context } = await createSandbox({
    self: {
      location: {
        protocol: 'https:',
        hostname: 'localhost',
        port: '',
        origin: 'https://resonate.test'
      },
      console,
      addEventListener(type, handler) {
        if (type === 'fetch') fetchHandlers.push(handler);
      }
    },
    caches: { async open() { return cache; } },
    fetch: async () => {
      networkCalls += 1;
      return opaqueResponse;
    },
    Headers,
    Response
  });
  context.self.self = context.self;
  await evaluateScript(context, 'sw.js');

  const request = {
    method: 'GET',
    url: 'https://archive.org/services/img/chevelleblue320flac'
  };
  const fetchCover = async () => {
    let responsePromise;
    fetchHandlers[0]({
      request,
      respondWith(response) { responsePromise = response; }
    });
    return responsePromise;
  };

  assert.equal(await fetchCover(), opaqueResponse);
  assert.equal(await fetchCover(), opaqueResponse);
  assert.equal(networkCalls, 1);
});

test('Search query helpers parse intent and build filtered Archive.org queries', async () => {
  const { context } = await createSandbox({
    state: { searchUi: { mediatype: 'audio' } }
  });
  await evaluateScript(context, 'js/search-query.js');

  const artistIntent = context.parseSearchIntent('Massive Attack');
  const mixedIntent = context.parseSearchIntent('Massive Attack - Teardrop');
  const query = context.buildOptimizedArchiveQuery(
    'Massive Attack - Teardrop',
    context.getSearchNetworkFilterState(),
    mixedIntent
  );

  assert.equal(context.normalizeString('Beyoncé'), 'beyonce');
  assert.equal(artistIntent.intent, 'artist');
  assert.equal(artistIntent.artist, 'Massive Attack');
  assert.equal(mixedIntent.intent, 'mixed');
  assert.equal(mixedIntent.artist, 'Massive Attack');
  assert.equal(mixedIntent.title, 'Teardrop');
  assert.match(query, /creator:\(Massive Attack\) AND title:\(Teardrop\)/);
  assert.match(query, /mediatype:audio/);
  assert.equal(context.getArchiveSortParam(artistIntent), '&sort[]=downloads+desc');
  assert.equal(context.getArchiveSortParam(mixedIntent), '');
});

test('Fast search sends a query with the audio filter and normalizes returned results', async () => {
  const { context } = await createSandbox({
    state: { networkOnline: true, searchUi: { mediatype: 'audio' } },
    SEARCH_CONFIG: { timeout: 1000 },
    fetchWithTimeout: async (url, options) => {
      context.searchRequest = { url, options };
      return {
        ok: true,
        json: async () => ({
          response: {
            numFound: 2,
            docs: [
              { identifier: 'release-one', title: 'A song', creator: 'An artist', downloads: '12', year: '2020' }
            ]
          }
        })
      };
    }
  });
  await evaluateSearchScripts(context);
  const result = await context.performFastSearch('title: A song', { rows: 5, timeout: 750 });
  const requestUrl = new URL(context.searchRequest.url, context.location.href);

  assert.equal(requestUrl.searchParams.get('rows'), '5');
  assert.equal(requestUrl.searchParams.get('q').includes('mediatype:audio'), true);
  assert.equal(context.searchRequest.options.timeout, 45000);
  assert.equal(result.results[0].identifier, 'release-one');
  assert.equal(result.results[0].downloads, 12);
  assert.equal(result.results[0].year, 2020);
  assert.equal(result.hasMore, false);
});

test('Fast search does not issue a network request while the player is offline', async () => {
  let fetchCalls = 0;
  const { context } = await createSandbox({
    state: { networkOnline: false },
    fetchWithTimeout: async () => {
      fetchCalls += 1;
      throw new Error('Offline search should not reach fetch');
    }
  });
  await evaluateSearchScripts(context);

  const result = await context.performFastSearch('ambient music');

  assert.equal(result.results.length, 0);
  assert.equal(result.fastPath, true);
  assert.equal(fetchCalls, 0);
});

test('Cached search results are detected using the active query and filter key', async () => {
  const cache = new Map();
  const enhancedCache = {
    get: (type, key) => cache.get(`${type}:${key}`) || null,
    set: (type, key, value) => cache.set(`${type}:${key}`, value)
  };
  const { context } = await createSandbox({
    state: { searchUi: { mediatype: 'audio' } },
    enhancedCache
  });
  await evaluateSearchScripts(context);

  assert.equal(context.hasCachedSearchResults('ambient music'), false);
  const key = context.__resonateGetSearchCacheKey('ambient music', 0);
  enhancedCache.set('search', key, { results: [{ identifier: 'cached-release' }] });

  assert.equal(context.hasCachedSearchResults('ambient music'), true);
  assert.equal(context.hasCachedSearchResults('  '), false);
  context.state.searchUi.mediatype = 'movies';
  assert.equal(context.hasCachedSearchResults('ambient music'), false);
  const memoryKey = context.__resonateGetSearchCacheKey('ambient music', 0);
  context.setMemoryCachedSearchResults(memoryKey, { results: [{ identifier: 'memory-release' }] });
  assert.equal(context.hasCachedSearchResults('ambient music'), true);
});

test('Search memory cache keeps the 50 most recently used results', async () => {
  const { context } = await createSandbox({
    state: { searchUi: { mediatype: 'audio' } }
  });
  await evaluateSearchScripts(context);

  const oldestResult = { results: [{ identifier: 'recently-used' }] };
  for (let index = 0; index < 50; index += 1) {
    context.setMemoryCachedSearchResults(`query-${index}`, index === 0 ? oldestResult : { results: [] });
  }

  assert.equal(context.getMemoryCachedSearchResults('query-0'), oldestResult);
  context.setMemoryCachedSearchResults('query-50', { results: [] });

  assert.equal(context.getMemoryCachedSearchResults('query-0'), oldestResult);
  assert.equal(context.getMemoryCachedSearchResults('query-1'), null);
  assert.ok(context.getMemoryCachedSearchResults('query-50'));
});

test('Search input dispatch waits for a 300ms debounce and uses the latest query', async () => {
  const uiSource = await readFile(new URL('js/ui.js', projectRoot), 'utf8');
  const helper = uiSource.match(/function scheduleSearchWithDebounce\(query, input\) \{[\s\S]*?\n\}/);
  assert.ok(helper, 'scheduleSearchWithDebounce should exist');

  const timers = [];
  const clearedTimers = [];
  const dispatchedQueries = [];
  const state = { currentSearchQuery: '', searchDebounceTimeout: null };
  const context = {
    state,
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      clearedTimers.push(timer);
    },
    dispatchSearchWithFastPath(query) {
      dispatchedQueries.push(query);
    }
  };
  vm.runInNewContext(helper[0], context);

  const input = { value: 'first query' };
  context.scheduleSearchWithDebounce('first query', input);
  input.value = 'latest query';
  context.scheduleSearchWithDebounce('latest query', input);

  assert.equal(timers[0].delay, 300);
  assert.deepEqual(clearedTimers, [timers[0]]);
  assert.equal(timers[1].delay, 300);
  timers[1].callback();
  assert.deepEqual(dispatchedQueries, ['latest query']);
});

test('Editing a submitted query aborts its UI requests and invalidates its response', async () => {
  const uiSource = await readFile(new URL('js/ui.js', projectRoot), 'utf8');
  const helper = uiSource.match(/function cancelSearchForQueryChange\(query\) \{[\s\S]*?\n\}/);
  assert.ok(helper, 'cancelSearchForQueryChange should exist');

  let aborts = 0;
  let headerUpdates = 0;
  const state = {
    currentSearchQuery: 'slow search',
    searchRequestId: 4,
    searchUi: { isSearching: true, isUpgrading: true },
    _uiSearchControllers: { fast: {}, optimized: {} }
  };
  const context = {
    state,
    abortUiSearchControllers() { aborts += 1; },
    ensureSearchFiltersHeader() { headerUpdates += 1; }
  };
  vm.runInNewContext(`${helper[0]}; cancelSearchForQueryChange('new search');`, context);

  assert.equal(state.searchRequestId, 5);
  assert.equal(state._uiSearchControllers, null);
  assert.equal(state.searchUi.isSearching, false);
  assert.equal(state.searchUi.isUpgrading, false);
  assert.equal(aborts, 1);
  assert.equal(headerUpdates, 1);
});

test('A late search page cannot append to a newer query or clear its loading state', async () => {
  const uiSource = await readFile(new URL('js/ui.js', projectRoot), 'utf8');
  const loader = uiSource.match(/async function loadNextSearchResultsPage\(\) \{[\s\S]*?\n\}/);
  assert.ok(loader, 'loadNextSearchResultsPage should exist');

  let resolvePage;
  let displays = 0;
  const state = {
    currentSearchHasMore: true,
    currentSearchPage: 0,
    currentSearchQuery: 'old query',
    searchRequestId: 1,
    isLoadingMore: false
  };
  const context = {
    state,
    window: {
      performOptimizedSearch: () => new Promise(resolve => { resolvePage = resolve; }),
      logger: { warn() {} }
    },
    displaySearchResults() { displays += 1; }
  };
  const pageRequest = vm.runInNewContext(`${loader[0]}; loadNextSearchResultsPage();`, context);

  state.currentSearchQuery = 'new query';
  state.searchRequestId = 2;
  state.isLoadingMore = true;
  resolvePage({ results: [{ identifier: 'stale-result' }], hasMore: false });

  assert.equal(await pageRequest, false);
  assert.equal(state.currentSearchPage, 0);
  assert.equal(state.isLoadingMore, true);
  assert.equal(displays, 0);
});

test('Search pagination preserves an existing load lock and releases its own lock after success', async () => {
  const uiSource = await readFile(new URL('js/ui.js', projectRoot), 'utf8');
  const loader = uiSource.match(/async function loadNextSearchResultsPage\(\) \{[\s\S]*?\n\}/);
  assert.ok(loader, 'loadNextSearchResultsPage should exist');

  let calls = 0;
  let displays = 0;
  const state = {
    currentSearchHasMore: true,
    currentSearchPage: 0,
    currentSearchQuery: 'query',
    searchRequestId: 1,
    isLoadingMore: true
  };
  const context = {
    state,
    window: {
      performOptimizedSearch: async () => {
        calls += 1;
        return { results: [{ identifier: 'next-page-result' }], hasMore: false };
      }
    },
    displaySearchResults() { displays += 1; }
  };
  const loadPage = vm.runInNewContext(`${loader[0]}; loadNextSearchResultsPage;`, context);

  assert.equal(await loadPage(), false);
  assert.equal(state.isLoadingMore, true);
  assert.equal(calls, 0);

  state.isLoadingMore = false;
  assert.equal(await loadPage(), true);
  assert.equal(state.currentSearchPage, 1);
  assert.equal(state.isLoadingMore, false);
  assert.equal(calls, 1);
  assert.equal(displays, 1);
});

test('MediaSession controls dispatch user actions and clamp the reported seek position', async () => {
  const handlers = new Map();
  const positions = [];
  const mediaSession = {
    playbackState: 'none',
    metadata: null,
    setActionHandler(action, handler) {
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
    },
    setPositionState(position) { positions.push(position); }
  };
  const { context } = await createSandbox({
    navigator: { userAgent: '', mediaSession },
    MediaMetadata: class MediaMetadata {
      constructor(data) { Object.assign(this, data); }
    }
  });
  await evaluateScript(context, 'js/media-session-manager.js');
  const manager = new context.MediaSessionManager();
  const received = [];

  manager.setupActionHandlers({
    onPlay: () => received.push('play'),
    onPause: () => received.push('pause'),
    onNextTrack: () => received.push('next'),
    onSeekTo: details => received.push(details.seekTime)
  });
  handlers.get('play')();
  handlers.get('pause')();
  handlers.get('nexttrack')();
  handlers.get('seekto')({ seekTime: 20 });
  manager.updatePositionState({ duration: 100, position: 130 });

  assert.deepEqual(received, ['play', 'pause', 'next', 20]);
  assert.equal(positions[positions.length - 1].position, 100);
  assert.equal(manager.getStatus().actionHandlersCount, 4);
  manager.cleanup();
  assert.equal(manager.getStatus().isCleanedUp, true);
  assert.equal(mediaSession.playbackState, 'none');
  assert.equal(handlers.size, 0);
});

test('Bottom sheet opens from its trigger and closes on Escape with ARIA state restored', async () => {
  const overlay = createMockElement();
  const sheet = createMockElement();
  const trigger = createMockElement('BUTTON');
  const body = createMockElement('BODY');
  const document = Object.assign(createEventTarget(), {
    readyState: 'loading',
    body,
    activeElement: body,
    getElementById: id => id === 'bottom-sheet-overlay' ? overlay : id === 'test-sheet' ? sheet : null,
    querySelectorAll: selector => selector === '[data-sheet-target]' ? [trigger] : []
  });
  for (const element of [overlay, sheet, trigger, body]) element.ownerDocument = document;
  trigger.setAttribute('data-sheet-target', 'test-sheet');
  const { context } = await createSandbox({ document });
  await evaluateScript(context, 'js/player-bottom-sheet.js');
  document.dispatchEvent({ type: 'DOMContentLoaded' });

  trigger.dispatchEvent({ type: 'click' });
  assert.equal(sheet.classList.contains('open'), true);
  assert.equal(overlay.classList.contains('open'), true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(sheet.getAttribute('aria-hidden'), 'false');

  document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(sheet.classList.contains('open'), false);
  assert.equal(overlay.classList.contains('open'), false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(sheet.getAttribute('aria-hidden'), 'true');
});

test('Bottom sheet closes when the user activates the overlay', async () => {
  const overlay = createMockElement();
  const sheet = createMockElement();
  const trigger = createMockElement('BUTTON');
  const body = createMockElement('BODY');
  const document = Object.assign(createEventTarget(), {
    readyState: 'loading',
    body,
    activeElement: body,
    getElementById: id => id === 'bottom-sheet-overlay' ? overlay : id === 'test-sheet' ? sheet : null,
    querySelectorAll: selector => selector === '[data-sheet-target]' ? [trigger] : []
  });
  for (const element of [overlay, sheet, trigger, body]) element.ownerDocument = document;
  trigger.setAttribute('data-sheet-target', 'test-sheet');
  const { context } = await createSandbox({ document });
  await evaluateScript(context, 'js/player-bottom-sheet.js');
  document.dispatchEvent({ type: 'DOMContentLoaded' });
  trigger.dispatchEvent({ type: 'click' });
  overlay.dispatchEvent({ type: 'click' });

  assert.equal(sheet.classList.contains('open'), false);
  assert.equal(overlay.classList.contains('open'), false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('Cast controls synchronize the playback queue and load the current track', async () => {
  const button = createMockElement('BUTTON');
  const audio = Object.assign(createEventTarget(), {
    currentSrc: 'https://archive.org/audio.mp3',
    currentTime: 18,
    duration: 120
  });
  const contextData = {
    album: {
      items: [{ url: 'https://archive.org/audio.mp3' }, { url: 'https://archive.org/next.mp3' }],
      currentIndex: 0
    }
  };
  const track = {
    url: 'https://archive.org/audio.mp3',
    title: 'Current track',
    trackIndex: 0
  };
  const calls = [];
  const document = Object.assign(createEventTarget(), {
    getElementById: id => id === 'current-track-cast' ? button : id === 'audio' ? audio : null
  });
  const { context } = await createSandbox({
    document,
    elements: { audio, currentTrackCast: button },
    state: { currentTrack: track },
    playbackManager: {
      getCurrentContext: () => 'album',
      contextData
    },
    loadPlaybackQueue: (...args) => calls.push(['queue', ...args]),
    getCastCapabilities: () => ({ canRemotePlayback: false, canAirPlay: false }),
    CastManager: {
      ensureReady: async () => true,
      requestSession: async () => calls.push(['session']),
      loadMediaFromTrack: async (...args) => calls.push(['load', ...args])
    },
    showStatus: message => calls.push(['status', message]),
    logger: { info() {}, warn() {} }
  });
  await evaluateScript(context, 'js/cast-controls.js');

  button.dispatchEvent({ type: 'click' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(contextData.album.currentIndex, 0);
  assert.deepEqual(calls[0], ['queue', 'album', contextData.album.items, 1]);
  assert.deepEqual(calls[1], ['session']);
  assert.equal(calls[2][0], 'load');
  assert.equal(calls[2][1], track);
  assert.equal(calls[2][2], audio.currentSrc);
  assert.equal(calls[2][3], audio.currentTime);
  assert.equal(calls[2][4], audio.duration);
  assert.equal(calls[2][5].force, true);
  assert.deepEqual(calls[3], ['status', 'Casting to device']);
});

test('Cast controls use the current playlist URL instead of an album track index', async () => {
  const button = createMockElement('BUTTON');
  const tracks = [
    { url: 'https://archive.org/first.mp3' },
    { url: 'https://archive.org/current.mp3' },
    { url: 'https://archive.org/next.mp3' }
  ];
  const audio = Object.assign(createEventTarget(), {
    currentSrc: tracks[1].url,
    currentTime: 18,
    duration: 120
  });
  const contextData = {
    searchPlaylist: { items: tracks, currentIndex: 0 }
  };
  const track = {
    url: tracks[1].url,
    title: 'Current track',
    trackIndex: 0
  };
  const queued = [];
  const document = Object.assign(createEventTarget(), {
    getElementById: id => id === 'current-track-cast' ? button : id === 'audio' ? audio : null
  });
  const { context } = await createSandbox({
    document,
    elements: { audio, currentTrackCast: button },
    state: { currentTrack: track },
    playbackManager: {
      getCurrentContext: () => 'searchPlaylist',
      contextData
    },
    loadPlaybackQueue: (...args) => queued.push(args),
    getCastCapabilities: () => ({ canRemotePlayback: false, canAirPlay: false }),
    CastManager: {
      ensureReady: async () => true,
      requestSession: async () => {},
      loadMediaFromTrack: async () => {}
    },
    logger: { info() {}, warn() {} }
  });
  await evaluateScript(context, 'js/cast-controls.js');

  button.dispatchEvent({ type: 'click' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(contextData.searchPlaylist.currentIndex, 1);
  assert.deepEqual(queued, [['searchPlaylist', tracks, 2]]);
});

test('Cast controls use native remote playback when the Cast sender is unavailable', async () => {
  const button = createMockElement('BUTTON');
  const calls = [];
  const audio = Object.assign(createEventTarget(), {
    currentSrc: 'https://archive.org/audio.mp3',
    remote: {
      watchAvailability(callback) {
        callback(true);
      },
      async prompt() {
        calls.push('remote-prompt');
      }
    }
  });
  const document = Object.assign(createEventTarget(), {
    getElementById: id => id === 'current-track-cast' ? button : id === 'audio' ? audio : null
  });
  const { context } = await createSandbox({
    document,
    elements: { audio, currentTrackCast: button },
    location: {
      href: 'https://resonate.test/',
      hostname: 'resonate.test',
      protocol: 'https:',
      search: ''
    },
    getCastCapabilities: () => ({ canRemotePlayback: true, canAirPlay: false }),
    showStatus: message => calls.push(message),
    logger: { info() {}, warn() {} }
  });
  await evaluateScript(context, 'js/cast-controls.js');

  button.dispatchEvent({ type: 'click' });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls, ['remote-prompt', 'Choose a device to cast']);
});

test('Cast handoff pauses local audio before receiver startup and resumes it after failure', async () => {
  const button = createMockElement('BUTTON');
  const calls = [];
  const audio = Object.assign(createEventTarget(), {
    src: 'https://archive.org/current.mp3',
    currentSrc: 'https://archive.org/current.mp3',
    currentTime: 23,
    paused: false,
    pause() {
      calls.push('local-pause');
      this.paused = true;
    },
    play() {
      calls.push('local-resume');
      this.paused = false;
      return Promise.resolve();
    }
  });
  const document = Object.assign(createEventTarget(), {
    getElementById: id => id === 'current-track-cast' ? button : id === 'audio' ? audio : null
  });
  const { context } = await createSandbox({
    document,
    elements: { audio, currentTrackCast: button },
    state: { currentTrack: { url: audio.src, title: 'Song' } },
    getCastCapabilities: () => ({ canRemotePlayback: false, canAirPlay: false }),
    CastManager: {
      ensureReady: async () => true,
      prepareLocalPlaybackForCast() {
        const snapshot = { wasPlaying: !audio.paused, currentTime: audio.currentTime, source: audio.currentSrc };
        audio.pause();
        return snapshot;
      },
      async requestSession() {
        calls.push('request-session');
        throw new Error('Device selection failed');
      },
      resumeLocalPlaybackAfterCastFailure(snapshot) {
        calls.push(['restore', snapshot.currentTime]);
        audio.play();
      },
      isSessionActive: () => false
    },
    showStatus() {},
    logger: { info() {}, warn() {} }
  });
  await evaluateScript(context, 'js/cast-controls.js');

  button.dispatchEvent({ type: 'click' });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls.slice(0, 3), ['local-pause', 'request-session', ['restore', 23]]);
  assert.equal(audio.paused, false);
});

test('Cast manager configures CAF, synchronizes state, and restores local playback on disconnect', async () => {
  const button = createMockElement('BUTTON');
  const playButton = createMockElement('BUTTON');
  const audio = Object.assign(createEventTarget(), {
    src: 'https://archive.org/current.mp3',
    currentSrc: 'https://archive.org/current.mp3',
    currentTime: 7,
    duration: 180,
    volume: 0.7,
    muted: false,
    paused: true,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      this.playCalls += 1;
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
    load() {}
  });
  const controller = Object.assign(createEventTarget(), {
    calls: [],
    playOrPause() { this.calls.push('playOrPause'); },
    setVolumeLevel() { this.calls.push('setVolumeLevel'); },
    muteOrUnmute() { this.calls.push('muteOrUnmute'); }
  });
  const remotePlayer = {
    isConnected: false,
    isPaused: true,
    currentTime: 0,
    duration: 180,
    volumeLevel: 0.7,
    isMuted: false,
    mediaInfo: null
  };
  let loadedMediaRequest = null;
  const mediaUpdateListeners = new Set();
  let lastSeekRequest = null;
  const mediaSession = {
    mediaSessionId: 1,
    addUpdateListener(listener) { mediaUpdateListeners.add(listener); },
    removeUpdateListener(listener) { mediaUpdateListeners.delete(listener); },
    seek(request) { lastSeekRequest = request; }
  };
  const contextTarget = createEventTarget();
  const castContext = Object.assign(contextTarget, {
    options: null,
    castState: 'NO_DEVICES_AVAILABLE',
    sessionState: 'NO_SESSION',
    session: null,
    setOptions(options) { this.options = options; },
    getCastState() { return this.castState; },
    getSessionState() { return this.sessionState; },
    getCurrentSession() { return this.session; },
    requestSession() { return Promise.resolve(this.session); },
    endCurrentSession() {}
  });
  const session = {
    getSessionId: () => 'cast-session',
    getMediaSession: () => mediaSession,
    loadMedia(request) {
      loadedMediaRequest = request;
      return Promise.resolve();
    }
  };
  castContext.session = session;
  class MediaInfo {
    constructor(contentId, contentType) {
      this.contentId = contentId;
      this.contentType = contentType;
    }
  }
  class LoadRequest {
    constructor(media) { this.media = media; }
  }
  class MusicTrackMediaMetadata {}
  class SeekRequest {}
  const castFramework = {
    CastState: { NO_DEVICES_AVAILABLE: 'NO_DEVICES_AVAILABLE', NOT_CONNECTED: 'NOT_CONNECTED', CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED' },
    SessionState: {
      NO_SESSION: 'NO_SESSION',
      SESSION_STARTING: 'SESSION_STARTING',
      SESSION_STARTED: 'SESSION_STARTED',
      SESSION_RESUMING: 'SESSION_RESUMING',
      SESSION_RESUMED: 'SESSION_RESUMED',
      SESSION_ENDING: 'SESSION_ENDING',
      SESSION_START_FAILED: 'SESSION_START_FAILED',
      SESSION_RESUME_FAILED: 'SESSION_RESUME_FAILED',
      SESSION_ENDED: 'SESSION_ENDED'
    },
    CastContextEventType: {
      SESSION_STATE_CHANGED: 'SESSION_STATE_CHANGED',
      CAST_STATE_CHANGED: 'CAST_STATE_CHANGED'
    },
    RemotePlayerEventType: {
      IS_CONNECTED_CHANGED: 'IS_CONNECTED_CHANGED',
      PLAYER_STATE_CHANGED: 'PLAYER_STATE_CHANGED',
      MEDIA_INFO_CHANGED: 'MEDIA_INFO_CHANGED',
      CURRENT_TIME_CHANGED: 'CURRENT_TIME_CHANGED',
      VOLUME_LEVEL_CHANGED: 'VOLUME_LEVEL_CHANGED',
      IS_MUTED_CHANGED: 'IS_MUTED_CHANGED'
    },
    CastContext: { getInstance: () => castContext },
    RemotePlayer: class { constructor() { return remotePlayer; } },
    RemotePlayerController: class { constructor() { return controller; } }
  };
  const meta = {
    getAttribute(name) {
      return name === 'content' ? 'CUSTOM_RECEIVER' : name === 'data-allow-production' ? 'true' : null;
    }
  };
  const body = { classList: createClassList() };
  const document = Object.assign(createEventTarget(), {
    body,
    getElementById(id) {
      if (id === 'current-track-cast') return button;
      if (id === 'play-btn') return playButton;
      if (id === 'audio') return audio;
      return null;
    },
    querySelector(selector) {
      return selector === 'meta[name="cast-app-id"]' ? meta : null;
    }
  });
  const { context } = await createSandbox({
    document,
    elements: { audio, currentTrackCast: button, playBtn: playButton },
    state: { currentTrack: { url: audio.src, title: 'Current song', creator: 'Artist' } },
    location: { href: 'https://resonate.test/', hostname: 'resonate.test', protocol: 'https:', search: '' },
    navigator: { userAgent: 'Chrome', vendor: 'Google Inc.' },
    cast: { framework: castFramework },
    chrome: {
      cast: {
        AutoJoinPolicy: { ORIGINAL_URL: 'ORIGINAL_URL' },
        media: {
          DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
          MediaInfo,
          LoadRequest,
          MusicTrackMediaMetadata,
          SeekRequest,
          StreamType: { BUFFERED: 'BUFFERED' }
        },
        Image: class Image { constructor(url) { this.url = url; } }
      }
    },
    setInterval: () => 1,
    clearInterval() {},
    applyCastButtonState() {},
    setMainPlayButtonState(playing) { context.playingState = playing; }
  });

  await evaluateScript(context, 'js/cast.js');
  const manager = context.CastManager;
  assert.equal(castContext.options.receiverApplicationId, 'CUSTOM_RECEIVER');
  assert.equal(castContext.options.autoJoinPolicy, 'ORIGINAL_URL');
  assert.equal(manager.getCastButtonState(), 'NO_DEVICES_AVAILABLE');

  castContext.castState = 'CONNECTED';
  castContext.dispatchEvent({ type: 'CAST_STATE_CHANGED' });
  assert.equal(manager.getCastButtonState(), 'NOT_CONNECTED');

  castContext.castState = 'NO_DEVICES_AVAILABLE';
  castContext.dispatchEvent({ type: 'CAST_STATE_CHANGED' });
  assert.equal(manager.getCastButtonState(), 'NO_DEVICES_AVAILABLE');

  castContext.sessionState = 'SESSION_STARTING';
  castContext.castState = 'CONNECTING';
  castContext.dispatchEvent({ type: 'SESSION_STATE_CHANGED', sessionState: 'SESSION_STARTING' });
  assert.equal(manager.getCastButtonState(), 'CONNECTING');

  castContext.sessionState = 'SESSION_STARTED';
  castContext.castState = 'CONNECTED';
  castContext.dispatchEvent({ type: 'SESSION_STATE_CHANGED', sessionState: 'SESSION_STARTED' });
  await manager.loadMediaFromTrack({
    url: audio.src,
    title: 'Current song',
    creator: 'Artist',
    albumTitle: 'Album',
    trackIndex: 1,
    totalTracks: 9,
    coverArt: 'https://archive.org/cover.jpg'
  }, audio.src, 12, 180, { force: true });
  assert.equal(loadedMediaRequest.media.contentType, 'audio/mpeg');
  assert.equal(loadedMediaRequest.media.duration, 180);
  assert.equal(loadedMediaRequest.media.metadata.title, 'Current song');
  assert.equal(loadedMediaRequest.media.metadata.artist, 'Artist');
  assert.equal(loadedMediaRequest.media.metadata.albumName, 'Album');
  assert.equal(loadedMediaRequest.media.metadata.trackNumber, 2);
  assert.equal(loadedMediaRequest.media.metadata.totalTrackCount, 9);
  assert.equal(loadedMediaRequest.media.metadata.images[0].url, 'https://archive.org/cover.jpg');
  assert.equal(loadedMediaRequest.currentTime, 12);

  remotePlayer.isConnected = true;
  remotePlayer.isPaused = false;
  remotePlayer.currentTime = 42;
  controller.dispatchEvent({ type: 'IS_CONNECTED_CHANGED' });
  assert.equal(manager.getCastButtonState(), 'CONNECTED');
  assert.equal(audio.paused, true);
  assert.equal(context.playingState, true);
  remotePlayer.isPaused = true;
  controller.dispatchEvent({ type: 'PLAYER_STATE_CHANGED' });
  assert.equal(context.playingState, false);
  remotePlayer.isPaused = false;
  controller.dispatchEvent({ type: 'PLAYER_STATE_CHANGED' });
  assert.equal(context.playingState, true);
  remotePlayer.volumeLevel = 0.3;
  remotePlayer.isMuted = true;
  controller.dispatchEvent({ type: 'VOLUME_LEVEL_CHANGED' });
  assert.equal(audio.volume, 0.3);
  assert.equal(audio.muted, true);
  audio.volume = 0.45;
  audio.dispatchEvent({ type: 'volumechange' });
  assert.equal(remotePlayer.volumeLevel, 0.45);
  audio.currentTime = 50;
  audio.dispatchEvent({ type: 'seeked' });
  assert.equal(lastSeekRequest.currentTime, 50);

  // Wait for CAF's terminal session event rather than restoring local audio on a transient disconnect.
  remotePlayer.isConnected = false;
  controller.dispatchEvent({ type: 'IS_CONNECTED_CHANGED' });
  assert.equal(audio.playCalls, 0);
  castContext.sessionState = 'SESSION_ENDING';
  castContext.dispatchEvent({ type: 'SESSION_STATE_CHANGED', sessionState: 'SESSION_ENDING' });
  assert.equal(manager.getCastButtonState(), 'CONNECTED');
  castContext.sessionState = 'SESSION_ENDED';
  castContext.session = null;
  castContext.castState = 'CONNECTED';
  castContext.sessionState = 'SESSION_ENDED';
  castContext.dispatchEvent({ type: 'SESSION_STATE_CHANGED', sessionState: 'SESSION_ENDED' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(audio.currentTime, 42);
  assert.equal(audio.playCalls, 1);
  assert.equal(manager.getCastButtonState(), 'NOT_CONNECTED');
  assert.equal(mediaUpdateListeners.size, 0);

  // Initialization must reconcile a session that auto-joined before listeners were registered.
  audio.paused = true;
  castContext.session = session;
  castContext.sessionState = 'SESSION_RESUMED';
  castContext.castState = 'CONNECTED';
  remotePlayer.isConnected = true;
  remotePlayer.isPaused = false;
  manager.destroy();
  assert.equal(manager.init(), true);
  assert.equal(manager.getCastButtonState(), 'CONNECTED');
  assert.equal(mediaUpdateListeners.size, 1);
  manager.destroy();
});

async function runTests() {
  let failures = 0;
  for (const { name, run } of testCases) {
    try {
      await run();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`not ok - ${name}`);
      console.error(error);
    }
  }

  console.log(`${testCases.length - failures}/${testCases.length} player tests passed`);
  if (failures > 0) process.exitCode = 1;
}

runTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
