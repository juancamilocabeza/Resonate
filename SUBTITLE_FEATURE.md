# Subtitle Feature

## Status: DISABLED

This feature has been disabled because it was incorrectly using microphone access via the Web Speech API to transcribe ambient audio, rather than providing proper subtitles for the audio content being played.

## Previous Implementation (Removed)
The previous implementation attempted real-time audio transcription using the Web Speech API, but this approach had a fundamental flaw: it accessed the user's microphone to transcribe ambient sound instead of providing actual subtitles for the audio content.

## Implementation Details

### Core Components

1. **subtitle-manager.js** - Main module that handles:
   - Web Speech API integration
   - Real-time speech recognition
   - Subtitle display management
   - User preferences persistence
   - Error handling and auto-restart
   - Language support

2. **HTML Changes** (index.html):
   - Subtitle display container (dynamically created)
   - CC toggle button removed (subtitles are now auto-enabled)

3. **CSS Styles** (resonate.css):
   - Subtitle display styling with backdrop blur
   - Toggle button active/inactive states
   - Mobile-responsive design
   - High contrast mode support
   - Reduced motion support

4. **UI Integration** (ui.js):
   - No longer needs special handling for subtitle toggle
   - Subtitles are auto-enabled when supported

5. **Service Worker** (sw.js):
   - Cache subtitle-manager.js for offline availability

### Features

✅ **Real-time Transcription**: Uses browser's native speech recognition API  
✅ **Auto-enabled**: Subtitles are automatically enabled when supported
✅ **Persistent Preferences**: Saves subtitle state in localStorage  
✅ **Multi-language Support**: Automatically uses browser language or custom setting  
✅ **Auto-restart**: Automatically recovers from network errors  
✅ **Accessibility**: Full ARIA support for screen readers  
✅ **Mobile Optimized**: Works on both desktop and mobile browsers  
✅ **Error Handling**: Clear user feedback for permission issues  

### Browser Support

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome Desktop | ✅ Full | Best performance |
| Chrome Mobile | ✅ Full | Requires microphone permission |
| Edge Desktop | ✅ Full | Chromium-based |
| Safari Desktop | ✅ Full | macOS 10.15+ |
| Safari Mobile | ✅ Full | iOS 14.5+ |
| Firefox | ⚠️ Limited | Experimental support |

### Why This Was Disabled

The previous implementation had the following issues:
1. **Incorrect approach**: Used microphone to listen to ambient audio instead of transcribing the actual audio being played
2. **Privacy concern**: Requested microphone access when it should not have been necessary
3. **Not actual subtitles**: Was transcribing environmental sounds, not the audio content itself

### Future Implementation Considerations

For proper subtitle support, consider:
- Using actual subtitle files (WebVTT, SRT) from content providers
- Implementing HTML5 `<track>` element for subtitle display
- No microphone access should be required for displaying subtitles
- Subtitles should be synchronized with the audio/video content metadata

## Previous Technical Details (Removed Implementation)

The previous implementation used the Web Speech API for speech recognition, which required microphone access. This has been removed.
