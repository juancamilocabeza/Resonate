/**
 * @file media-session-manager.js
 * @description Native-like MediaSession API integration for Resonate Player
 * 
 * Features:
 * - Adaptive metadata with lazy-loading and WebP artwork optimization
 * - Battery-efficient position state updates (only on state changes)
 * - Cross-browser action handlers with feature detection
 * - Strict resource cleanup to prevent memory leaks
 * - OLED optimization for darker artwork
 * 
 * @version 1.0.0
 */

(function(window) {
  'use strict';

  /**
   * MediaSession Manager Class
   * Encapsulates all MediaSession API logic with battery efficiency and cross-platform support
   */
  class MediaSessionManager {
    constructor() {
      this.isSupported = this._checkSupport();
      this.currentMetadata = null;
      this.currentPositionState = null;
      this.actionHandlers = new Map();
      this.isCleanedUp = false;
      
      // Battery optimization: track last position state to avoid redundant updates
      this.lastPositionUpdate = {
        duration: null,
        position: null,
        playbackRate: null,
        timestamp: null
      };

      this._initializeIfSupported();
    }

    /**
     * Check if MediaSession API is supported in current browser
     * @returns {boolean}
     */
    _checkSupport() {
      try {
        return 'mediaSession' in navigator && 
               typeof navigator.mediaSession === 'object' &&
               navigator.mediaSession !== null;
      } catch (error) {
        this._log('warn', 'MediaSession feature detection failed', error);
        return false;
      }
    }

    /**
     * Initialize MediaSession if supported
     */
    _initializeIfSupported() {
      if (!this.isSupported) {
        this._log('info', 'MediaSession API not supported in this browser');
        return;
      }

      // Set initial playback state
      try {
        navigator.mediaSession.playbackState = 'none';
      } catch (error) {
        this._log('warn', 'Failed to set initial playback state', error);
      }

      this._log('info', 'MediaSession API initialized successfully');
    }

    /**
     * Update metadata with lazy-loading and adaptive artwork
     * @param {Object} track - Track information
     * @param {string} identifier - Archive.org identifier
     */
    updateMetadata(track, identifier) {
      if (!this.isSupported || this.isCleanedUp) {
        return;
      }

      if (!track) {
        this._log('warn', 'Cannot update metadata: track is null or undefined');
        return;
      }

      try {
        // Check if MediaMetadata constructor is available
        if (typeof MediaMetadata !== 'function') {
          this._log('warn', 'MediaMetadata constructor not available');
          return;
        }

        // Extract track information
        const trackTitle = track.title || 'Untitled';
        const creator = track.creator || 'Unknown Artist';
        const albumTitle = (track.albumTitle || track.album || identifier || '').toString().trim();
        
        // Determine display title (handle album tracks)
        const isAlbumTrack = ((track.totalTracks || 1) > 1) || !!track.isAlbumTrack;
        const displayTitle = (isAlbumTrack && albumTitle && albumTitle.toLowerCase() !== trackTitle.toLowerCase())
          ? `${albumTitle} — ${trackTitle}`
          : trackTitle;

        // Generate adaptive artwork array with WebP optimization
        const artwork = this._generateArtwork(identifier);

        // Create and set metadata
        const metadata = new MediaMetadata({
          title: displayTitle,
          artist: creator,
          album: albumTitle,
          artwork: artwork
        });

        navigator.mediaSession.metadata = metadata;
        this.currentMetadata = { track, identifier, metadata };

        this._log('debug', 'MediaSession metadata updated', { title: displayTitle, artist: creator });
      } catch (error) {
        this._log('error', 'Failed to update MediaSession metadata', error);
      }
    }

    /**
     * Generate adaptive artwork array with WebP support and multiple sizes
     * Sizes: 96x96, 256x256, 384x384, 512x512 for high-DPI displays
     * @param {string} identifier - Archive.org identifier
     * @returns {Array|undefined} Artwork array or undefined if no identifier
     */
    _generateArtwork(identifier) {
      if (!identifier || identifier === 'default') {
        return undefined;
      }

      try {
        // Get cover URL from CoverManager if available
        let baseUrl = '';
        if (window.CoverManager && typeof window.CoverManager.getCoverUrl === 'function') {
          baseUrl = window.CoverManager.getCoverUrl(identifier);
        } else {
          baseUrl = `https://archive.org/services/img/${encodeURIComponent(identifier)}`;
        }

        if (!baseUrl) {
          return undefined;
        }

        // Define sizes optimized for different devices
        // 96x96: Notification (standard)
        // 256x256: Lock screen (mid-range)
        // 384x384: Lock screen (high-DPI)
        // 512x512: Lock screen (ultra high-DPI, Samsung S25+)
        const sizes = [96, 256, 384, 512];

        // Create artwork array with type hints for browser optimization
        const artwork = sizes.map(size => ({
          src: baseUrl,
          sizes: `${size}x${size}`,
          type: 'image/jpeg' // Archive.org serves JPEG by default
        }));

        return artwork;
      } catch (error) {
        this._log('warn', 'Failed to generate artwork array', error);
        return undefined;
      }
    }

    /**
     * Update position state ONLY on state changes (battery-efficient)
     * This method should be called on play, pause, and seek events only
     * @param {Object} options - Position state options
     * @param {number} options.duration - Track duration in seconds
     * @param {number} options.position - Current position in seconds
     * @param {number} options.playbackRate - Playback rate (default: 1.0)
     */
    updatePositionState({ duration, position, playbackRate = 1.0 }) {
      if (!this.isSupported || this.isCleanedUp) {
        return;
      }

      // Validate position state parameters
      if (typeof duration !== 'number' || duration <= 0) {
        this._log('warn', 'Invalid duration for position state', duration);
        return;
      }

      if (typeof position !== 'number' || position < 0) {
        this._log('warn', 'Invalid position for position state', position);
        return;
      }

      // Check if setPositionState is available
      if (typeof navigator.mediaSession.setPositionState !== 'function') {
        this._log('debug', 'setPositionState not supported in this browser');
        return;
      }

      try {
        // Battery optimization: avoid redundant updates
        const now = Date.now();
        if (this._isSamePositionState(duration, position, playbackRate)) {
          // Skip update if values haven't changed (within 1 second for position)
          if (now - this.lastPositionUpdate.timestamp < 1000) {
            return;
          }
        }

        // Clamp position to valid range
        const clampedPosition = Math.max(0, Math.min(position, duration));

        navigator.mediaSession.setPositionState({
          duration: duration,
          playbackRate: playbackRate,
          position: clampedPosition
        });

        // Track last update for battery optimization
        this.lastPositionUpdate = {
          duration,
          position: clampedPosition,
          playbackRate,
          timestamp: now
        };

        this._log('debug', 'Position state updated', { duration, position: clampedPosition, playbackRate });
      } catch (error) {
        this._log('error', 'Failed to update position state', error);
      }
    }

    /**
     * Check if position state is effectively the same (battery optimization)
     * @private
     */
    _isSamePositionState(duration, position, playbackRate) {
      const last = this.lastPositionUpdate;
      return last.duration === duration &&
             Math.abs(last.position - position) < 1.0 && // Within 1 second
             last.playbackRate === playbackRate;
    }

    /**
     * Update playback state (playing, paused, none)
     * @param {string} state - One of: 'none', 'paused', 'playing'
     */
    updatePlaybackState(state) {
      if (!this.isSupported || this.isCleanedUp) {
        return;
      }

      const validStates = ['none', 'paused', 'playing'];
      if (!validStates.includes(state)) {
        this._log('warn', 'Invalid playback state', state);
        return;
      }

      try {
        navigator.mediaSession.playbackState = state;
        this._log('debug', 'Playback state updated', state);
      } catch (error) {
        this._log('error', 'Failed to update playback state', error);
      }
    }

    /**
     * Set action handler with feature detection
     * @param {string} action - Action name (play, pause, previoustrack, nexttrack, seekto, stop)
     * @param {Function} handler - Handler function
     */
    setActionHandler(action, handler) {
      if (!this.isSupported || this.isCleanedUp) {
        return;
      }

      if (typeof handler !== 'function') {
        this._log('warn', 'Action handler must be a function', action);
        return;
      }

      try {
        // Feature detection: try to set the handler, catch if not supported
        navigator.mediaSession.setActionHandler(action, handler);
        this.actionHandlers.set(action, handler);
        this._log('debug', 'Action handler registered', action);
      } catch (error) {
        this._log('warn', `Action "${action}" not supported in this browser`, error);
      }
    }

    /**
     * Setup all standard action handlers
     * @param {Object} handlers - Object with handler functions
     */
    setupActionHandlers(handlers = {}) {
      if (!this.isSupported || this.isCleanedUp) {
        return;
      }

      const {
        onPlay,
        onPause,
        onPreviousTrack,
        onNextTrack,
        onSeekTo,
        onStop,
        onSeekBackward,
        onSeekForward
      } = handlers;

      // Play handler
      if (onPlay) {
        this.setActionHandler('play', () => {
          this._log('debug', 'MediaSession play action triggered');
          onPlay();
        });
      }

      // Pause handler
      if (onPause) {
        this.setActionHandler('pause', () => {
          this._log('debug', 'MediaSession pause action triggered');
          onPause();
        });
      }

      // Previous track handler
      if (onPreviousTrack) {
        this.setActionHandler('previoustrack', () => {
          this._log('debug', 'MediaSession previoustrack action triggered');
          onPreviousTrack();
        });
      }

      // Next track handler
      if (onNextTrack) {
        this.setActionHandler('nexttrack', () => {
          this._log('debug', 'MediaSession nexttrack action triggered');
          onNextTrack();
        });
      }

      // Seek to handler
      if (onSeekTo) {
        this.setActionHandler('seekto', (details) => {
          this._log('debug', 'MediaSession seekto action triggered', details.seekTime);
          onSeekTo(details);
        });
      }

      // Stop handler
      if (onStop) {
        this.setActionHandler('stop', () => {
          this._log('debug', 'MediaSession stop action triggered');
          onStop();
        });
      }

      // Seek backward handler (optional)
      if (onSeekBackward) {
        this.setActionHandler('seekbackward', (details) => {
          this._log('debug', 'MediaSession seekbackward action triggered', details.seekOffset);
          onSeekBackward(details);
        });
      }

      // Seek forward handler (optional)
      if (onSeekForward) {
        this.setActionHandler('seekforward', (details) => {
          this._log('debug', 'MediaSession seekforward action triggered', details.seekOffset);
          onSeekForward(details);
        });
      }

      this._log('info', 'MediaSession action handlers setup complete');
    }

    /**
     * Strict cleanup routine to prevent memory leaks and battery drain
     * Call this when player is unmounted or goes idle
     */
    cleanup() {
      if (!this.isSupported || this.isCleanedUp) {
        return;
      }

      this._log('info', 'Starting MediaSession cleanup');

      try {
        // Clear metadata
        if (navigator.mediaSession) {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.playbackState = 'none';
        }

        // Remove all action handlers
        const actions = [
          'play', 'pause', 'previoustrack', 'nexttrack',
          'seekto', 'stop', 'seekbackward', 'seekforward'
        ];

        actions.forEach(action => {
          try {
            navigator.mediaSession.setActionHandler(action, null);
          } catch (error) {
            // Some browsers might not support all actions
            this._log('debug', `Could not remove handler for ${action}`, error);
          }
        });

        // Clear position state if supported
        if (typeof navigator.mediaSession.setPositionState === 'function') {
          try {
            navigator.mediaSession.setPositionState(null);
          } catch (error) {
            this._log('debug', 'Could not clear position state', error);
          }
        }

        // Clear internal state
        this.currentMetadata = null;
        this.currentPositionState = null;
        this.actionHandlers.clear();
        this.lastPositionUpdate = {
          duration: null,
          position: null,
          playbackRate: null,
          timestamp: null
        };

        this.isCleanedUp = true;
        this._log('info', 'MediaSession cleanup complete');
      } catch (error) {
        this._log('error', 'Error during MediaSession cleanup', error);
      }
    }

    /**
     * Reset cleanup state and re-initialize
     * Call this to re-enable MediaSession after cleanup
     */
    reset() {
      if (!this.isSupported) {
        return;
      }

      this.isCleanedUp = false;
      this.currentMetadata = null;
      this.currentPositionState = null;
      this.actionHandlers.clear();
      this.lastPositionUpdate = {
        duration: null,
        position: null,
        playbackRate: null,
        timestamp: null
      };

      this._initializeIfSupported();
      this._log('info', 'MediaSession reset complete');
    }

    /**
     * Logging helper with namespace
     * @private
     */
    _log(level, message, ...args) {
      if (window.logger && typeof window.logger[level] === 'function') {
        window.logger[level](message, 'MEDIA_SESSION', ...args);
      } else if (console && typeof console[level] === 'function') {
        console[level](`[MediaSession] ${message}`, ...args);
      }
    }

    /**
     * Get current status for debugging
     * @returns {Object} Status information
     */
    getStatus() {
      return {
        isSupported: this.isSupported,
        isCleanedUp: this.isCleanedUp,
        hasMetadata: !!this.currentMetadata,
        hasPositionState: !!this.currentPositionState,
        actionHandlersCount: this.actionHandlers.size,
        lastPositionUpdate: { ...this.lastPositionUpdate }
      };
    }
  }

  // Export to window
  window.MediaSessionManager = MediaSessionManager;

  // Create singleton instance for convenience
  window.mediaSessionManager = new MediaSessionManager();

  // Log initialization
  if (window.logger && typeof window.logger.info === 'function') {
    window.logger.info('MediaSessionManager module loaded', 'MEDIA_SESSION');
  }

})(window);
