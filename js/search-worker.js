const DATABASE_NAME = 'ResonateSearchIndex'
const DATABASE_VERSION = 1
const TRACK_STORE = 'tracks'
const RESULT_LIMIT = 30

let databasePromise

function openDatabase () {
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(TRACK_STORE)) {
        database.createObjectStore(TRACK_STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => {
      databasePromise = request.result
      resolve(databasePromise)
    }
    request.onerror = () => {
      databasePromise = null
      reject(request.error || new Error('Unable to open the search index'))
    }
    request.onblocked = () => {
      databasePromise = null
      reject(new Error('Search index upgrade is blocked by another tab'))
    }
  })

  return databasePromise
}

function normalizeText (value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim()
}

function normalizeTrack (track, index) {
  if (!track || typeof track !== 'object') return null

  const title = typeof track.title === 'string' ? track.title.trim() : ''
  const artist = typeof track.artist === 'string'
    ? track.artist.trim()
    : (typeof track.creator === 'string' ? track.creator.trim() : '')
  const idValue = track.id ?? track.identifier ?? `track-${index}`
  const id = String(idValue).trim()
  if (!id || (!title && !artist)) return null

  return {
    ...track,
    id,
    title,
    artist,
    titleKey: normalizeText(title),
    artistKey: normalizeText(artist)
  }
}

async function indexData (data) {
  const tracks = Array.isArray(data)
    ? data
    : (data && Array.isArray(data.tracks) ? data.tracks : null)
  if (!tracks) throw new TypeError('INDEX_DATA expects an array of tracks')

  const records = tracks.map(normalizeTrack).filter(Boolean)
  const database = await openDatabase()

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(TRACK_STORE, 'readwrite')
    const store = transaction.objectStore(TRACK_STORE)
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error || new Error('Unable to write the search index'))
    transaction.onabort = () => reject(transaction.error || new Error('Search index write was aborted'))
    store.clear()
    records.forEach(record => store.put(record))
  })

  return records.length
}

function scoreMatch (record, query) {
  const titleMatch = record.titleKey.includes(query)
  const artistMatch = record.artistKey.includes(query)
  if (!titleMatch && !artistMatch) return -1

  let score = 1
  if (record.titleKey.startsWith(query)) score += 4
  if (record.artistKey.startsWith(query)) score += 3
  if (record.titleKey === query) score += 2
  if (record.artistKey === query) score += 1
  return score
}

async function queryTracks (queryValue) {
  const query = normalizeText(queryValue)
  if (!query) return []

  const database = await openDatabase()
  const records = await new Promise((resolve, reject) => {
    const transaction = database.transaction(TRACK_STORE, 'readonly')
    const request = transaction.objectStore(TRACK_STORE).getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error || new Error('Unable to read the search index'))
    transaction.onerror = () => reject(transaction.error || new Error('Search index read failed'))
  })

  return records
    .map(record => ({ record, score: scoreMatch(record, query) }))
    .filter(match => match.score >= 0)
    .sort((left, right) => right.score - left.score || left.record.titleKey.localeCompare(right.record.titleKey))
    .slice(0, RESULT_LIMIT)
    .map(({ record, score }) => {
      const { titleKey, artistKey, ...track } = record
      return { ...track, score }
    })
}

async function handleMessage (message) {
  switch (message.type) {
    case 'INDEX_DATA':
      return {
        type: 'INDEXED',
        count: await indexData(message.data)
      }
    case 'QUERY':
      return {
        type: 'RESULTS',
        results: await queryTracks(message.query)
      }
    default:
      throw new TypeError(`Unknown search worker message type: ${message.type}`)
  }
}

self.addEventListener('message', event => {
  const message = event.data || {}
  handleMessage(message).then(
    result => self.postMessage({ id: message.id, ...result }),
    error => self.postMessage({
      id: message.id,
      type: 'ERROR',
      error: {
        name: error.name || 'Error',
        message: error.message || String(error)
      }
    })
  )
})
