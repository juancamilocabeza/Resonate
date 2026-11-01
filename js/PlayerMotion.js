// Focus motion on track changes and the main transport control.
(() => {
  const reducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null
  const activeAnimations = new WeakMap()

  function animate(element, keyframes, options) {
    if (!element || typeof element.animate !== 'function') return

    const previousAnimation = activeAnimations.get(element)
    if (previousAnimation) previousAnimation.cancel()

    const animation = element.animate(keyframes, {
      duration: options.duration,
      delay: options.delay,
      easing: options.easing,
      fill: 'both'
    })

    activeAnimations.set(element, animation)
    animation.onfinish = () => {
      if (activeAnimations.get(element) === animation) {
        activeAnimations.delete(element)
      }
      animation.cancel()
    }
  }

  function enterTrack() {
    if (reducedMotion && reducedMotion.matches) return

    const artwork = document.querySelector('.editorial-art-frame .art')
    const title = document.getElementById('title')
    const artist = document.getElementById('creator')
    const controls = document.querySelector('.main-player-section .controls')

    animate(artwork, [
      { opacity: 0.82, transform: 'scale(0.95)' },
      { opacity: 1, transform: 'scale(1)' }
    ], { duration: 250, delay: 0, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' })

    const textEntry = [
      { opacity: 0, transform: 'translateY(10px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ]
    const textOptions = {
      duration: 220,
      delay: 50,
      easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)'
    }
    animate(title, textEntry, textOptions)
    animate(artist, textEntry, textOptions)

    animate(controls, [
      { opacity: 0 },
      { opacity: 1 }
    ], { duration: 180, delay: 100, easing: 'ease-out' })
  }

  function syncPlaybackState(isPlaying) {
    const playButton = (window.elements && window.elements.playBtn) ||
      document.getElementById('play-btn')
    if (playButton) playButton.classList.toggle('is-playing', Boolean(isPlaying))
  }

  function pulsePlayButton() {
    if (reducedMotion && reducedMotion.matches) return

    const icon = document.querySelector('#play-btn .transport-icon')
    animate(icon, [
      { transform: 'scale(1)' },
      { transform: 'scale(0.82)', offset: 0.45 },
      { transform: 'scale(1)' }
    ], { duration: 180, delay: 0, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' })
  }

  function initialize() {
    const playButton = (window.elements && window.elements.playBtn) ||
      document.getElementById('play-btn')
    if (!playButton) return

    playButton.addEventListener('pointerdown', pulsePlayButton)
    playButton.addEventListener('keydown', event => {
      if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) pulsePlayButton()
    })
    syncPlaybackState(playButton.dataset.state === 'pause')
  }

  window.PlayerMotion = { enterTrack, syncPlaybackState }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  } else {
    initialize()
  }
})()
