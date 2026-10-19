import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { SearchClient } from '../js/search-client.js'

const workerSource = await readFile(new URL('../js/search-worker.js', import.meta.url), 'utf8')

function createWorkerHarness () {
  const records = new Map()
  const listeners = new Map()
  const responses = []

  function makeStore () {
    return {
      indexNames: { contains: () => false },
      createIndex () {},
      clear () {
        records.clear()
      },
      put (record) {
        records.set(record.id, record)
      },
      getAll () {
        const request = {}
        queueMicrotask(() => {
          request.result = [...records.values()]
          request.onsuccess()
        })
        return request
      }
    }
  }

  const store = makeStore()
  const database = {
    objectStoreNames: { contains: name => name === 'tracks' },
    transaction () {
      const transaction = {
        objectStore: () => store
      }
      queueMicrotask(() => transaction.oncomplete?.())
      return transaction
    }
  }

  const indexedDB = {
    open () {
      const request = {}
      queueMicrotask(() => {
        request.result = database
        request.transaction = { objectStore: () => store }
        request.onupgradeneeded?.()
        request.onsuccess()
      })
      return request
    }
  }

  const scope = {
    indexedDB,
    addEventListener (name, callback) {
      listeners.set(name, callback)
    },
    postMessage (message) {
      responses.push(message)
    }
  }
  vm.runInNewContext(workerSource, { self: scope, indexedDB, Map, Promise, Error, TypeError, String }, {
    filename: 'js/search-worker.js'
  })

  return {
    records,
    responses,
    async dispatch (message) {
      listeners.get('message')({ data: message })
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 0))
        const response = responses.find(item => item.id === message.id)
        if (response) return response
      }
      throw new Error(`Worker did not respond to ${message.type}`)
    }
  }
}

{
  const harness = createWorkerHarness()
  const indexed = await harness.dispatch({
    id: 1,
    type: 'INDEX_DATA',
    data: [
      { identifier: 'one', title: 'Beyoncé Live', creator: 'The Artist' },
      { id: 'two', title: 'Blue Morning', artist: 'Beyonce Band' },
      { id: 'three', title: 'Another Track', artist: 'Other Artist' }
    ]
  })
  assert.equal(indexed.type, 'INDEXED')
  assert.equal(indexed.count, 3)
  assert.equal(harness.records.get('one').artist, 'The Artist')

  const matches = await harness.dispatch({ id: 2, type: 'QUERY', query: 'beyonce' })
  assert.equal(matches.type, 'RESULTS')
  assert.deepEqual(Array.from(matches.results, track => track.id), ['one', 'two'])
  assert.equal(matches.results[0].score, 5)

  const noMatches = await harness.dispatch({ id: 3, type: 'QUERY', query: 'unmatched' })
  assert.equal(noMatches.results.length, 0)

  const invalid = await harness.dispatch({ id: 4, type: 'INDEX_DATA', data: null })
  assert.equal(invalid.type, 'ERROR')
  assert.equal(invalid.error.name, 'TypeError')

  const largeCatalog = Array.from({ length: 35 }, (_, index) => ({
    id: `match-${index}`,
    title: `Match ${index}`,
    artist: 'Search Artist'
  }))
  await harness.dispatch({ id: 5, type: 'INDEX_DATA', data: largeCatalog })
  const limited = await harness.dispatch({ id: 6, type: 'QUERY', query: 'match' })
  assert.equal(limited.results.length, 30)
}

{
  const messages = []
  let worker
  class TestWorker {
    constructor (url) {
      this.url = url
      worker = this
    }

    postMessage (message) {
      messages.push(message)
      queueMicrotask(() => {
        if (message.type === 'INDEX_DATA') {
          this.onmessage({ data: { id: message.id, type: 'INDEXED', count: message.data.length } })
        } else {
          this.onmessage({ data: { id: message.id, type: 'RESULTS', results: [{ title: message.query }] } })
        }
      })
    }

    terminate () {
      this.terminated = true
    }
  }

  const client = new SearchClient({ Worker: TestWorker })
  assert.equal(worker.url, '/js/search-worker.js')
  assert.equal(await client.indexData([{ title: 'Local result', artist: 'Local artist' }]), 1)
  assert.deepEqual(await client.query('local'), [{ title: 'local' }])
  assert.equal(messages[0].type, 'INDEX_DATA')
  assert.equal(messages[1].type, 'QUERY')

  client.unload()
  assert.equal(worker.terminated, true)
  await assert.rejects(client.query('closed'), /unloaded/)
}

console.log('Search worker tests passed')
