// Purposeful empty and playback-error views for the active player.
(() => {
  const queueView = document.getElementById('queue-empty-view')
  const errorView = document.getElementById('playback-error-view')
  const errorTitle = document.getElementById('playback-error-title')
  const errorMessage = document.getElementById('playback-error-message')
  const errorPrimary = document.getElementById('playback-error-primary')
  const playerContent = document.getElementById('player-content')
  const activeError = { type: null }

  function showQueueEmpty () {
    if (!queueView || !playerContent) return
    activeError.type = null
    errorView.hidden = true
    queueView.hidden = false
    playerContent.hidden = true
  }

  function updateQueueEmpty () {
    const state = window.state || {}
    const audio = window.elements && window.elements.audio
    const hasCurrentTrack = Boolean(
      (state.currentTrack && (state.currentTrack.url || state.currentTrack.id)) ||
      (state.savedPlaybackState && state.savedPlaybackState.track &&
        (state.savedPlaybackState.track.url || state.savedPlaybackState.track.id)) ||
      (audio && audio.src)
    )
    const queue = Array.isArray(state.playbackQueue) ? state.playbackQueue : []

    if (activeError.type) return
    if (!hasCurrentTrack && queue.length === 0) showQueueEmpty()
    else clear()
  }

  function showError (type, title, message, actionLabel, action) {
    if (!errorView || !playerContent) return

    activeError.type = type
    queueView.hidden = true
    errorView.hidden = false
    playerContent.hidden = Boolean(!(window.state && window.state.currentTrack))
    errorView.setAttribute('role', 'alert')
    errorView.setAttribute('aria-live', 'assertive')
    errorTitle.textContent = title
    errorMessage.textContent = message
    errorPrimary.textContent = actionLabel
    errorPrimary.onclick = action
  }

  function openLibrary () {
    const button = document.getElementById('header-resontes-btn')
    if (button) button.click()
  }

  function focusSearch () {
    const search = document.getElementById('search-input')
    if (search) search.focus()
  }

  function showNetworkError () {
    showError(
      'network',
      'Sin conexión a Internet',
      'Escucha las canciones guardadas sin conexión en tu biblioteca.',
      'Abrir mi biblioteca sin conexión',
      openLibrary
    )
  }

  function showStreamingError (mediaError) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      showNetworkError()
      return
    }

    const code = mediaError && mediaError.code
    let message = 'Comprueba tu conexión e inténtalo de nuevo, o busca otra pista.'
    if (code === 3) {
      message = 'El archivo no se puede reproducir. Busca otra pista o vuelve a intentarlo.'
    } else if (code === 4) {
      message = 'La fuente de audio no está disponible. Busca otra pista para seguir escuchando.'
    } else if (code === 2) {
      message = 'La conexión se interrumpió durante la reproducción. Comprueba tu red e inténtalo de nuevo.'
    }

    showError(
      'stream',
      'No se pudo reproducir esta pista',
      message,
      'Volver a intentar',
      retryCurrentTrack
    )
  }

  function retryCurrentTrack () {
    const state = window.state || {}
    const track = state.currentTrack
    if (!track || !track.url) {
      focusSearch()
      return
    }

    const retry = window.playAudioTrackOptimized
    if (typeof retry !== 'function') {
      window.logger?.error('Playback retry is unavailable', 'PLAYBACK')
      return
    }

    Promise.resolve(retry(track, track.id, track.trackIndex, track.totalTracks))
      .catch(error => {
        window.logger?.error({ message: 'Playback retry failed', error }, 'PLAYBACK')
      })
  }

  function clear () {
    activeError.type = null
    if (queueView) queueView.hidden = true
    if (errorView) errorView.hidden = true
    if (playerContent) playerContent.hidden = false
  }

  function announce (message, priority = 'polite') {
    if (window.A11yAnnouncer && typeof window.A11yAnnouncer.announce === 'function') {
      window.A11yAnnouncer.announce(message, priority)
    }
  }

  const searchButton = document.getElementById('queue-empty-search')
  const errorSearchButton = document.getElementById('playback-error-search')
  if (searchButton) searchButton.addEventListener('click', focusSearch)
  if (errorSearchButton) errorSearchButton.addEventListener('click', focusSearch)

  window.addEventListener('online', () => {
    if (activeError.type === 'network') {
      clear()
      updateQueueEmpty()
    }
  })

  window.addEventListener('offline', () => {
    const audio = window.elements && window.elements.audio
    if (!audio || audio.paused) {
      showNetworkError()
      return
    }

    announce(
      'Sin conexión a Internet. La pista actual seguirá reproduciéndose mientras esté disponible.',
      'polite'
    )
  })

  window.PlayerStatusViews = {
    announce,
    clear,
    showNetworkError,
    showQueueEmpty,
    showStreamingError,
    updateQueueEmpty
  }
})()
