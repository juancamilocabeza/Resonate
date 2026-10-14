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

  return { context, audio, playButton, state };
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

test('Speculative Archive.org audio prefetch leaves playback to native streaming', async () => {
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
  assert.deepEqual(requestedUrls, ['https://archive.org/download/item/track.mp3']);
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

test('Service worker does not intercept Archive.org audio streaming requests', async () => {
  const listeners = new Map();
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
    console: serviceWorkerConsole,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    }
  };
  const { context } = await createSandbox({
    self: serviceWorker,
    console: serviceWorkerConsole,
    caches: {}
  });
  await evaluateScript(context, 'sw.js');

  const fetchHandler = listeners.get('fetch');
  for (const request of [
    {
      url: 'https://archive.org/download/item/track.mp3',
      method: 'GET',
      destination: 'audio',
      headers: { has: () => false }
    },
    {
      url: 'https://archive.org/download/item/track.mp3',
      method: 'GET',
      destination: '',
      headers: { has: () => false }
    }
  ]) {
    let intercepted = false;
    fetchHandler({
      request,
      respondWith() {
        intercepted = true;
      }
    });
    assert.equal(intercepted, false);
  }
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
  const currentTime = { textContent: '', offsetWidth: 0 };
  context.elements.progressBar = progressBar;
  context.elements.progress = progress;
  context.elements.currentTime = currentTime;
  context.elements.totalTime = { textContent: '', offsetWidth: 0 };
  context.setupProgressBarInteraction();

  progressBar.dispatchEvent({ type: 'click', clientX: 25 });

  assert.equal(audio.currentTime, 30);
  assert.equal(progress.style.width, '25%');
  assert.equal(attributes['aria-valuenow'], 25);
  assert.equal(attributes['aria-valuetext'], '0:30 de 2:00');
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
  const { context, state } = await createPlayer();
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

  context.toggleShuffleFavorites();
  assert.equal(state.shuffleFavorites, false);
  assert.equal(context.playbackStateManager.getShuffleMode(), false);
  assert.equal(shuffleButton.classList.contains('active'), false);
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

test('Theme cycling follows Day, Night, Eco and persists each user choice', async () => {
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
  const { context, localStorage } = await createSandbox({
    document,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: true, addEventListener() {} })
  });
  await evaluateScript(context, 'js/theme.js');
  document.dispatchEvent({ type: 'DOMContentLoaded' });

  assert.equal(context.ThemeManager.getCurrentTheme(), 'night');
  themeToggle.dispatchEvent({ type: 'click' });
  assert.equal(root.getAttribute('data-theme'), 'energy-saver');
  assert.equal(localStorage.getItem('resonate-theme'), 'energy-saver');
  themeToggle.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(root.getAttribute('data-theme'), 'day');
  assert.equal(themeToggle.dataset.theme, 'day');
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
