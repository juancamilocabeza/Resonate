import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../js/PlayerStatusViews.js', import.meta.url), 'utf8')
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')

assert.match(html, /id="queue-empty-view" role="status" aria-live="polite"/)
assert.match(html, /id="playback-error-view" role="alert" aria-live="assertive"/)
assert.match(html, /Tu cola está en silencio/)
assert.match(html, /Explora la búsqueda para descubrir música independiente/)

function createHarness (online = true) {
  const elements = new Map()
  const windowListeners = new Map()
  const announcements = []
  const search = { focusCalls: 0, focus () { this.focusCalls += 1 } }
  const libraryButton = { clicks: 0, click () { this.clicks += 1 } }
  const queueView = { hidden: true }
  const errorView = {
    hidden: true,
    attributes: {},
    setAttribute (name, value) { this.attributes[name] = value }
  }
  const playerContent = { hidden: false }
  const errorTitle = { textContent: '' }
  const errorMessage = { textContent: '' }
  const errorPrimary = {
    textContent: '',
    onclick: null,
    click () { if (this.onclick) this.onclick() }
  }
  const searchButton = {
    listeners: new Map(),
    addEventListener (name, callback) { this.listeners.set(name, callback) },
    click () { this.listeners.get('click')() }
  }
  const errorSearchButton = {
    listeners: new Map(),
    addEventListener (name, callback) { this.listeners.set(name, callback) },
    click () { this.listeners.get('click')() }
  }

  elements.set('queue-empty-view', queueView)
  elements.set('playback-error-view', errorView)
  elements.set('playback-error-title', errorTitle)
  elements.set('playback-error-message', errorMessage)
  elements.set('playback-error-primary', errorPrimary)
  elements.set('player-content', playerContent)
  elements.set('queue-empty-search', searchButton)
  elements.set('playback-error-search', errorSearchButton)
  elements.set('search-input', search)
  elements.set('header-resontes-btn', libraryButton)

  const context = {
    document: { getElementById: id => elements.get(id) || null },
    navigator: { onLine: online },
    state: { playbackQueue: [], currentTrack: null },
    elements: { audio: { paused: true, src: '' } },
    addEventListener (type, callback) { windowListeners.set(type, callback) },
    A11yAnnouncer: {
      announce (message, priority) { announcements.push({ message, priority }) }
    }
  }
  context.window = context
  vm.runInNewContext(source, context, { filename: 'js/PlayerStatusViews.js' })

  return {
    context,
    errorMessage,
    errorPrimary,
    errorTitle,
    errorView,
    libraryButton,
    playerContent,
    queueView,
    search,
    searchButton,
    errorSearchButton,
    announcements,
    windowListeners
  }
}

{
  const harness = createHarness()
  harness.context.PlayerStatusViews.updateQueueEmpty()
  assert.equal(harness.queueView.hidden, false)
  assert.equal(harness.playerContent.hidden, true)
  harness.searchButton.click()
  assert.equal(harness.search.focusCalls, 1)

  harness.context.state.currentTrack = { url: 'https://archive.org/track.mp3' }
  harness.context.PlayerStatusViews.updateQueueEmpty()
  assert.equal(harness.queueView.hidden, true)
  assert.equal(harness.playerContent.hidden, false)
}

{
  const harness = createHarness(false)
  harness.context.PlayerStatusViews.showNetworkError()
  assert.equal(harness.errorView.hidden, false)
  assert.equal(harness.errorView.attributes.role, 'alert')
  assert.match(harness.errorTitle.textContent, /Sin conexión a Internet/)
  assert.match(harness.errorMessage.textContent, /canciones guardadas sin conexión/)
  assert.match(harness.errorPrimary.textContent, /Abrir mi biblioteca/)
  harness.errorPrimary.click()
  assert.equal(harness.libraryButton.clicks, 1)
  assert.equal(harness.announcements.length, 0)
}

{
  const harness = createHarness()
  let retries = 0
  harness.context.state.currentTrack = { url: 'https://archive.org/track.mp3', id: 'track' }
  harness.context.playAudioTrackOptimized = async () => { retries += 1 }
  harness.context.PlayerStatusViews.showStreamingError({ code: 3 })
  assert.match(harness.errorMessage.textContent, /archivo no se puede reproducir/)
  harness.errorPrimary.click()
  await Promise.resolve()
  assert.equal(retries, 1)
  assert.equal(harness.errorView.attributes['aria-live'], 'assertive')
  harness.errorSearchButton.click()
  assert.equal(harness.search.focusCalls, 1)
}

{
  const harness = createHarness()
  harness.context.PlayerStatusViews.announce('La pista está lista.')
  assert.deepEqual(harness.announcements[0], {
    message: 'La pista está lista.',
    priority: 'polite'
  })
}

console.log('Player status view tests passed')
