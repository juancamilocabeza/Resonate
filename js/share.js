(() => {
  function normalizeTrackTitle(title) {
    const normalized = typeof title === 'string' ? title.trim() : '';
    return normalized || 'Track';
  }

  function normalizeTrackCreator(creator) {
    return typeof creator === 'string' ? creator.trim() : '';
  }

  function getCanonicalShareOrigin() {
    try {
      const origin = String(window.location.origin || '').trim();
      const hostname = String(window.location.hostname || '').trim().toLowerCase();
      if (hostname === 'resonateplayer.com' || hostname === 'www.resonateplayer.com') {
        return 'https://www.resonateplayer.com';
      }
      return origin;
    } catch {
      return window.location.origin;
    }
  }

  function buildShareUrl(identifier, trackIndex = null) {
    const baseUrl = new URL(getCanonicalShareOrigin());
    baseUrl.hash = '';
    baseUrl.search = '';
    baseUrl.pathname = '/';

    const params = new URLSearchParams();
    params.set('play', identifier);

    const index = typeof trackIndex === 'number' && Number.isFinite(trackIndex) && trackIndex >= 0
      ? Math.floor(trackIndex)
      : null;
    if (index !== null) params.set('t', String(index));

    baseUrl.search = params.toString();
    return baseUrl.toString();
  }

  function updateMetaTag(attrName, attrValue, content) {
    let metaTag = document.querySelector(`meta[${attrName}="${attrValue}"]`);
    if (metaTag) {
      metaTag.setAttribute('content', content);
      return;
    }

    metaTag = document.createElement('meta');
    metaTag.setAttribute(attrName, attrValue);
    metaTag.setAttribute('content', content);
    document.head.appendChild(metaTag);
  }

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

    updateMetaTag('property', 'og:title', displayTitle);
    updateMetaTag('property', 'og:description', description);
    updateMetaTag('property', 'og:image', imageUrl);
    updateMetaTag('property', 'og:url', shareUrl);
    updateMetaTag('property', 'og:type', 'music.song');
    updateMetaTag('property', 'twitter:card', 'summary_large_image');
    updateMetaTag('property', 'twitter:title', displayTitle);
    updateMetaTag('property', 'twitter:description', description);
    updateMetaTag('property', 'twitter:image', imageUrl);
    updateMetaTag('property', 'twitter:url', shareUrl);
    updateMetaTag('name', 'description', description);

    window.logger?.debug({
      message: 'Meta tags updated for sharing',
      title: normalizedTitle,
      creator: normalizedCreator,
      imageUrl,
      shareUrl
    }, 'NETWORK');
  }

  function updateMetaTags(track, identifier) {
    if (!track || !identifier) return;
    const trackIndex = typeof track.trackIndex === 'number' && Number.isFinite(track.trackIndex)
      ? track.trackIndex
      : null;
    applyTrackMetaTagsForIdentifier(identifier, track.title, track.creator, trackIndex);
  }

  function getShareCapabilities() {
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const canCopy = (() => {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') return true;
        return !!(document && typeof document.queryCommandSupported === 'function' && document.queryCommandSupported('copy'));
      } catch {
        return false;
      }
    })();
    return { canShare, canCopy };
  }

  async function getCoverImageForSharing(identifier) {
    const coverUrl = `https://archive.org/services/img/${identifier}`;
    try {
      const response = await fetch(coverUrl);
      if (!response.ok) {
        window.logger?.warn({ message: 'Cover image request failed', status: response.status, identifier }, 'NETWORK');
        return null;
      }

      const blob = await response.blob();
      if (!blob || !blob.size || typeof File === 'undefined') return null;

      const filename = `cover-${identifier}.jpg`;
      const blobType = typeof blob.type === 'string' ? blob.type : '';
      const fileType = blobType.startsWith('image/') ? blobType : 'image/jpeg';
      return new File([blob], filename, { type: fileType });
    } catch (error) {
      window.logger?.warn({ message: 'Cover image fetch failed (continuing without image)', error }, 'NETWORK');
      return null;
    }
  }

  async function tryCopyToClipboard(text) {
    if (!text) return false;

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall back to the legacy copy API.
    }

    let area;
    try {
      area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      area.style.pointerEvents = 'none';
      document.body.appendChild(area);
      area.select();
      return !!document.execCommand('copy');
    } catch {
      return false;
    } finally {
      if (area && area.parentNode) area.remove();
    }
  }

  function trackShareEvent(method, contentType, itemId) {
    try {
      if (window.ResonateAnalytics && typeof window.ResonateAnalytics.trackShare === 'function') {
        window.ResonateAnalytics.trackShare({
          method,
          content_type: contentType,
          item_id: itemId
        });
      }
    } catch {}
  }

  function isShareCancelled(error) {
    return !!(error && (error.name === 'AbortError' || error.name === 'NotAllowedError'));
  }

  function isLikelyFileShareUnsupported(error) {
    if (!error) return false;
    const name = typeof error.name === 'string' ? error.name : '';
    if (name === 'TypeError' || name === 'NotSupportedError' || name === 'DataError') return true;

    const message = typeof error.message === 'string' ? error.message : '';
    return /\b(files?|file)\b/i.test(message) || /canShare/i.test(message);
  }

  async function shareTrack(identifier, title = 'Track', creator = null, albumTitle = null, kind = 'track', trackIndex = null) {
    if (!identifier) {
      window.showStatus('Nothing to share right now', 'warning');
      return;
    }

    const shareKind = kind === 'album' ? 'album' : 'track';
    const normalizedTrackTitle = normalizeTrackTitle(title);
    const currentTrack = window.state?.currentTrack;
    const isCurrentTrack = currentTrack && currentTrack.id === identifier;
    const resolvedCreator = normalizeTrackCreator(
      creator == null && isCurrentTrack ? currentTrack.creator : creator
    );
    const resolvedAlbumTitle = albumTitle == null && isCurrentTrack
      ? currentTrack.albumTitle || currentTrack.album || ''
      : albumTitle;
    const normalizedAlbumTitle = typeof resolvedAlbumTitle === 'string' ? resolvedAlbumTitle.trim() : '';
    const includeAlbumTitle = !!(
      normalizedAlbumTitle &&
      normalizedAlbumTitle.toLowerCase() !== normalizedTrackTitle.toLowerCase()
    );

    let resolvedTrackIndex = trackIndex;
    if (resolvedTrackIndex == null && shareKind === 'track' && includeAlbumTitle && isCurrentTrack) {
      resolvedTrackIndex = currentTrack.trackIndex;
    }
    if (!(typeof resolvedTrackIndex === 'number' && Number.isFinite(resolvedTrackIndex) && resolvedTrackIndex >= 0)) {
      resolvedTrackIndex = null;
    }

    const shareUrlTrackIndex = shareKind === 'track' && includeAlbumTitle ? resolvedTrackIndex : null;
    const shareUrl = buildShareUrl(identifier, shareUrlTrackIndex);
    const shareDataTitle = shareKind === 'album'
      ? normalizedTrackTitle
      : (includeAlbumTitle ? `${normalizedAlbumTitle} — ${normalizedTrackTitle}` : normalizedTrackTitle);
    const textParts = shareKind === 'album'
      ? ['You might like this album!', `"${normalizedTrackTitle}"`]
      : ['You might like this!', `"${normalizedTrackTitle}"`];

    if (shareKind === 'track' && includeAlbumTitle) textParts.push(normalizedAlbumTitle);
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

    applyTrackMetaTagsForIdentifier(identifier, shareDataTitle, resolvedCreator, shareUrlTrackIndex);

    const { canShare, canCopy } = getShareCapabilities();
    if (!canShare) {
      if (canCopy && await tryCopyToClipboard(shareUrl)) {
        trackShareEvent('copy_link', shareKind, identifier);
        window.showStatus('Link copied to clipboard', 'info', 4000);
        return;
      }
      window.logger?.info('Web Share API no disponible', 'SYSTEM');
      window.showStatus('Sharing not available', 'warning', 4000);
      return;
    }

    let coverFile = null;
    try {
      if (window.CoverManager && typeof window.CoverManager.getCoverImageForSharing === 'function') {
        coverFile = await window.CoverManager.getCoverImageForSharing(identifier);
      } else {
        coverFile = await getCoverImageForSharing(identifier);
      }
      window.logger?.debug('Cover image obtained for sharing', 'NETWORK');
    } catch (error) {
      window.logger?.warn({ message: 'Could not get cover image', error }, 'NETWORK');
    }

    const baseShareData = { title: shareDataTitle, text: shareText, url: shareUrl };
    window.logger?.debug('Using Web Share API with enriched message', 'NETWORK');
    trackShareEvent('web_share', shareKind, identifier);

    if (coverFile) {
      try {
        window.logger?.debug('Attempting to include cover image in share', 'NETWORK');
        await navigator.share({ ...baseShareData, files: [coverFile] });
        window.logger?.info('Web Share API success (with cover file)', 'NETWORK');
        window.showStatus('Track shared successfully', 'info', 6000);
        return;
      } catch (errorWithFile) {
        if (isShareCancelled(errorWithFile)) return;
        if (isLikelyFileShareUnsupported(errorWithFile)) {
          try {
            window.logger?.debug('File share unsupported, retrying without cover', 'NETWORK');
            await navigator.share(baseShareData);
            window.logger?.info('Web Share API success (without cover)', 'NETWORK');
            window.showStatus('Track shared successfully', 'info', 6000);
            return;
          } catch (errorWithoutFile) {
            if (isShareCancelled(errorWithoutFile)) return;
            window.logger?.warn({ message: 'Web Share API failed', error: errorWithoutFile }, 'NETWORK');
            window.showStatus('Sharing not available', 'warning', 4000);
            return;
          }
        }

        window.logger?.warn({ message: 'Web Share API failed', error: errorWithFile }, 'NETWORK');
        window.showStatus('Sharing not available', 'warning', 4000);
        return;
      }
    }

    try {
      await navigator.share(baseShareData);
      window.logger?.info('Web Share API success', 'NETWORK');
      window.showStatus('Track shared successfully', 'info', 6000);
    } catch (error) {
      if (isShareCancelled(error)) return;
      window.logger?.warn({ message: 'Web Share API failed', error }, 'NETWORK');
      window.showStatus('Sharing not available', 'warning', 4000);
    }
  }

  function updateMetaTagsForSharing(identifier, title, creator = '') {
    applyTrackMetaTagsForIdentifier(identifier, title, creator);
  }

  const shareModule = {
    shareTrack,
    buildShareUrl,
    applyTrackMetaTagsForIdentifier,
    updateMetaTags,
    updateMetaTagsForSharing,
    getShareCapabilities,
    getCoverImageForSharing,
    tryCopyToClipboard
  };

  window.ResonateShare = shareModule;
  window.shareTrack = shareTrack;
  window.buildShareUrl = buildShareUrl;
  window.getShareCapabilities = getShareCapabilities;
  window.applyTrackMetaTagsForIdentifier = applyTrackMetaTagsForIdentifier;
  window.updateMetaTags = updateMetaTags;
  window.updateMetaTagsForSharing = updateMetaTagsForSharing;
  window.getCoverImageForSharing = getCoverImageForSharing;
  window.tryCopyToClipboard = tryCopyToClipboard;
})();
