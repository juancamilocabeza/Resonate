const DEFAULT_WORKER_URL = '/js/search-worker.js'

export class SearchClient {
  constructor (options = {}) {
    const WorkerConstructor = options.Worker || globalThis.Worker
    if (typeof WorkerConstructor !== 'function' && typeof options.workerFactory !== 'function') {
      throw new Error('SearchClient requires Web Worker support')
    }

    const workerUrl = options.workerUrl || DEFAULT_WORKER_URL
    this.worker = options.workerFactory
      ? options.workerFactory(workerUrl)
      : new WorkerConstructor(workerUrl)
    this.pending = new Map()
    this.nextRequestId = 1
    this.closed = false

    this.worker.onmessage = event => this.handleMessage(event.data)
    this.worker.onerror = event => {
      const error = new Error(event.message || 'Search worker failed')
      this.rejectPending(error)
    }
    this.worker.onmessageerror = () => {
      this.rejectPending(new Error('Unable to read a message from the search worker'))
    }
  }

  handleMessage (message) {
    const pending = this.pending.get(message && message.id)
    if (!pending) return

    this.pending.delete(message.id)
    if (message.type === 'ERROR') {
      const error = new Error(message.error && message.error.message
        ? message.error.message
        : 'Search worker request failed')
      error.name = (message.error && message.error.name) || 'Error'
      pending.reject(error)
    } else {
      pending.resolve(message)
    }
  }

  rejectPending (error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  send (type, payload = {}) {
    if (this.closed) return Promise.reject(new Error('SearchClient has been unloaded'))

    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.worker.postMessage({ id, type, ...payload })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async indexData (data) {
    if (!Array.isArray(data) && (!data || !Array.isArray(data.tracks))) {
      throw new TypeError('indexData expects an array of tracks')
    }

    const response = await this.send('INDEX_DATA', { data })
    return response.count
  }

  async query (query) {
    if (typeof query !== 'string') {
      throw new TypeError('query expects a string')
    }

    const response = await this.send('QUERY', { query })
    return response.results
  }

  unload () {
    if (this.closed) return
    this.closed = true
    this.rejectPending(new Error('SearchClient has been unloaded'))
    this.worker.terminate()
  }
}

export default SearchClient
