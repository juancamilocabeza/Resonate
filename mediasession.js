function initMediaSession() {
  if (!('mediaSession' in navigator)) {
    return;
  }

  // Configurar handlers de MediaSession
  navigator.mediaSession.setActionHandler('play', () => {
    if (window.elements?.audio?.play) {
      window.elements.audio.play();
    }
  });

  navigator.mediaSession.setActionHandler('pause', () => {
    if (window.elements?.audio?.pause) {
      window.elements.audio.pause();
    }
  });

  navigator.mediaSession.setActionHandler('previoustrack', () => {
    if (typeof window.playPrevious === 'function') {
      window.playPrevious();
    }
  });

  navigator.mediaSession.setActionHandler('nexttrack', () => {
    if (typeof window.playNext === 'function') {
      window.playNext();
    }
  });

  // Actualizar posición de reproducción
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (window.elements?.audio) {
      if (details.fastSeek && 'fastSeek' in window.elements.audio) {
        window.elements.audio.fastSeek(details.seekTime);
        return;
      }
      window.elements.audio.currentTime = details.seekTime;
    }
  });
}

// Función para actualizar metadata de MediaSession
async function updateMediaSessionMetadata(identifier) {
  if (!('mediaSession' in navigator) || !identifier) return;

  try {
    const artworkUrl = `https://archive.org/services/img/${identifier}`;
    const state = window.state;
    const currentTrack = state?.currentTrack;

    if (!currentTrack) return;

    const metadata = new MediaMetadata({
      title: currentTrack.title || 'Sin título',
      artist: currentTrack.creator || 'Desconocido',
      album: state.currentGenre ? state.currentGenre.charAt(0).toUpperCase() + state.currentGenre.slice(1) : 'Resonate',
      artwork: [
        { src: artworkUrl, sizes: '96x96', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '128x128', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '192x192', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '384x384', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }
      ]
    });

    navigator.mediaSession.metadata = metadata;

    // Actualizar estado de reproducción
    if (window.elements?.audio) {
      navigator.mediaSession.playbackState = window.elements.audio.paused ? 'paused' : 'playing';
    }
  } catch (error) {
    console.error('Error actualizando MediaSession metadata:', error);
  }
}

// Exponer funciones necesarias globalmente
window.updateMediaSessionMetadata = updateMediaSessionMetadata;
window.initMediaSession = initMediaSession;

// Inicializar cuando el documento esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMediaSession);
} else {
  initMediaSession();
}
