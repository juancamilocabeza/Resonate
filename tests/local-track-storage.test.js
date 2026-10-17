import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/local-track-storage.js', import.meta.url), 'utf8');

function createHarness({ quota = 1024, maxUsageRatio = 0.85 } = {}) {
  const tracks = new Map();
  const files = new Map();
  const workerInstances = [];

  class TestWorker {
    constructor(url) {
      this.url = url;
      workerInstances.push(this);
    }

    postMessage(message) {
      queueMicrotask(() => {
        try {
          const trackId = String(message.trackId);
          let result;
          switch (message.type) {
            case 'getTrack':
            case 'touchTrack':
              result = tracks.get(trackId) || null;
              if (message.type === 'touchTrack' && result) {
                result = { ...result, lastAccessed: Date.now() };
                tracks.set(trackId, result);
              }
              break;
            case 'saveTrack':
              tracks.set(message.track.id, message.track);
              result = message.track;
              break;
            case 'deleteTrack':
              result = tracks.delete(trackId);
              break;
            case 'listOldestTracks':
              result = [...tracks.values()]
                .filter(track => track.id !== message.excludeTrackId)
                .sort((left, right) => left.lastAccessed - right.lastAccessed);
              break;
            case 'searchTracks':
              result = [...tracks.values()].filter(track =>
                (!message.query.title || track.title.toLowerCase() === message.query.title.toLowerCase()) &&
                (!message.query.artist || track.artist.toLowerCase() === message.query.artist.toLowerCase())
              );
              break;
            default:
              throw new Error(`Unexpected operation: ${message.type}`);
          }
          this.onmessage({ data: { id: message.id, result } });
        } catch (error) {
          this.onmessage({
            data: { id: message.id, error: { name: error.name, message: error.message } }
          });
        }
      });
    }

    terminate() {}
  }

  const root = {
    async getFileHandle(path, options = {}) {
      if (!files.has(path) && !options.create) {
        throw new DOMException('Not found', 'NotFoundError');
      }
      if (!files.has(path)) files.set(path, new ArrayBuffer(0));
      return {
        async createWritable() {
          let value;
          return {
            async truncate() { value = new ArrayBuffer(0); },
            async write(buffer) { value = buffer.slice(0); },
            async close() { files.set(path, value); },
            async abort() {}
          };
        },
        async getFile() { return new Blob([files.get(path)]); }
      };
    },
    async removeEntry(path) {
      if (!files.delete(path)) throw new DOMException('Not found', 'NotFoundError');
    }
  };

  const context = {
    Worker: TestWorker,
    DOMException,
    Blob,
    ArrayBuffer,
    Date,
    Number,
    Map,
    Promise,
    Error,
    TypeError,
    RangeError,
    crypto: { randomUUID: () => `uuid-${files.size + 1}` },
    navigator: {
      storage: {
        async getDirectory() { return root; },
        async estimate() {
          return {
            usage: [...files.values()].reduce((sum, buffer) => sum + buffer.byteLength, 0),
            quota
          };
        }
      }
    }
  };
  context.self = context;
  vm.runInNewContext(source, context, { filename: 'js/local-track-storage.js' });
  return {
    storage: new context.LocalTrackStorage({ maxUsageRatio }),
    tracks,
    files,
    workerInstances
  };
}

{
  const harness = createHarness();
  const audio = new Uint8Array([1, 2, 3, 4]).buffer;
  const saved = await harness.storage.saveTrack({
    id: 'track-1',
    title: 'Example',
    artist: 'Artist',
    duration: 12
  }, audio);

  assert.equal(saved.opfsPath, 'track-uuid-1');
  assert.equal(saved.size, 4);
  assert.deepEqual([...new Uint8Array(harness.files.get(saved.opfsPath))], [1, 2, 3, 4]);

  const file = await harness.storage.getTrackStreamHandle('track-1');
  assert.ok(file instanceof Blob);
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [1, 2, 3, 4]);
  assert.deepEqual(await harness.storage.searchTracks({ artist: 'artist' }), [harness.tracks.get('track-1')]);
  assert.equal(harness.workerInstances[0].url, '/js/local-track-storage-worker.js');

  await harness.storage.saveTrack({
    id: 'track-1',
    title: 'Example updated',
    artist: 'Artist',
    duration: 8
  }, new Uint8Array([9]).buffer);
  const updated = harness.tracks.get('track-1');
  assert.notEqual(updated.opfsPath, saved.opfsPath);
  assert.equal(harness.files.has(saved.opfsPath), false);
  assert.deepEqual([...new Uint8Array(harness.files.get(updated.opfsPath))], [9]);
  harness.storage.close();
}

{
  const harness = createHarness({ quota: 10, maxUsageRatio: 0.8 });
  const oldTrack = {
    id: 'old',
    title: 'Old',
    artist: 'Artist',
    duration: 1,
    opfsPath: 'old-file',
    size: 6,
    lastAccessed: 1
  };
  harness.tracks.set(oldTrack.id, oldTrack);
  harness.files.set(oldTrack.opfsPath, new Uint8Array(6).buffer);

  await harness.storage.saveTrack({
    id: 'new',
    title: 'New',
    artist: 'Artist',
    duration: 2
  }, new Uint8Array(5).buffer);

  assert.equal(harness.tracks.has('old'), false);
  assert.equal(harness.files.has('old-file'), false);
  assert.equal(harness.files.size, 1);
  harness.storage.close();
}

console.log('Local track storage tests passed');
