import './ColorExtractor.js'
import { AudioVisualizer } from './AudioVisualizer.js'
import { QueueList } from './QueueList.js'

function formatTime (value) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function initialize () {
  const view = document.getElementById('expanded-player-view')
  const panel = view?.querySelector('.expanded-player__panel')
  const openButton = document.getElementById('player-expand-btn')
  const closeButton = document.getElementById('expanded-player-close')
  const art = document.getElementById('expanded-player-art')
  const title = document.getElementById('expanded-player-title')
  const artist = document.getElementById('expanded-player-artist')
  const playButton = document.getElementById('expanded-player-play')
  const range = document.getElementById('expanded-player-progress')
  const currentTime = document.getElementById('expanded-player-current-time')
  const totalTime = document.getElementById('expanded-player-total-time')
  const queueList = new QueueList(
    document.getElementById('player-queue-list'),
    document.getElementById('player-queue-announcement')
  )
  const audio = window.elements?.audio || document.getElementById('audio')
  const visualizer = new AudioVisualizer(
    audio,
    document.getElementById('player-visualizer'),
    () => !view?.hidden
  )
  if (!view || !panel || !openButton || !audio) return

  let returnFocus = null
  let dragStartY = null
  let dragging = false
  let closeTimer = null

  const syncTrack = () => {
    const mainTitle = document.getElementById('title')
    const mainArtist = document.getElementById('creator')
    const mainImage = document.querySelector('#art img')
    if (title) title.textContent = mainTitle?.textContent || 'Nothing playing'
    if (artist) artist.textContent = mainArtist?.textContent || 'Choose a track to begin'
    if (art) {
      if (mainImage?.src) {
        art.src = mainImage.src
        art.alt = mainImage.alt || 'Album cover'
        art.hidden = false
      } else {
        art.removeAttribute('src')
        art.hidden = true
      }
    }
    queueList.render()
    syncControls()
  }

  const syncControls = () => {
    if (!playButton) return
    const isPlaying = !audio.paused && !audio.ended
    playButton.textContent = isPlaying ? 'Pause' : 'Play'
    playButton.setAttribute('aria-label', isPlaying ? 'Pause playback' : 'Start playback')
    playButton.setAttribute('aria-pressed', String(isPlaying))
    const mainShuffle = document.getElementById('shuffle-favorites-btn')
    const expandedShuffle = document.getElementById('expanded-player-shuffle')
    if (mainShuffle && expandedShuffle) {
      expandedShuffle.setAttribute('aria-pressed', String(mainShuffle.classList.contains('active')))
    }
    const mainFavorite = document.getElementById('favorite-btn')
    const expandedFavorite = document.getElementById('expanded-player-favorite')
    if (mainFavorite && expandedFavorite) {
      const label = mainFavorite.getAttribute('aria-label') || 'Add to resonates'
      expandedFavorite.setAttribute('aria-label', label)
      expandedFavorite.textContent = label.startsWith('Remove') ? 'Saved' : 'Favorite'
      expandedFavorite.setAttribute('aria-pressed', String(label.startsWith('Remove')))
    }
    if (range) range.disabled = !Number.isFinite(audio.duration) || audio.duration <= 0
    syncProgress()
  }

  const syncProgress = () => {
    if (!range) return
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0
    if (duration > 0 && !range.matches(':active')) {
      range.max = String(Math.floor(duration))
      range.value = String(Math.floor(audio.currentTime || 0))
    }
    if (currentTime) currentTime.textContent = formatTime(Number(range.value))
    if (totalTime) totalTime.textContent = formatTime(duration)
    range.setAttribute('aria-valuetext', `${formatTime(Number(range.value))} of ${formatTime(duration)}`)
    range.style.setProperty('--seek-progress', duration > 0 ? `${(Number(range.value) / duration) * 100}%` : '0%')
  }

  const setBackgroundInert = isInert => {
    const content = document.getElementById('content-layout')
    const header = document.getElementById('app-header')
    ;[content, header].forEach(element => {
      if (!element) return
      element.inert = isInert
      element.setAttribute('aria-hidden', String(isInert))
    })
  }

  const open = () => {
    if (!view.hidden) return
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer)
      closeTimer = null
    }
    returnFocus = document.activeElement
    syncTrack()
    view.hidden = false
    view.classList.remove('is-closing')
    view.setAttribute('aria-hidden', 'false')
    document.body.classList.add('expanded-player-open')
    closeButton?.focus()
    setBackgroundInert(true)
    if (!audio.paused) visualizer.activate()
    window.requestAnimationFrame(() => {
      view.classList.add('is-open')
    })
  }

  const close = () => {
    if (view.hidden || closeTimer !== null) return
    visualizer.stop()
    panel.style.removeProperty('transform')
    view.classList.remove('is-open')
    view.classList.add('is-closing')
    view.setAttribute('aria-hidden', 'true')
    const finishClose = () => {
      view.hidden = true
      view.classList.remove('is-closing')
      document.body.classList.remove('expanded-player-open')
      setBackgroundInert(false)
      returnFocus?.focus?.()
      closeTimer = null
    }
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    closeTimer = window.setTimeout(finishClose, prefersReducedMotion ? 0 : 330)
  }

  const handlePointerDown = event => {
    if (!event.target.closest('.expanded-player__topbar')) return
    if (event.target.closest('button, input, a')) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragStartY = event.clientY
    dragging = false
    panel.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = event => {
    if (dragStartY === null || event.clientY <= dragStartY) return
    dragging = true
    panel.style.transform = `translateY(${event.clientY - dragStartY}px)`
  }

  const handlePointerUp = event => {
    if (dragStartY === null) return
    const delta = event.clientY - dragStartY
    dragStartY = null
    if (dragging && delta > 110) {
      close()
    } else {
      panel.style.transform = ''
    }
    dragging = false
  }

  openButton.addEventListener('click', open)
  closeButton?.addEventListener('click', close)
  view.addEventListener('click', event => {
    if (event.target === view) close()
  })
  panel.addEventListener('pointerdown', handlePointerDown)
  panel.addEventListener('pointermove', handlePointerMove)
  panel.addEventListener('pointerup', handlePointerUp)
  panel.addEventListener('pointercancel', handlePointerUp)

  document.addEventListener('keydown', event => {
    if (view.hidden) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(view.querySelectorAll('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
      .filter(element => !element.hidden && element.getClientRects().length > 0)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })

  playButton?.addEventListener('click', () => {
    visualizer.activate()
    document.getElementById('play-btn')?.click()
    syncControls()
  })
  document.getElementById('expanded-player-previous')?.addEventListener('click', () => document.getElementById('prev-btn')?.click())
  document.getElementById('expanded-player-next')?.addEventListener('click', () => document.getElementById('next-btn')?.click())
  document.getElementById('expanded-player-shuffle')?.addEventListener('click', () => {
    document.getElementById('shuffle-favorites-btn')?.click()
    syncControls()
  })
  document.getElementById('expanded-player-favorite')?.addEventListener('click', () => {
    document.getElementById('favorite-btn')?.click()
    syncControls()
  })
  document.getElementById('expanded-player-open-queue')?.addEventListener('click', () => {
    document.getElementById('player-queue-heading')?.focus()
  })

  range?.addEventListener('input', syncProgress)
  range?.addEventListener('change', () => {
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(audio.duration, Math.max(0, Number(range.value)))
    }
    syncProgress()
  })

  audio.addEventListener('play', () => {
    syncControls()
  })
  ;['pause', 'ended', 'timeupdate', 'durationchange', 'loadedmetadata'].forEach(eventName => {
    audio.addEventListener(eventName, syncControls)
  })
  window.addEventListener('resonate:track-changed', syncTrack)
  window.addEventListener('resonate:queue-updated', () => queueList.render())
  document.getElementById('player-queue-heading')?.addEventListener('focus', () => queueList.render())
  syncTrack()
}

function applyAmbientColors (event) {
  const colors = event.detail
  if (!colors || !colors.primary || !colors.secondary) return
  document.documentElement.style.setProperty('--player-ambient-primary', colors.primary)
  document.documentElement.style.setProperty('--player-ambient-secondary', colors.secondary)
}

window.addEventListener('resonate:ambient-colors', applyAmbientColors)

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true })
} else {
  initialize()
}
