# Share Module Documentation

## Overview

The Share module is a core feature of Resonate Player that enables users to share music tracks and albums with others. It provides a seamless sharing experience across different platforms and devices with intelligent fallback mechanisms.

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [API Reference](#api-reference)
4. [Integration Guide](#integration-guide)
5. [Testing](#testing)
6. [Browser Compatibility](#browser-compatibility)
7. [Troubleshooting](#troubleshooting)

## Features

### Core Functionality

- **Web Share API Integration**: Native sharing to Messages, Email, Social Media, etc.
- **Clipboard Fallback**: Automatic fallback when Web Share API is unavailable
- **Cover Image Sharing**: Includes album artwork when supported by the platform
- **Rich Social Previews**: Open Graph and Twitter Card support for beautiful link previews
- **Track Index Support**: Share specific tracks from albums
- **Graceful Degradation**: Handles unsupported features elegantly

### User Experience

- **Smart Button States**: Share button adapts to show share icon, copy icon, or disabled state
- **Status Feedback**: Clear user messages for all sharing outcomes
- **Shared Link Handling**: Auto-plays shared content when users open shared links
- **PWA Integration**: "Open in App" banner for users who receive shared links

## Architecture

### Module Structure

```
js/
├── share.js              # Main share module (new standalone file)
├── ui.js                 # UI components (contains legacy share code)
└── initialization.js     # Shared link handling on app startup

tests/
└── share.spec.js         # Comprehensive share module tests
```

### Key Components

#### 1. URL Building

```javascript
buildShareUrl(identifier, trackIndex = null)
```

Creates shareable URLs with format:
- Single track: `https://www.resonateplayer.com/?play={identifier}`
- Album track: `https://www.resonateplayer.com/?play={identifier}&t={trackIndex}`

#### 2. Sharing Flow

```
User clicks share
    ↓
shareTrack() called
    ↓
Resolve metadata (title, creator, album)
    ↓
Build share URL
    ↓
Fetch cover image (async)
    ↓
Update meta tags for social previews
    ↓
Try Web Share API with cover
    ↓ (if fails)
Retry Web Share API without cover
    ↓ (if fails)
Fallback to clipboard copy
    ↓
Show user feedback
```

#### 3. Receiving Shared Links

```
User opens shared link
    ↓
handleSharedLink() detects ?play parameter
    ↓
Show "Open in App" banner (if in browser)
    ↓
Update meta tags for the shared content
    ↓
playSharedContent() loads and plays track
    ↓
Clean URL (remove ?play parameter)
```

## API Reference

### Core Functions

#### `buildShareUrl(identifier, trackIndex)`

Builds a shareable URL for a track or album.

**Parameters:**
- `identifier` (string): Archive.org identifier
- `trackIndex` (number|null): Optional 0-based track index

**Returns:** (string) Complete shareable URL

**Example:**
```javascript
const url = buildShareUrl('track-123');
// => 'https://www.resonateplayer.com/?play=track-123'

const urlWithTrack = buildShareUrl('album-456', 3);
// => 'https://www.resonateplayer.com/?play=album-456&t=3'
```

#### `shareTrack(identifier, title, creator, albumTitle, kind, trackIndex)`

Main sharing function that handles the complete share flow.

**Parameters:**
- `identifier` (string): Archive.org identifier
- `title` (string): Track or album title
- `creator` (string|null): Artist/creator name
- `albumTitle` (string|null): Album title (for tracks)
- `kind` (string): 'track' or 'album'
- `trackIndex` (number|null): Track index for album tracks

**Returns:** (Promise<void>)

**Example:**
```javascript
// Share a track
await shareTrack('track-123', 'Amazing Song', 'Artist Name', null, 'track', null);

// Share an album
await shareTrack('album-456', 'Great Album', 'Band Name', null, 'album', null);

// Share a specific track from an album
await shareTrack('album-789', 'Track 5', 'Artist', 'Album Title', 'track', 4);
```

#### `getShareCapabilities()`

Detects available sharing methods on the current device.

**Returns:** Object with:
- `canShare` (boolean): Web Share API available
- `canCopy` (boolean): Clipboard API available

**Example:**
```javascript
const { canShare, canCopy } = getShareCapabilities();
if (canShare) {
  console.log('Can use Web Share API');
} else if (canCopy) {
  console.log('Can copy to clipboard');
} else {
  console.log('No sharing available');
}
```

#### `updateMetaTags(track, identifier)`

Updates Open Graph and Twitter Card meta tags for rich social previews.

**Parameters:**
- `track` (Object): Track object with title, creator, trackIndex
- `identifier` (string): Archive.org identifier

**Example:**
```javascript
updateMetaTags({
  title: 'Amazing Song',
  creator: 'Artist Name',
  trackIndex: 0
}, 'track-123');
```

### Helper Functions

#### `applyTrackMetaTagsForIdentifier(identifier, title, creator, trackIndex)`

Low-level function to update meta tags with explicit parameters.

#### `getCoverImageForSharing(identifier)`

Fetches cover image from Archive.org as a File object.

**Returns:** (Promise<File|null>)

#### `tryCopyToClipboard(text)`

Attempts to copy text to clipboard with fallback.

**Returns:** (Promise<boolean>)

## Integration Guide

### Adding Share Buttons

Share buttons should have these attributes:

```html
<button 
  id="share-button"
  role="button"
  tabindex="0"
  aria-label="Share this track"
  data-share-mode="share"
>
  <span class="icon-share"></span>
</button>
```

### Button Click Handler

```javascript
shareButton.addEventListener('click', async () => {
  await shareTrack(
    currentTrack.id,
    currentTrack.title,
    currentTrack.creator,
    currentTrack.album,
    'track',
    currentTrack.trackIndex
  );
});
```

### Updating Button State

Call after page load and when capabilities change:

```javascript
function updateShareButtonState() {
  const { canShare, canCopy } = getShareCapabilities();
  const button = document.getElementById('share-button');
  
  if (canShare) {
    button.setAttribute('data-share-mode', 'share');
    button.setAttribute('aria-label', 'Share this track');
  } else if (canCopy) {
    button.setAttribute('data-share-mode', 'copy');
    button.setAttribute('aria-label', 'Copy link to clipboard');
  } else {
    button.setAttribute('data-share-mode', 'disabled');
    button.setAttribute('aria-disabled', 'true');
  }
}
```

## Testing

### Running Tests

```bash
# Run all tests including share module tests
npm test

# Run only share module tests
npx playwright test tests/share.spec.js

# Run tests in UI mode for debugging
npm run test:ui
```

### Test Coverage

The share module has comprehensive test coverage including:

- **URL Building**: Various identifier and track index combinations
- **Capabilities Detection**: Web Share API, clipboard, and no sharing scenarios
- **Button States**: Proper icon and state based on capabilities
- **Shared Link Handling**: URL parameter detection and processing
- **Meta Tags**: Open Graph and Twitter Card tag presence and content
- **Error Handling**: Missing/empty identifiers and edge cases
- **Integration**: Share button visibility and ARIA attributes

### Manual Testing Checklist

- [ ] Share button visible in player header
- [ ] Share button shows correct icon (share/copy/disabled)
- [ ] Click share button opens native share sheet (mobile)
- [ ] Shared link opens and auto-plays content
- [ ] Cover image included in share when supported
- [ ] Clipboard fallback works when Web Share unavailable
- [ ] Status messages shown for all outcomes
- [ ] Shared links show rich previews on social media

## Browser Compatibility

### Web Share API Support

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 61+ | ✅ (Android), ✅ 89+ (Desktop) |
| Safari | 12.1+ | ✅ |
| Firefox | ❌ | Uses clipboard fallback |
| Edge | 79+ | ✅ |

### Clipboard API Support

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 43+ | ✅ |
| Safari | 10+ | ✅ |
| Firefox | 41+ | ✅ |
| Edge | 12+ | ✅ |

### Fallback Chain

1. **Web Share API with cover image** (preferred)
2. **Web Share API without cover image** (if file sharing unsupported)
3. **Clipboard copy** (if Web Share unavailable)
4. **Show "not available" message** (if all fail)

## Troubleshooting

### Common Issues

#### Share button not visible

**Cause**: Button may be hidden or capabilities not detected
**Solution**: Check that `applyShareButtonState()` is called after page load

#### Cover image not included in share

**Cause**: Some browsers/apps don't support file sharing in Web Share API
**Solution**: Module automatically retries without cover - this is expected behavior

#### Shared links don't auto-play

**Cause**: `handleSharedLink()` not called on page load
**Solution**: Verify initialization.js is loaded and `handleSharedLink()` is invoked

#### Meta tags not updating

**Cause**: Meta tags may be cached or not properly set
**Solution**: Check browser dev tools for meta tag presence and content

### Debug Logging

The share module logs extensively when logger is available:

```javascript
// Enable debug logging
window.logger.setLevel('DEBUG');

// Share a track to see logs
await shareTrack('track-123', 'Test Track');
```

Log categories:
- `NETWORK`: Share API calls, cover image fetching
- `SYSTEM`: Capability detection, initialization

### Error Messages

| Message | Cause | Solution |
|---------|-------|----------|
| "Nothing to share right now" | No identifier provided | Ensure track is loaded before sharing |
| "Sharing not available" | No share or copy capability | Browser doesn't support sharing |
| "Link copied to clipboard" | Clipboard fallback used | Normal behavior when Web Share unavailable |
| "Track shared successfully" | Share completed | Success! |

## Best Practices

### 1. Always Provide Complete Metadata

```javascript
// Good
await shareTrack(track.id, track.title, track.creator, track.album, 'track', track.trackIndex);

// Bad - missing metadata
await shareTrack(track.id);
```

### 2. Update Meta Tags When Track Changes

```javascript
window.addEventListener('trackchange', (event) => {
  updateMetaTags(event.detail.track, event.detail.identifier);
});
```

### 3. Handle User Cancellation Gracefully

The share module automatically handles user cancellation (AbortError, NotAllowedError) without showing error messages - this is intentional.

### 4. Test on Real Devices

Web Share API behavior varies by platform and app. Test on:
- iOS Safari
- Android Chrome
- Desktop browsers
- Various share targets (Messages, Email, Social apps)

## Future Enhancements

Potential improvements for the share module:

- [ ] Share playlists/resonates
- [ ] Share with custom timestamps
- [ ] Analytics for share events
- [ ] QR code generation for sharing
- [ ] Deep linking for better app integration
- [ ] Share to specific platforms (WhatsApp, Telegram, etc.)

## Contributing

When contributing to the share module:

1. Add tests for new functionality in `tests/share.spec.js`
2. Update this documentation
3. Ensure backward compatibility
4. Test on multiple browsers and devices
5. Follow existing code style and patterns

## License

Part of Resonate Player - MIT License
