import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8')
const handlers = new Map()
const storedCaches = new Map()
const requests = []

class MemoryCache {
  constructor () {
    this.entries = new Map()
  }

  key (request) {
    return typeof request === 'string' ? request : request.url
  }

  async match (request) {
    const response = this.entries.get(this.key(request))
    return response ? response.clone() : undefined
  }

  async put (request, response) {
    this.entries.set(this.key(request), response.clone())
  }

  async delete (request) {
    return this.entries.delete(this.key(request))
  }

  async keys () {
    return Array.from(this.entries.keys(), url => new Request(url))
  }
}

const caches = {
  async open (name) {
    if (!storedCaches.has(name)) storedCaches.set(name, new MemoryCache())
    return storedCaches.get(name)
  },
  async delete (name) {
    return storedCaches.delete(name)
  }
}
const self = {
  location: { protocol: 'http:', hostname: 'localhost', port: '3000', origin: 'https://app.test' },
  console,
  addEventListener: (type, listener) => handlers.set(type, listener),
  clients: { claim: async () => {} },
  skipWaiting: async () => {}
}
const fetch = async (request, options) => {
  requests.push({ request, options })
  const headers = options?.headers || request?.headers
  if (headers?.get?.('Range') || headers?.Range) {
    return new Response(new Uint8Array(256 * 1024), {
      status: 206,
      headers: {
        'Content-Range': 'bytes 0-262143/524288',
        'Content-Type': 'audio/mpeg'
      }
    })
  }
  return new Response(new Uint8Array(524288), {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' }
  })
}

vm.runInNewContext(source, {
  self,
  caches,
  fetch,
  URL,
  Headers,
  Response,
  Request,
  Promise,
  console
})

let pipelineResult
let waitUntilPromise
handlers.get('message')({
  data: {
    type: 'PRECACHE_AUDIO_PIPELINE',
    queueUrl: 'https://archive.org/queue.mp3',
    searchUrl: 'https://archive.org/search.mp3',
    maxBytes: 256 * 1024
  },
  source: { postMessage: message => { pipelineResult = message } },
  waitUntil: promise => { waitUntilPromise = promise }
})
await waitUntilPromise
assert.equal(pipelineResult.results.length, 2)
assert.equal((await (await caches.open('continuous-queue-v1')).match('https://archive.org/queue.mp3')).headers.get('Content-Length'), '262144')
assert.equal((await (await caches.open('search-precache-v1')).match('https://archive.org/search.mp3')).headers.get('X-Audio-Precache-Partial'), 'true')

let rangeResponsePromise
handlers.get('fetch')({
  request: new Request('https://archive.org/queue.mp3', {
    mode: 'no-cors',
    headers: { Range: 'bytes=0-5' }
  }),
  respondWith: promise => { rangeResponsePromise = promise },
  waitUntil: promise => { waitUntilPromise = promise }
})
const rangeResponse = await rangeResponsePromise
assert.equal(rangeResponse.status, 206)
assert.equal(rangeResponse.headers.get('Content-Range'), 'bytes 0-5/524288')
assert.equal(rangeResponse.headers.get('Content-Length'), '6')
assert.equal((await rangeResponse.arrayBuffer()).byteLength, 6)
assert.equal(requests.length, 2)

let fullResponsePromise
handlers.get('fetch')({
  request: new Request('https://archive.org/queue.mp3', { mode: 'no-cors' }),
  respondWith: promise => { fullResponsePromise = promise },
  waitUntil: promise => { waitUntilPromise = promise }
})
const fullResponse = await fullResponsePromise
assert.equal(fullResponse.status, 200)
assert.equal((await fullResponse.arrayBuffer()).byteLength, 524288)
assert.equal(requests.length, 3)

console.log('Service worker audio cache tests passed')
