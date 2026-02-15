/**
 * Share Module for Resonate Player
 * 
 * This module handles all sharing functionality including:
 * - Building shareable URLs
 * - Sharing tracks/albums via Web Share API or clipboard
 * - Handling incoming shared links
 * - Managing Open Graph and Twitter Card meta tags for rich previews
 * - Detecting and applying share capabilities
 * 
 * @module share
 */

/**
 * Gets the canonical share origin for Resonate Player
 * Ensures all shared links use the production domain
 * @returns {string} The canonical origin URL
 */
function getCanonicalShareOrigin() {
  const currentOrigin = window.location.origin;
  const prodOrigin = 'https://www.resonateplayer.com';
  
  // If we're on production (with or without www), use the canonical www version
  if (currentOrigin === 'https://resonateplayer.com' || currentOrigin === prodOrigin) {
    return prodOrigin;
  }
  
  // For development/local, use current origin
  return currentOrigin;
}

/**
 * Builds a shareable URL for a track or album
 * 
 * @param {string} identifier - The Archive.org identifier
 * @param {number|null} trackIndex - Optional track index for album tracks (0-based)
 * @returns {string} The complete shareable URL
 * 
 * @example
 * // Single track
 * buildShareUrl('etree-track-123') 
 * // => 'https://www.resonateplayer.com/?play=etree-track-123'
 * 
 * @example
 * // Album track at index 3
 * buildShareUrl('album-456', 3)
 * // => 'https://www.resonateplayer.com/?play=album-456&t=3'
 */
function buildShareUrl(identifier, trackIndex = null) {
  const baseUrl = new URL(getCanonicalShareOrigin());
  baseUrl.hash = '';
  baseUrl.search = '';
  // Always share within the PWA scope entrypoint.
  baseUrl.pathname = '/';

  const params = new URLSearchParams();
  params.set('play', identifier);

  const idx = typeof trackIndex === 'number' && isFinite(trackIndex) && trackIndex >= 0 ? Math.floor(trackIndex) : null;
  if (idx !== null) {
    params.set('t', String(idx));
  }

  baseUrl.search = params.toString();
  return baseUrl.toString();
}

/**
 * Normalizes a track title by trimming whitespace
 * @param {string} title - The track title
 * @returns {string} The normalized title
 */
function normalizeTrackTitle(title) {
  return typeof title === 'string' ? title.trim() : 'Untitled';
}

/**
 * Normalizes a track creator/artist name
 * @param {string|null|undefined} creator - The creator name
 * @returns {string} The normalized creator name or empty string
 */
function normalizeTrackCreator(creator) {
  return (creator && typeof creator === 'string') ? creator.trim() : '';
}

/**
 * Updates Open Graph and Twitter Card meta tags for a track
 * Enables rich social media previews when links are shared
 * 
 * @param {string} identifier - The Archive.org identifier
 * @param {string} title - The track title
 * @param {string} creator - The artist/creator name
 * @param {number|null} trackIndex - Optional track index
 */
function applyTrackMetaTagsForIdentifier(identifier, title, creator = '', trackIndex = null) {
  if (!identifier) return;

  const normalizedTitle = normalizeTrackTitle(title);
  const normalizedCreator = normalizeTrackCreator(creator);
  const shareUrl = buildShareUrl(identifier, trackIndex);
  const imageUrl = `https://archive.org/services/img/${identifier}`;

  const displayTitle = normalizedCreator ? `${normalizedTitle} - ${normalizedCreator}` : normalizedTitle;
  const description = normalizedCreator
    ? `Listen to "${normalizedTitle}" by ${normalizedCreator} on Resonate Player. Free music from archive.org.`
    : `Listen to "${normalizedTitle}" on Resonate Player. Free music from archive.org.`;

  document.title = `${displayTitle} | Resonate Player`;

  // Open Graph tags for Facebook, LinkedIn, etc.
  updateMetaTag('property', 'og:title', displayTitle);
  updateMetaTag('property', 'og:description', description);
  updateMetaTag('property', 'og:image', imageUrl);
  updateMetaTag('property', 'og:url', shareUrl);
  updateMetaTag('property', 'og:type', 'music.song');

  // Twitter Card tags
  updateMetaTag('property', 'twitter:card', 'summary_large_image');
  updateMetaTag('property', 'twitter:title', displayTitle);
  updateMetaTag('property', 'twitter:description', description);
  updateMetaTag('property', 'twitter:image', imageUrl);
  updateMetaTag('property', 'twitter:url', shareUrl);

  // Basic meta description
  updateMetaTag('name', 'description', description);

  window.logger?.debug({ 
    message: 'Meta tags updated for sharing', 
    title: normalizedTitle, 
    creator: normalizedCreator, 
    imageUrl, 
    shareUrl 
  }, 'NETWORK');
}

/**
 * Helper function to update or create meta tags in the document head
 * 
 * @param {string} attrName - The attribute name ('property' or 'name')
 * @param {string} attrValue - The attribute value (e.g., 'og:title')
 * @param {string} content - The content for the meta tag
 */
function updateMetaTag(attrName, attrValue, content) {
  let metaTag = document.querySelector(`meta[${attrName}="${attrValue}"]`);

  if (metaTag) {
    metaTag.setAttribute('content', content);
  } else {
    metaTag = document.createElement('meta');
    metaTag.setAttribute(attrName, attrValue);
    metaTag.setAttribute('content', content);
    document.head.appendChild(metaTag);
  }
}

/**
 * Updates meta tags using track object and identifier
 * Wrapper around applyTrackMetaTagsForIdentifier
 * 
 * @param {Object} track - The track object with title, creator, trackIndex
 * @param {string} identifier - The Archive.org identifier
 */
function updateMetaTags(track, identifier) {
  if (!track || !identifier) return;
  const trackIndex = typeof track.trackIndex === 'number' && isFinite(track.trackIndex) ? track.trackIndex : null;
  applyTrackMetaTagsForIdentifier(identifier, track.title, track.creator, trackIndex);
}

/**
 * Fetches cover image from Archive.org for sharing
 * 
 * @param {string} identifier - The Archive.org identifier
 * @returns {Promise<File|null>} A File object suitable for Web Share API, or null if unavailable
 */
async function getCoverImageForSharing(identifier) {
  const coverUrl = `https://archive.org/services/img/${identifier}`;

  try {
    const response = await fetch(coverUrl);
    if (!response.ok) {
      window.logger?.warn({ 
        message: 'Cover image request failed', 
        status: response.status, 
        identifier 
      }, 'NETWORK');
      return null;
    }

    const blob = await response.blob();

    if (!blob || !blob.size) {
      return null;
    }

    // Determine file extension based on blob type
    const mimeType = blob.type || 'image/jpeg';
    const extension = mimeType.split('/')[1] || 'jpg';
    const filename = `${identifier}.${extension}`;

    // Create a File object from the blob
    const file = new File([blob], filename, { type: mimeType });
    return file;
  } catch (error) {
    window.logger?.warn({ 
      message: 'Error fetching cover image for sharing', 
      error, 
      identifier 
    }, 'NETWORK');
    return null;
  }
}

/**
 * Shares a track or album using Web Share API or clipboard fallback
 * 
 * This is the main sharing function that handles:
 * - Building the share message and URL
 * - Fetching cover image
 * - Attempting Web Share API with cover image
 * - Falling back to Web Share API without cover if file sharing unsupported
 * - Falling back to clipboard copy if Web Share unavailable
 * - Showing appropriate user feedback
 * 
 * @param {string} identifier - The Archive.org identifier
 * @param {string} title - The track/album title
 * @param {string|null} creator - The artist/creator name
 * @param {string|null} albumTitle - The album title (for tracks)
 * @param {string} kind - Either 'track' or 'album'
 * @param {number|null} trackIndex - Optional track index for album tracks
 * 
 * @example
 * // Share a single track
 * await shareTrack('track-123', 'Amazing Song', 'Artist Name', null, 'track', null);
 * 
 * @example
 * // Share an album
 * await shareTrack('album-456', 'Great Album', 'Band Name', null, 'album', null);
 * 
 * @example
 * // Share a specific track from an album
 * await shareTrack('album-789', 'Track Title', 'Artist', 'Album Title', 'track', 3);
 */
async function shareTrack(identifier, title = 'Track', creator = null, albumTitle = null, kind = 'track', trackIndex = null) {
  if (!identifier) {
    showStatus('Nothing to share right now', 'warning');
    return;
  }

  const shareKind = kind === 'album' ? 'album' : 'track';

  const normalizedTrackTitle = normalizeTrackTitle(title);

  // Resolve creator from state if not provided
  let resolvedCreator = creator;
  if (resolvedCreator === null || resolvedCreator === undefined) {
    try {
      if (window.state && window.state.currentTrack && window.state.currentTrack.id === identifier) {
        resolvedCreator = window.state.currentTrack.creator;
      }
    } catch {}
  }
  resolvedCreator = normalizeTrackCreator(resolvedCreator);

  // Resolve album title from state if not provided
  let resolvedAlbumTitle = albumTitle;
  if (resolvedAlbumTitle === null || resolvedAlbumTitle === undefined) {
    try {
      if (window.state && window.state.currentTrack && window.state.currentTrack.id === identifier) {
        resolvedAlbumTitle = window.state.currentTrack.albumTitle || window.state.currentTrack.album || '';
      }
    } catch {}
  }
  const normalizedAlbumTitle = typeof resolvedAlbumTitle === 'string' ? resolvedAlbumTitle.trim() : '';
  const includeAlbumTitle = !!(
    normalizedAlbumTitle &&
    normalizedAlbumTitle.toLowerCase() !== normalizedTrackTitle.toLowerCase()
  );

  // Resolve track index from state if not provided
  let resolvedTrackIndex = trackIndex;
  if (resolvedTrackIndex === null || resolvedTrackIndex === undefined) {
    try {
      if (shareKind === 'track' && includeAlbumTitle && window.state && window.state.currentTrack && window.state.currentTrack.id === identifier) {
        resolvedTrackIndex = window.state.currentTrack.trackIndex;
      }
    } catch {}
  }
  if (!(typeof resolvedTrackIndex === 'number' && isFinite(resolvedTrackIndex) && resolvedTrackIndex >= 0)) {
    resolvedTrackIndex = null;
  }

  // Only include track index in URL for individual tracks from albums
  const shareUrlTrackIndex = (shareKind === 'track' && includeAlbumTitle) ? resolvedTrackIndex : null;

  // Build share URL and message
  const shareUrl = buildShareUrl(identifier, shareUrlTrackIndex);
  const shareDataTitle = shareKind === 'album'
    ? normalizedTrackTitle
    : (includeAlbumTitle ? `${normalizedAlbumTitle} — ${normalizedTrackTitle}` : normalizedTrackTitle);

  // Build share text with appropriate formatting
  const textParts = [];
  if (shareKind === 'album') {
    textParts.push('You might like this album!');
    textParts.push(`"${normalizedTrackTitle}"`);
  } else {
    textParts.push('You might like this!');
    textParts.push(`"${normalizedTrackTitle}"`);
    if (includeAlbumTitle) textParts.push(normalizedAlbumTitle);
  }

  if (resolvedCreator) textParts.push(resolvedCreator);
  textParts.push('Enjoy it freely on Resonate Player');
  const shareText = textParts.join('\n\n');

  window.logger?.debug({
    message: 'Attempting to share',
    shareUrl,
    title: shareDataTitle,
    shareText,
    creator: resolvedCreator,
    albumTitle: normalizedAlbumTitle,
    kind: shareKind,
    trackIndex: shareUrlTrackIndex
  }, 'NETWORK');

  // Keep meta tags in sync for rich previews
  applyTrackMetaTagsForIdentifier(identifier, shareDataTitle, resolvedCreator, shareUrlTrackIndex);

  // Check share capabilities
  const { canShare, canCopy } = getShareCapabilities();
  if (!canShare) {
    if (canCopy) {
      const copied = await tryCopyToClipboard(shareUrl);
      if (copied) {
        showStatus('Link copied to clipboard', 'info', 4000);
        return;
      }
    }
    window.logger?.info('Web Share API not available', 'SYSTEM');
    showStatus('Sharing not available', 'warning', 4000);
    return;
  }

  // Try to get cover image for sharing
  let coverFile = null;
  try {
    coverFile = await getCoverImageForSharing(identifier);
    window.logger?.debug('Cover image obtained for sharing', 'NETWORK');
  } catch (error) {
    window.logger?.warn({ message: 'Could not get cover image', error }, 'NETWORK');
  }

  // Helper to check if share was cancelled by user
  const isShareCancelled = (err) => {
    return !!(err && (err.name === 'AbortError' || err.name === 'NotAllowedError'));
  };

  // Helper to check if error is likely due to file sharing not being supported
  const isLikelyFileShareUnsupported = (err) => {
    if (!err) return false;
    const name = typeof err.name === 'string' ? err.name : '';
    if (name === 'TypeError' || name === 'NotSupportedError' || name === 'DataError') return true;

    const message = typeof err.message === 'string' ? err.message : '';
    return /\b(files?|file)\b/i.test(message) || /canShare/i.test(message);
  };

  try {
    window.logger?.debug('Using Web Share API with enriched message', 'NETWORK');

    const baseShareData = {
      title: shareDataTitle,
      text: shareText,
      url: shareUrl
    };

    // Try to share with cover image first
    if (coverFile) {
      try {
        window.logger?.debug('Attempting to include cover image in share', 'NETWORK');
        await navigator.share({ ...baseShareData, files: [coverFile] });
        window.logger?.info('Web Share API success (with cover file)', 'NETWORK');
        showStatus('Track shared successfully', 'info', 6000);
        return;
      } catch (errorWithFile) {
        // User cancelled - exit silently
        if (isShareCancelled(errorWithFile)) {
          return;
        }

        // If file sharing isn't supported, retry once without the cover
        if (isLikelyFileShareUnsupported(errorWithFile)) {
          try {
            window.logger?.debug('File share unsupported, retrying without cover', 'NETWORK');
            await navigator.share(baseShareData);
            window.logger?.info('Web Share API success (without cover)', 'NETWORK');
            showStatus('Track shared successfully', 'info', 6000);
            return;
          } catch (errorWithoutFile) {
            if (isShareCancelled(errorWithoutFile)) {
              return;
            }
            window.logger?.warn({ message: 'Web Share API failed', error: errorWithoutFile }, 'NETWORK');
            showStatus('Sharing not available', 'warning', 4000);
            return;
          }
        }

        window.logger?.warn({ message: 'Web Share API failed', error: errorWithFile }, 'NETWORK');
        showStatus('Sharing not available', 'warning', 4000);
        return;
      }
    }

    // Share without cover image
    await navigator.share(baseShareData);
    window.logger?.info('Web Share API success', 'NETWORK');
    showStatus('Track shared successfully', 'info', 6000);
  } catch (error) {
    // If user cancels, don't spam with messages
    if (isShareCancelled(error)) {
      return;
    }
    window.logger?.warn({ message: 'Web Share API failed', error }, 'NETWORK');
    showStatus('Sharing not available', 'warning', 4000);
  }
}

/**
 * Detects the device's sharing capabilities
 * 
 * @returns {{canShare: boolean, canCopy: boolean}} Object indicating available capabilities
 */
function getShareCapabilities() {
  const canShare = !!(navigator.share && typeof navigator.share === 'function');
  
  let canCopy = false;
  try {
    canCopy = !!(
      (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') ||
      (document.queryCommandSupported && document.queryCommandSupported('copy'))
    );
  } catch {}
  
  return { canShare, canCopy };
}

/**
 * Attempts to copy text to clipboard
 * 
 * @param {string} text - The text to copy
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function tryCopyToClipboard(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
    
    // Fallback to document.execCommand
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch {
    return false;
  }
}

// Expose functions to window for use by other modules
window.buildShareUrl = buildShareUrl;
window.shareTrack = shareTrack;
window.getShareCapabilities = getShareCapabilities;
window.updateMetaTags = updateMetaTags;
window.applyTrackMetaTagsForIdentifier = applyTrackMetaTagsForIdentifier;
