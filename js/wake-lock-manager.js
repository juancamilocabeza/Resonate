/**
 * @file wake-lock-manager.js
 * @description Screen Wake Lock API integration for Resonate Player
 * 
 * Features:
 * - Prevents screen from turning off during music playback
 * - Automatic lock acquisition on play and release on pause
 * - Handles visibility changes and page lifecycle events
 * - Cross-browser compatibility with graceful fallback
 * - Battery-efficient implementation
 * 
 * @version 1.0.0
 */

(function(window) {
  'use strict';

  /**
   * WakeLock Manager Class
   * Encapsulates all Wake Lock API logic with automatic lifecycle management
   */
  class WakeLockManager {
    constructor() {
      this.isSupported = this._checkSupport();
      this.wakeLock = null;
      this.isAcquiring = false;
      this.shouldBeActive = false;
      
      // Track visibility for re-acquisition
      this._setupVisibilityHandling();
      
      this._log('info', 'WakeLockManager initialized', { isSupported: this.isSupported });
    }

    /**
     * Check if Screen Wake Lock API is supported in current browser
     * @returns {boolean}
     */
    _checkSupport() {
      try {
        return 'wakeLock' in navigator && 
               typeof navigator.wakeLock === 'object' &&
               navigator.wakeLock !== null &&
               typeof navigator.wakeLock.request === 'function';
      } catch (error) {
        this._log('warn', 'Wake Lock feature detection failed', error);
        return false;
      }
    }

    /**
     * Acquire wake lock to prevent screen from turning off
     * @returns {Promise<boolean>} True if lock was acquired or already held
     */
    async acquire() {
      if (!this.isSupported) {
        this._log('debug', 'Wake Lock API not supported, skipping acquisition');
        return false;
      }

      // Prevent concurrent acquisition attempts
      if (this.isAcquiring) {
        this._log('debug', 'Wake lock acquisition already in progress');
        return false;
      }

      // If we already have an active lock, no need to acquire again
      if (this.wakeLock && !this.wakeLock.released) {
        this._log('debug', 'Wake lock already active');
        return true;
      }

      this.isAcquiring = true;
      this.shouldBeActive = true;

      try {
        this._log('debug', 'Requesting wake lock');
        this.wakeLock = await navigator.wakeLock.request('screen');
        
        // Listen for release event
        this.wakeLock.addEventListener('release', () => {
          this._log('debug', 'Wake lock was released');
          
          // If lock was released but should still be active (e.g., visibility change),
          // try to re-acquire it
          if (this.shouldBeActive && !document.hidden) {
            this._log('info', 'Wake lock released unexpectedly, attempting to re-acquire');
            setTimeout(() => this.acquire(), 100);
          }
        });

        this._log('info', 'Wake lock acquired successfully');
        return true;
      } catch (error) {
        // Common errors:
        // - NotAllowedError: User denied permission or browser policy blocked it
        // - NotSupportedError: Feature not supported in this context
        const errorName = error?.name || 'Unknown';
        const errorMessage = error?.message || String(error);
        
        // Only log as warning if not a permission denial (expected in some contexts)
        if (errorName === 'NotAllowedError') {
          this._log('debug', 'Wake lock permission denied or blocked by policy');
        } else {
          this._log('warn', 'Failed to acquire wake lock', { errorName, errorMessage });
        }
        
        return false;
      } finally {
        this.isAcquiring = false;
      }
    }

    /**
     * Release wake lock to allow screen to turn off normally
     * @returns {Promise<boolean>} True if lock was released
     */
    async release() {
      this.shouldBeActive = false;

      if (!this.wakeLock) {
        this._log('debug', 'No wake lock to release');
        return false;
      }

      try {
        if (!this.wakeLock.released) {
          await this.wakeLock.release();
          this._log('info', 'Wake lock released successfully');
        } else {
          this._log('debug', 'Wake lock was already released');
        }
        this.wakeLock = null;
        return true;
      } catch (error) {
        this._log('error', 'Failed to release wake lock', error);
        this.wakeLock = null;
        return false;
      }
    }

    /**
     * Setup visibility change handling for automatic re-acquisition
     * @private
     */
    _setupVisibilityHandling() {
      if (typeof document === 'undefined') {
        return;
      }

      // Re-acquire wake lock when page becomes visible again
      document.addEventListener('visibilitychange', async () => {
        if (!document.hidden && this.shouldBeActive && (!this.wakeLock || this.wakeLock.released)) {
          this._log('debug', 'Page became visible, attempting to re-acquire wake lock');
          await this.acquire();
        }
      });

      // Clean up on page hide/unload
      window.addEventListener('pagehide', () => {
        this._log('debug', 'Page hiding, releasing wake lock');
        this.release();
      });
    }

    /**
     * Get current status for debugging
     * @returns {Object} Status information
     */
    getStatus() {
      return {
        isSupported: this.isSupported,
        isActive: !!(this.wakeLock && !this.wakeLock.released),
        shouldBeActive: this.shouldBeActive,
        isAcquiring: this.isAcquiring
      };
    }

    /**
     * Logging helper with namespace
     * @private
     */
    _log(level, message, ...args) {
      if (window.logger && typeof window.logger[level] === 'function') {
        window.logger[level](message, 'WAKE_LOCK', ...args);
      } else if (console && typeof console[level] === 'function') {
        console[level](`[WakeLock] ${message}`, ...args);
      }
    }
  }

  // Export to window
  window.WakeLockManager = WakeLockManager;

  // Create singleton instance for convenience
  window.wakeLockManager = new WakeLockManager();

  // Log initialization
  if (window.logger && typeof window.logger.info === 'function') {
    window.logger.info('WakeLockManager module loaded', 'WAKE_LOCK');
  }

})(window);
