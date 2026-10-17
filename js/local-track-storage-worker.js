const DATABASE_NAME = 'ResonateLocalTracks';
const DATABASE_VERSION = 1;
const TRACK_STORE = 'tracks';

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(TRACK_STORE)
        ? request.transaction.objectStore(TRACK_STORE)
        : database.createObjectStore(TRACK_STORE, { keyPath: 'id' });
      if (!store.indexNames.contains('titleKey')) {
        store.createIndex('titleKey', 'titleKey', { unique: false });
      }
      if (!store.indexNames.contains('artistKey')) {
        store.createIndex('artistKey', 'artistKey', { unique: false });
      }
      if (!store.indexNames.contains('duration')) {
        store.createIndex('duration', 'duration', { unique: false });
      }
      if (!store.indexNames.contains('lastAccessed')) {
        store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error('Unable to open local track database'));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error('Local track database upgrade is blocked by another tab'));
    };
  });
  return databasePromise;
}

function transactionRequest(database, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(TRACK_STORE, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('Local track transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('Local track transaction was aborted'));
    try {
      result = operation(transaction.objectStore(TRACK_STORE));
    } catch (error) {
      try { transaction.abort(); } catch {}
      reject(error);
    }
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local track database request failed'));
  });
}

async function getTrack(database, trackId) {
  return transactionRequest(database, 'readonly', store =>
    requestResult(store.get(String(trackId)))
  );
}

async function saveTrack(database, track) {
  const record = {
    ...track,
    titleKey: track.title.trim().toLocaleLowerCase(),
    artistKey: track.artist.trim().toLocaleLowerCase()
  };
  await transactionRequest(database, 'readwrite', store =>
    requestResult(store.put(record))
  );
  return {
    id: record.id,
    title: record.title,
    artist: record.artist,
    duration: record.duration,
    opfsPath: record.opfsPath,
    size: record.size,
    lastAccessed: record.lastAccessed
  };
}

async function touchTrack(database, trackId) {
  return transactionRequest(database, 'readwrite', store => {
    const request = store.get(String(trackId));
    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error || new Error('Unable to read track metadata'));
      request.onsuccess = () => {
        if (request.result) {
          request.result.lastAccessed = Date.now();
          store.put(request.result);
        }
        resolve(request.result || null);
      };
    });
  });
}

async function listOldestTracks(database, excludeTrackId) {
  return transactionRequest(database, 'readonly', store => {
    const request = store.index('lastAccessed').getAll();
    return requestResult(request).then(tracks =>
      tracks
        .filter(track => track.id !== excludeTrackId)
        .sort((left, right) => left.lastAccessed - right.lastAccessed)
        .map(track => ({
          id: track.id,
          opfsPath: track.opfsPath,
          size: track.size,
          lastAccessed: track.lastAccessed
        }))
    );
  });
}

async function deleteTrack(database, trackId) {
  await transactionRequest(database, 'readwrite', store =>
    requestResult(store.delete(String(trackId)))
  );
  return true;
}

async function searchTracks(database, query) {
  const title = typeof query.title === 'string' ? query.title.trim().toLocaleLowerCase() : '';
  const artist = typeof query.artist === 'string' ? query.artist.trim().toLocaleLowerCase() : '';
  const limit = Number.isSafeInteger(query.limit) && query.limit > 0
    ? Math.min(query.limit, 500)
    : 100;
  return transactionRequest(database, 'readonly', store => {
    const searches = [];
    if (title) searches.push(requestResult(store.index('titleKey').getAll(title)));
    if (artist) searches.push(requestResult(store.index('artistKey').getAll(artist)));
    if (!searches.length) searches.push(requestResult(store.getAll()));
    return Promise.all(searches).then(results => {
      let tracks = results[0];
      if (results.length > 1) {
        const artistIds = new Set(results[1].map(track => track.id));
        tracks = tracks.filter(track => artistIds.has(track.id));
      }
      return tracks.slice(0, limit).map(track => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        opfsPath: track.opfsPath,
        size: track.size,
        lastAccessed: track.lastAccessed
      }));
    });
  });
}

async function handleRequest(message) {
  const database = await openDatabase();
  switch (message.type) {
    case 'saveTrack':
      return saveTrack(database, message.track);
    case 'getTrack':
      return getTrack(database, message.trackId);
    case 'touchTrack':
      return touchTrack(database, message.trackId);
    case 'listOldestTracks':
      return listOldestTracks(database, message.excludeTrackId);
    case 'deleteTrack':
      return deleteTrack(database, message.trackId);
    case 'searchTracks':
      return searchTracks(database, message.query || {});
    default:
      throw new TypeError(`Unknown local track database operation: ${message.type}`);
  }
}

self.addEventListener('message', event => {
  const message = event.data || {};
  handleRequest(message).then(
    result => self.postMessage({ id: message.id, result }),
    error => self.postMessage({
      id: message.id,
      error: { name: error.name || 'Error', message: error.message || String(error) }
    })
  );
});
