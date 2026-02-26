# Sharing Feature with Cover Art

## Overview

The Resonate Player supports sharing tracks and albums via the Web Share API, including their cover art when possible.

## Implementation

### How It Works

When a user shares a track or album:

1. **Cover Art Fetching**: The `CoverManager.getCoverImageForSharing()` function fetches the cover art from Archive.org as a File object
2. **Web Share API**: The app attempts to share using `navigator.share()` with the cover art file included
3. **Fallback Handling**: If file sharing is not supported, the app automatically retries without the cover art file
4. **Clipboard Fallback**: If the Web Share API is not available, the app falls back to copying the share link to the clipboard

### Code Location

- **Main Sharing Function**: `js/ui.js` - `shareTrack()` function
- **Cover Art Fetching**: `js/cover-manager.js` - `getCoverImageForSharing()` function

### Key Features

- **Automatic Detection**: The app automatically detects if the Web Share API and file sharing are supported
- **Graceful Degradation**: If cover art fails to load or file sharing is not supported, sharing still works without the image
- **Caching**: Cover art URLs are cached to improve performance
- **Error Handling**: All errors are logged and handled gracefully without breaking the sharing flow

## Browser Support

The cover art sharing feature requires:
- Web Share API support (`navigator.share`)
- File sharing support (included in Web Share API Level 2)

### Supported Browsers

- Chrome/Edge 89+ (Android, Windows 11)
- Safari 15+ (iOS/iPadOS, macOS)
- Firefox (limited support, depends on platform)

### Fallback Behavior

If the browser doesn't support file sharing:
- The track/album is shared without the cover art
- The share link still includes all metadata (title, artist, URL)
- Users can still access the shared content

## Testing

To test the feature manually:

1. Open Resonate Player in a supported browser
2. Search for any track or album
3. Click the share button
4. Verify that the cover art appears in the native share sheet

## Technical Details

### Cover Art Format

- **Source**: `https://archive.org/services/img/{identifier}`
- **Format**: JPEG or PNG (automatically detected from response)
- **Filename**: `cover-{identifier}.jpg`
- **Size**: Variable (optimized by Archive.org)

### Implementation Notes

- Cover art is fetched asynchronously before sharing
- The fetch operation has a reasonable timeout
- Errors in cover art fetching don't prevent sharing
- The implementation uses the centralized `CoverManager` module for consistency

## Future Enhancements

Possible improvements:
- Add cover art size/quality options
- Implement local caching of cover art files
- Support custom cover art from user uploads
- Add preview before sharing
