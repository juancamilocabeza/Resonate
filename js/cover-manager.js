/**
 * @file cover-manager.js
 * @description Centralized album cover/artwork management system
 * Provides unified loading, caching, error handling, and fallback generation for album covers
 */

(function(window) {
  'use strict';

  /**
   * Cache for loaded cover images to avoid duplicate requests
   * Key: identifier, Value: { img, promise }
   */
  const coverCache = new Map();

  /**
   * Cache for failed covers to avoid repeated network errors
   * Key: identifier, Value: timestamp
   */
  const failedCoverCache = new Map();

  const FAILED_COVER_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  /**
   * Base URL for Archive.org image service
   */
  const ARCHIVE_IMG_BASE = 'https://archive.org/services/img';

  /**
   * Default options for cover loading
   */
  const DEFAULT_OPTIONS = {
    alt: 'Album cover',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    borderRadius: '12px',
    lazy: false,
    showFallback: true,
    fallbackType: 'svg', // 'svg' or 'none'
    preload: false
  };

  /**
   * Get the cover URL for a given identifier
   * @param {string} identifier - Archive.org identifier
   * @returns {string} Full cover URL
   */
  function getCoverUrl(identifier) {
    if (!identifier || identifier === 'default') {
      return null;
    }
    return `${ARCHIVE_IMG_BASE}/${encodeURIComponent(identifier)}`;
  }

  function markCoverFailed(identifier) {
    if (!identifier) return;
    failedCoverCache.set(String(identifier), Date.now());
  }

  function wasCoverRecentlyFailed(identifier) {
    if (!identifier) return false;
    const key = String(identifier);
    const ts = failedCoverCache.get(key);
    if (!ts) return false;
    return (Date.now() - ts) < FAILED_COVER_TTL_MS;
  }

  /**
   * Generate SVG fallback image with theme colors
   * @param {Object} options
   * @param {string} options.identifier - Archive.org identifier
   * @param {string} options.title - Album/track title
   * @param {string} options.creator - Artist name
   * @returns {string} Data URL for SVG image
   */
  function generateSvgFallback({ identifier = '', title = '', creator = '' }) {
    const theme = getComputedThemeColors();
    const displayText = title || 'No Cover';
    const displayCreator = creator.slice(0, 24);
    
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>
      <defs>
        <linearGradient id='g-${identifier}' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='${theme.btn}'/>
          <stop offset='100%' stop-color='${theme.card}'/>
        </linearGradient>
      </defs>
      <rect width='100%' height='100%' fill='url(#g-${identifier})'/>
      <g fill='${theme.primary}' fill-opacity='0.78' font-family='sans-serif' font-weight='700'>
        <text x='50%' y='48%' dominant-baseline='middle' text-anchor='middle' font-size='22'>No Cover</text>
        ${displayCreator ? `<text x='50%' y='66%' dominant-baseline='middle' text-anchor='middle' font-size='12'>${displayCreator}</text>` : ''}
      </g>
    </svg>`;
    
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  /**
   * Get computed theme colors from CSS custom properties
   * @returns {Object} Theme color values
   */
  function getComputedThemeColors() {
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    
    return {
      btn: styles.getPropertyValue('--btn').trim() || '#2a2a2a',
      card: styles.getPropertyValue('--card').trim() || '#1a1a1a',
      primary: styles.getPropertyValue('--primary').trim() || '#ff6b35',
      fg: styles.getPropertyValue('--fg').trim() || '#ffffff'
    };
  }

  function logDebug(message, ...args) {
    if (window.logger && typeof window.logger.debug === 'function') {
      window.logger.debug(message, 'COVER', ...args);
    }
  }

  function logWarn(message, ...args) {
    if (window.logger && typeof window.logger.warn === 'function') {
      window.logger.warn(message, 'COVER', ...args);
    }
  }

  function logError(message, ...args) {
    if (window.logger && typeof window.logger.error === 'function') {
      window.logger.error(message, 'COVER', ...args);
    }
  }

  /**
   * Create and configure an image element for album cover
   * @param {string} identifier - Archive.org identifier
   * @param {Object} options - Configuration options
   * @returns {Promise<HTMLImageElement>} Promise that resolves with configured image element
   */
  function loadCover(identifier, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    // Check cache first - but create a new image element each time
    const cacheKey = `${identifier}-${opts.width}-${opts.height}`;
    if (coverCache.has(cacheKey) && !opts.preload) {
      logDebug(`Cover cache hit: ${identifier}`);
      const cachedUrl = coverCache.get(cacheKey).url;
      
      // Return a new image element with cached URL (synchronously)
      const img = new Image();
      img.alt = opts.alt;
      img.style.display = 'block';
      if (opts.width) img.style.width = opts.width;
      if (opts.height) img.style.height = opts.height;
      if (opts.objectFit) img.style.objectFit = opts.objectFit;
      if (opts.borderRadius) img.style.borderRadius = opts.borderRadius;
      if (opts.lazy) img.loading = 'lazy';
      
      img.onerror = () => {
        logWarn(`Cover load from cache failed: ${identifier}`);
        if (opts.showFallback && opts.fallbackType === 'svg') {
          img.src = generateSvgFallback({
            identifier,
            title: opts.fallbackTitle || '',
            creator: opts.fallbackCreator || ''
          });
        }
      };
      
      img.onload = () => {
        logDebug(`Cover loaded from cache: ${identifier}`);
      };
      
      img.src = cachedUrl;
      
      return Promise.resolve(img);
    }
    
    // Create image element immediately and return it synchronously
    const img = new Image();
    
    // Set alt text
    img.alt = opts.alt;
    
    // Apply styles - ensure image is visible and sized correctly
    img.style.display = 'block';
    if (opts.width) img.style.width = opts.width;
    if (opts.height) img.style.height = opts.height;
    if (opts.objectFit) img.style.objectFit = opts.objectFit;
    if (opts.borderRadius) img.style.borderRadius = opts.borderRadius;
    
    // Set lazy loading
    if (opts.lazy) {
      img.loading = 'lazy';
    }
    
    // If we recently failed this cover, skip the network attempt
    if (!opts.preload && wasCoverRecentlyFailed(identifier)) {
      logWarn(`Cover recently failed, using fallback: ${identifier}`);
      if (opts.showFallback && opts.fallbackType === 'svg') {
        img.src = generateSvgFallback({
          identifier,
          title: opts.fallbackTitle || '',
          creator: opts.fallbackCreator || ''
        });
      }
      return Promise.resolve(img);
    }

    // Get cover URL
    const coverUrl = getCoverUrl(identifier);
    console.log(`[CoverManager] Loading cover for ${identifier}: ${coverUrl}`);
    
    if (!coverUrl) {
      // No valid identifier - use fallback immediately
      if (opts.showFallback && opts.fallbackType === 'svg') {
        img.src = generateSvgFallback({
          identifier,
          title: opts.fallbackTitle || '',
          creator: opts.fallbackCreator || ''
        });
      }
      return Promise.resolve(img);
    }
    
    // Cache the URL for later use
    if (!opts.preload) {
      coverCache.set(cacheKey, { url: coverUrl });
    }
    
    // Set src directly - browser will load it
    img.src = coverUrl;
    
    // Add error handler for fallback
    img.onerror = () => {
      if (img.dataset && img.dataset.coverFallbackApplied === '1') return;
      try { if (img.dataset) img.dataset.coverFallbackApplied = '1'; } catch {}

      logWarn(`Cover load failed: ${identifier}`);
      markCoverFailed(identifier);
      
      // Apply fallback if enabled
      if (opts.showFallback && opts.fallbackType === 'svg') {
        try { img.onerror = null; } catch {}
        img.src = generateSvgFallback({
          identifier,
          title: opts.fallbackTitle || '',
          creator: opts.fallbackCreator || ''
        });
      }
    };
    
    img.onload = () => {
      console.log(`[CoverManager] Cover loaded successfully: ${identifier}`, img.naturalWidth, 'x', img.naturalHeight);
      logDebug(`Cover loaded successfully: ${identifier}`);
    };
    
    // Return image immediately - don't wait for load
    return Promise.resolve(img);
  }

  /**
   * Preload cover images for better UX
   * @param {string[]} identifiers - Array of identifiers to preload
   * @returns {Promise<void>}
   */
  async function preloadCovers(identifiers) {
    if (!Array.isArray(identifiers) || identifiers.length === 0) {
      return;
    }
    
    logDebug(`Preloading ${identifiers.length} covers`);
    
    const preloadPromises = identifiers
      .filter(id => id && id !== 'default')
      .map(identifier => 
        loadCover(identifier, { 
          preload: true,
          showFallback: false 
        }).catch(err => {
          logWarn(`Preload failed for ${identifier}:`, err);
        })
      );
    
    await Promise.allSettled(preloadPromises);
  }

  /**
   * Clear the cover cache
   * @param {string} identifier - Optional specific identifier to clear, or clear all if not provided
   */
  function clearCoverCache(identifier = null) {
    if (identifier) {
      // Clear all cache entries for this identifier
      const keysToDelete = [];
      for (const key of coverCache.keys()) {
        if (key.startsWith(identifier)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => coverCache.delete(key));
      logDebug(`Cleared cover cache for: ${identifier}`);
    } else {
      coverCache.clear();
      logDebug('Cleared all cover cache');
    }
  }

  /**
   * Get cover image as File/Blob for sharing
   * @param {string} identifier - Archive.org identifier
   * @returns {Promise<File|null>} Cover image as File or null if failed
   */
  async function getCoverImageForSharing(identifier) {
    const coverUrl = getCoverUrl(identifier);
    
    if (!coverUrl) {
      return null;
    }
    
    if (typeof File === 'undefined') {
      logWarn('File API not available for sharing');
      return null;
    }
    
    try {
      const response = await fetch(coverUrl);
      if (!response.ok) {
        logWarn(`Failed to fetch cover for sharing: ${identifier}`);
        return null;
      }
      
      const blob = await response.blob();
      if (!blob || !blob.size) {
        logWarn(`Empty blob received for cover: ${identifier}`);
        return null;
      }
      
      const filename = `cover-${identifier}.jpg`;
      const blobType = blob && typeof blob.type === 'string' ? blob.type : '';
      const fileType = blobType && blobType.startsWith('image/') ? blobType : 'image/jpeg';
      
      return new File([blob], filename, { type: fileType });
    } catch (error) {
      logError('Error fetching cover for sharing:', error);
      return null;
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  function getCoverCacheStats() {
    return {
      size: coverCache.size,
      keys: Array.from(coverCache.keys())
    };
  }

  // Export to window object
  window.CoverManager = {
    loadCover,
    preloadCovers,
    clearCoverCache,
    getCoverImageForSharing,
    getCoverCacheStats,
    getCoverUrl
  };

})(window);
