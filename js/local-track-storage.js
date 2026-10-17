// OPFS-backed audio storage with an IndexedDB metadata index in a dedicated worker.
(function exposeLocalTrackStorage(global) {
  const DEFAULT_MAX_USAGE_RATIO = 0.85;
  const DEFAULT_WORKER_URL = '/js/local-track-storage-worker.js';

  class LocalTrackStorage {
    constructor(options = {}) {
      this.maxUsageRatio = options.maxUsageRatio ?? DEFAULT_MAX_USAGE_RATIO;
      if (!Number.isFinite(this.maxUsageRatio) ||
          this.maxUsageRatio <= 0 ||
          this.maxUsageRatio > 1) {
        throw new RangeError('maxUsageRatio must be greater than 0 and no greater than 1');
      }
      if (typeof global.Worker !== 'function') {
        throw new Error('LocalTrackStorage requires Web Worker support');
      }

      const workerUrl = options.workerUrl || DEFAULT_WORKER_URL;
      this.worker = options.workerFactory
        ? options.workerFactory(workerUrl)
        : new global.Worker(workerUrl);
      this.pending = new Map();
      this.nextRequestId = 1;
      this.operationQueue = Promise.resolve();

      this.worker.onmessage = event => this.handleWorkerMessage(event.data);
      this.worker.onerror = event => {
        const error = new Error(event.message || 'Local track database worker failed');
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
      };
    }

    handleWorkerMessage(message) {
      const pending = this.pending.get(message && message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message || 'Local track database operation failed');
        error.name = message.error.name || 'Error';
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
    }

    requestWorker(type, payload = {}) {
      const id = this.nextRequestId++;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        try {
          this.worker.postMessage({ id, type, ...payload });
        } catch (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    }

    serialize(operation) {
      const result = this.operationQueue.then(operation);
      this.operationQueue = result.catch(() => {});
      return result;
    }

    async getRootDirectory() {
      if (!global.navigator || !global.navigator.storage ||
          typeof global.navigator.storage.getDirectory !== 'function') {
        throw new Error('Origin Private File System is not available in this browser');
      }
      return global.navigator.storage.getDirectory();
    }

    async getStorageEstimate() {
      if (!global.navigator || !global.navigator.storage ||
          typeof global.navigator.storage.estimate !== 'function') {
        throw new Error('Storage quota estimates are not available in this browser');
      }
      return global.navigator.storage.estimate();
    }

    async removeTrackFile(track) {
      const root = await this.getRootDirectory();
      try {
        await root.removeEntry(track.opfsPath);
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
      }
      await this.requestWorker('deleteTrack', { trackId: track.id });
      return Number(track.size) || 0;
    }

    async clearCache(options = {}) {
      const maxUsageRatio = options.maxUsageRatio ?? this.maxUsageRatio;
      const requiredBytes = options.requiredBytes ?? 0;
      if (!Number.isFinite(maxUsageRatio) || maxUsageRatio < 0 || maxUsageRatio > 1) {
        throw new RangeError('maxUsageRatio must be between 0 and 1');
      }
      if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) {
        throw new RangeError('requiredBytes must be a non-negative safe integer');
      }

      const estimate = await this.getStorageEstimate();
      if (!Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) {
        throw new Error('Browser did not provide a valid storage quota estimate');
      }
      const targetUsage = estimate.quota * maxUsageRatio - requiredBytes;
      let remainingUsage = estimate.usage;
      let deletedBytes = 0;
      let deletedTracks = 0;
      const candidates = await this.requestWorker('listOldestTracks', {
        excludeTrackId: options.excludeTrackId || null
      });

      while (remainingUsage > targetUsage) {
        const candidate = candidates.shift();
        if (!candidate) {
          if (requiredBytes > 0) {
            throw new DOMException('Not enough storage quota available for this track', 'QuotaExceededError');
          }
          break;
        }

        const size = await this.removeTrackFile(candidate);
        deletedBytes += size;
        deletedTracks += 1;
        remainingUsage = Math.max(0, remainingUsage - size);
      }

      return { deletedBytes, deletedTracks, usage: remainingUsage, quota: estimate.quota };
    }

    saveTrack(metadata, arrayBuffer) {
      return this.serialize(async () => {
        if (!metadata || metadata.id === undefined || metadata.id === null ||
            !String(metadata.id).trim()) {
          throw new TypeError('Track metadata must include a non-empty id');
        }
        if (!(arrayBuffer instanceof ArrayBuffer)) {
          throw new TypeError('Audio data must be an ArrayBuffer');
        }
        if (typeof metadata.title !== 'string' || typeof metadata.artist !== 'string' ||
            !Number.isFinite(metadata.duration) || metadata.duration < 0) {
          throw new TypeError('Track metadata must include title, artist, and a non-negative duration');
        }

        const id = String(metadata.id);
        const previous = await this.requestWorker('getTrack', { trackId: id });
        await this.clearCache({
          requiredBytes: Math.max(0, arrayBuffer.byteLength - (Number(previous && previous.size) || 0)),
          excludeTrackId: id
        });
        const opfsPath = `track-${global.crypto.randomUUID()}`;
        const root = await this.getRootDirectory();
        const fileHandle = await root.getFileHandle(opfsPath, { create: true });
        const writable = await fileHandle.createWritable();
        let savedTrack;

        try {
          await writable.truncate(0);
          await writable.write(arrayBuffer);
          await writable.close();
          savedTrack = await this.requestWorker('saveTrack', {
            track: {
              id,
              title: metadata.title,
              artist: metadata.artist,
              duration: metadata.duration,
              opfsPath,
              size: arrayBuffer.byteLength,
              lastAccessed: Date.now()
            }
          });
        } catch (error) {
          try { await writable.abort(); } catch {}
          try { await root.removeEntry(opfsPath); } catch (cleanupError) {
            if (cleanupError.name !== 'NotFoundError') {
              console.warn('LocalTrackStorage: failed to remove incomplete audio file', cleanupError);
            }
          }
          throw error;
        }

        if (previous) {
          try {
            await root.removeEntry(previous.opfsPath);
          } catch (error) {
            if (error.name !== 'NotFoundError') {
              console.warn('LocalTrackStorage: failed to remove replaced audio file', error);
            }
          }
        }
        return savedTrack;
      });
    }

    getTrackStreamHandle(trackId) {
      return this.serialize(async () => {
        const track = await this.requestWorker('touchTrack', { trackId: String(trackId) });
        if (!track) return null;
        const root = await this.getRootDirectory();
        const handle = await root.getFileHandle(track.opfsPath);
        return handle.getFile();
      });
    }

    getTrackMetadata(trackId) {
      return this.requestWorker('getTrack', { trackId: String(trackId) });
    }

    searchTracks(query = {}) {
      return this.requestWorker('searchTracks', { query });
    }

    close() {
      this.worker.terminate();
      const error = new Error('LocalTrackStorage has been closed');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    }
  }

  global.LocalTrackStorage = LocalTrackStorage;
})(typeof self !== 'undefined' ? self : globalThis);
