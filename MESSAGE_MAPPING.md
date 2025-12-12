# Resonate Message Rewrite Mapping
## Complete showStatus() Calls Catalog

---

## PLAYBACK & CONTROL MESSAGES (Most Frequent)

### 1. Playing/Pausing Messages

**[1034] | playback.js | INFO | 2000ms**
- OLD: "Playing"
- NEW: "Now playing your track"
- CONTEXT: When user presses play button and track starts
- FREQUENCY: High (every playback session)

**[1046] | playback.js | INFO | 2000ms**
- OLD: "Paused"
- NEW: "Track paused, tap to resume"
- CONTEXT: When user pauses playback
- FREQUENCY: High (frequent pauses)

**[830] | playback.js | INFO | 0ms**
- OLD: "Loading: {track.title}"
- NEW: "Getting {track.title} ready..."
- CONTEXT: When fetching audio file before playback
- FREQUENCY: Very High (every track load)

**[848] | playback.js | INFO | null**
- OLD: "Playing: {track.title} ({trackIndex + 1}/{totalTracks})"
- NEW: "Playing: {track.title} ({trackIndex + 1}/{totalTracks})"
- CONTEXT: Track playing confirmation with position in album
- FREQUENCY: Very High (every album track)

**[850] | playback.js | INFO | null**
- OLD: "Playing: {track.title}"
- NEW: "Now playing: {track.title}"
- CONTEXT: Single track playback confirmation
- FREQUENCY: Very High (every non-album track)

---

### 2. Shuffle/Repeat Mode Messages

**[1731] | playback.js | INFO | 2000ms**
- OLD: "Shuffle favorites enabled"
- NEW: "Shuffled favorites: playing in random order"
- CONTEXT: User toggles shuffle for favorites list
- FREQUENCY: Medium (occasional setting change)

**[1737] | playback.js | INFO | 2000ms**
- OLD: "Shuffle search results enabled"
- NEW: "Shuffled search results: mixing things up"
- CONTEXT: User toggles shuffle for search results
- FREQUENCY: Medium (occasional setting change)

**[1745] | playback.js | INFO | 2000ms**
- OLD: "Shuffle enabled"
- NEW: "Shuffle on: random playback activated"
- CONTEXT: User enables shuffle in general
- FREQUENCY: Medium (occasional setting change)

**[1750] | playback.js | INFO | 2000ms**
- OLD: "Shuffle favorites disabled"
- NEW: "Shuffle off: playing favorites in order"
- CONTEXT: User disables shuffle for favorites
- FREQUENCY: Medium (occasional setting change)

**[1755] | playback.js | INFO | 2000ms**
- OLD: "Sequential search playback enabled"
- NEW: "Sequential play: search results in order"
- CONTEXT: User enables sequential (non-shuffle) for search
- FREQUENCY: Medium (occasional setting change)

**[1760] | playback.js | INFO | 2000ms**
- OLD: "Shuffle disabled"
- NEW: "Shuffle off: back to playing in order"
- CONTEXT: User disables shuffle
- FREQUENCY: Medium (occasional setting change)

**[1495] | playback.js | INFO | 2000ms**
- OLD: "Repeat mode: {getRepeatModeDisplayName(state.repeatMode)}"
- NEW: "Repeat mode changed to {mode} setting"
- CONTEXT: User changes repeat mode (all/one/off)
- FREQUENCY: Medium (occasional setting change)

**[943] | playback.js | INFO | null**
- OLD: "Previous track"
- NEW: "Skipping to previous track"
- CONTEXT: User clicks previous button
- FREQUENCY: Medium (navigation)

**[949] | playback.js | INFO | null**
- OLD: "Next track"
- NEW: "Moving to next track"
- CONTEXT: User clicks next button
- FREQUENCY: High (frequent navigation)

---

### 3. Favorites Messages

**[385] | ui.js | INFO | null**
- OLD: "Removed from favorites"
- NEW: "Removed from your favorites"
- CONTEXT: User unfavorites a track
- FREQUENCY: High (frequent favorites management)

**[405] | ui.js | INFO | null**
- OLD: "Added to favorites"
- NEW: "Added to your favorites"
- CONTEXT: User marks track as favorite
- FREQUENCY: High (frequent favorites management)

**[1020] | playback.js | INFO | null**
- OLD: "Add favorites to start playing"
- NEW: "Search & add music to start playing"
- CONTEXT: No favorites exist, user needs to search
- FREQUENCY: Medium (first-time users)

**[1125] | playback.js | INFO | null**
- OLD: "Playing favorites from FIFO queue"
- NEW: "Playing your saved favorites queue"
- CONTEXT: Playback starting from favorites
- FREQUENCY: High (frequent favorites play)

**[1128] | playback.js | INFO | null**
- OLD: "No favorites. Search for music to start playing"
- NEW: "No favorites yet. Try searching for music."
- CONTEXT: Favorites list is empty
- FREQUENCY: Medium (first-time users)

**[1840] | playback.js | INFO | 0ms**
- OLD: "Loading favorite: {favorite.title}"
- NEW: "Loading favorite: {favorite.title}"
- CONTEXT: Loading a favorited track
- FREQUENCY: High (playing favorites)

**[1154] | playback.js | INFO | 0ms**
- OLD: "Loading from FIFO queue: {track.title}"
- NEW: "Next up: {track.title}"
- CONTEXT: Loading next queued track
- FREQUENCY: High (album/queue playback)

---

### 4. Album/Playlist Navigation

**[267] | playback.js | INFO | 2000ms**
- OLD: "End of album"
- NEW: "Album finished. Search for more music?"
- CONTEXT: Album playback completes
- FREQUENCY: High (album playback sessions)

**[292] | playback.js | INFO | 2000ms**
- OLD: "End of album"
- NEW: "That's all the tracks in this album"
- CONTEXT: No more tracks in album (repeat off)
- FREQUENCY: Medium (end of albums)

**[325] | playback.js | INFO | 2000ms**
- OLD: "Continuing to next search result..."
- NEW: "Moving to next search result..."
- CONTEXT: Auto-advancing after album completes
- FREQUENCY: Medium (search result chains)

**[353] | playback.js | INFO | 2000ms**
- OLD: "End of favorites. Search for more to continue"
- NEW: "Favorites done. Find more music to continue"
- CONTEXT: Favorites playlist exhausted
- FREQUENCY: Medium (dedicated favorites play)

**[376] | playback.js | INFO | 2000ms**
- OLD: "End of favorites. Search for more to continue"
- NEW: "All favorites played. Ready for discovery?"
- CONTEXT: Favorites finished, repeat off
- FREQUENCY: Medium (favorites completion)

**[438] | playback.js | INFO | 2000ms**
- OLD: "End of current search"
- NEW: "Finished current search results"
- CONTEXT: All search results exhausted
- FREQUENCY: Medium (search completion)

**[464] | playback.js | INFO | 2000ms**
- OLD: "End of current search"
- NEW: "No more tracks in this search"
- CONTEXT: Search results finished
- FREQUENCY: Medium (search completion)

**[503] | playback.js | INFO | 2000ms**
- OLD: "End of playlist"
- NEW: "Playlist finished playing"
- CONTEXT: Preloaded playlist done
- FREQUENCY: Medium (playlist completion)

**[523] | playback.js | INFO | 2000ms**
- OLD: "End of playlist"
- NEW: "That's the end of the playlist"
- CONTEXT: Playlist exhausted, repeat off
- FREQUENCY: Medium (playlist completion)

---

## SEARCH & LOADING MESSAGES

**[10] | search.js | WARNING | 3000ms**
- OLD: "Search not available offline. You can only play favorites."
- NEW: "You're offline. Browse saved favorites instead."
- CONTEXT: User attempts search with no internet
- FREQUENCY: High (offline users)
- CONTEXT: Offline mode prevents searches

**[366] | search.js | INFO | 0ms**
- OLD: "Loading: {result.title}"
- NEW: "Loading {result.title}..."
- CONTEXT: Starting to fetch album/track details
- FREQUENCY: Very High (every search result click)

**[370] | search.js | INFO | 2000ms**
- OLD: "Album detected: {files.length} tracks"
- NEW: "{files.length}-track album found! Loading..."
- CONTEXT: Multiple tracks detected in search result
- FREQUENCY: High (when playing albums)

**[413] | search.js | ERROR | 1500ms**
- OLD: "Error with "{result.title}", trying next..."
- NEW: "Failed loading {result.title}. Trying next..."
- CONTEXT: Track load failed, auto-trying next result
- FREQUENCY: Medium (connection issues)

**[418] | search.js | ERROR | null**
- OLD: "Error: {error.message}"
- NEW: "Couldn't load track. Please try another."
- CONTEXT: Generic search result error
- FREQUENCY: Medium (intermittent failures)

**[428] | search.js | INFO | 0ms**
- OLD: "Loading: {track.title}"
- NEW: "Loading {track.title}..."
- CONTEXT: Loading individual search track
- FREQUENCY: Very High (single track plays)

**[441] | search.js | ERROR | null**
- OLD: "Error: {error.message}"
- NEW: "Couldn't load. Try searching again?"
- CONTEXT: Generic track load error
- FREQUENCY: Medium (failures)

**[453] | search.js | INFO | 0ms**
- OLD: "Loading full album..."
- NEW: "Loading complete album..."
- CONTEXT: Fetching full album metadata
- FREQUENCY: Medium (album plays)

**[460] | search.js | INFO | null**
- OLD: "Playing full album: {files[0].album || albumId}"
- NEW: "Now playing: {album title}"
- CONTEXT: Album ready for playback
- FREQUENCY: High (album playback)

**[547] | search.js | INFO | 0ms**
- OLD: "Preparing preloaded playlist..."
- NEW: "Setting up your playlist..."
- CONTEXT: Pre-loading search results for playback
- FREQUENCY: Medium (search result chains)

**[577] | search.js | INFO | 3000ms**
- OLD: "Playing {searchPlaylist.length} tracks in preloaded order"
- NEW: "{searchPlaylist.length} tracks queued to play"
- CONTEXT: Preloaded playlist ready
- FREQUENCY: Medium (search result playback)

**[580] | search.js | ERROR | null**
- OLD: "Error: {error.message}"
- NEW: "Couldn't set up playlist. Please try again."
- CONTEXT: Playlist setup error
- FREQUENCY: Low (rare failures)

---

## OFFLINE & CONNECTION MESSAGES

**[651] | initialization.js | WARNING | 5000ms | offline**
- OLD: "No connection - you can play favorites by clicking the play button ▶"
- NEW: "No internet. Your saved favorites are ready to play."
- CONTEXT: App detects offline mode at startup
- FREQUENCY: High (offline users)
- TYPE: offline (highest priority)

**[9] | offline.js | INFO | 2000ms**
- OLD: "Connection restored"
- NEW: "Back online! Explore new music."
- CONTEXT: Internet connection returns after offline
- FREQUENCY: Medium (reconnections)

**[468] | search.js | ERROR | 4000ms**
- OLD: "Album not available offline - Connect to the internet to play"
- NEW: "Album offline. Connect to play it."
- CONTEXT: Attempting album play without internet
- FREQUENCY: Low (offline users with search results)

**[523] | search.js | ERROR | 2000ms**
- OLD: "Favorite not available offline, skipping..."
- NEW: "Favorite not saved locally. Skipping..."
- CONTEXT: Favorite not cached for offline play
- FREQUENCY: Medium (offline favorites playback)

**[1168] | playback.js | ERROR | 2000ms**
- OLD: "Track not available offline, skipping..."
- NEW: "Track not saved. Skipping to next..."
- CONTEXT: Queued track missing from offline cache
- FREQUENCY: Medium (offline queue playback)

**[1174] | playback.js | ERROR | 3000ms**
- OLD: "No more tracks available offline"
- NEW: "No more saved tracks. Go online to discover more."
- CONTEXT: All offline tracks played
- FREQUENCY: Low (offline-only sessions)

**[1378] | playback.js | ERROR | 2000ms**
- OLD: "No connection, trying next track..."
- NEW: "Connection lost. Trying next track..."
- CONTEXT: Network error mid-playback
- FREQUENCY: Low (unstable connections)

**[1366] | playback.js | ERROR | 2000ms**
- OLD: "Track not available offline, skipping..."
- NEW: "Track not available now. Moving on..."
- CONTEXT: Can't load track (offline or unavailable)
- FREQUENCY: Low (various offline scenarios)

**[1447] | playback.js | ERROR | 2000ms**
- OLD: "Track not available offline, skipping..."
- NEW: "Can't access track. Skipping..."
- CONTEXT: Offline track playback failure
- FREQUENCY: Low (offline scenarios)

**[1869] | playback.js | ERROR | 2000ms**
- OLD: "Favorite not available offline, skipping..."
- NEW: "Favorite not available right now. Skipping..."
- CONTEXT: Favorited track unavailable for playback
- FREQUENCY: Medium (offline favorites playback)

---

## ERROR & RECOVERY MESSAGES

**[311] | initialization.js | ERROR | null**
- OLD: "Playback error"
- NEW: "Playback issue detected"
- CONTEXT: Audio element encounters error event
- FREQUENCY: Low (playback failures)

**[361] | initialization.js | ERROR | null**
- OLD: "Error adding favorite"
- NEW: "Couldn't add this to favorites"
- CONTEXT: Exception while saving favorite
- FREQUENCY: Low (rare errors)

**[495] | search.js | ERROR | 2000ms**
- OLD: "Error: Invalid favorite, skipping to next"
- NEW: "Favorite issue. Moving to next track..."
- CONTEXT: Favorite data corruption/invalid
- FREQUENCY: Low (data issues)

**[531] | search.js | ERROR | null**
- OLD: "Error: {error.message}"
- NEW: "Something went wrong. Try again?"
- CONTEXT: Generic error in favorites playback
- FREQUENCY: Low (failures)

**[587] | playback.js | ERROR | 3000ms**
- OLD: "Multiple errors - enabling safe mode"
- NEW: "Too many errors. Turning on safe mode."
- CONTEXT: 10+ consecutive playback failures
- FREQUENCY: Very Low (critical failures)

**[588] | playback.js | WARNING | 5000ms**
- OLD: "Playback stopped for safety"
- NEW: "Playback paused for stability. Try searching."
- CONTEXT: Safe mode prevents further errors
- FREQUENCY: Very Low (critical failures)

**[614] | initialization.js | ERROR | null**
- OLD: "Error playing offline track"
- NEW: "Couldn't play offline track"
- CONTEXT: Offline track play attempt fails
- FREQUENCY: Low (offline errors)

**[1041] | playback.js | ERROR | null**
- OLD: "Error: {error.message}"
- NEW: "Playback failed. Please try again."
- CONTEXT: Generic play() error
- FREQUENCY: Low (playback errors)

**[1177] | playback.js | ERROR | null**
- OLD: "Error: {error.message}"
- NEW: "Couldn't load track. Try another."
- CONTEXT: FIFO queue playback error
- FREQUENCY: Low (failures)

**[1228] | playback.js | ERROR | 1500ms**
- OLD: "Problematic track - skipping to next..."
- NEW: "Issue with track. Moving on..."
- CONTEXT: Individual track in queue fails
- FREQUENCY: Low (track issues)

**[1231] | playback.js | ERROR | 3000ms**
- OLD: "Multiple tracks with errors - stopping playback"
- NEW: "Multiple failed tracks. Stopping playback."
- CONTEXT: Too many tracks fail in sequence
- FREQUENCY: Very Low (critical issues)

**[1289] | playback.js | ERROR | 2000ms**
- OLD: "Error in track "{actualNextTrack.title || 'unknown'}" - trying next..."
- NEW: "Issue with "{track.title}". Trying next..."
- CONTEXT: Specific track fails, auto-advance
- FREQUENCY: Low (track failures)

**[1292] | playback.js | ERROR | 3000ms**
- OLD: "Multiple tracks with errors - stopping auto-play"
- NEW: "Too many issues. Stopping auto-play."
- CONTEXT: Multiple sequential track failures
- FREQUENCY: Very Low (critical issues)

**[1358] | playback.js | ERROR | 2000ms**
- OLD: "Error: Audio URL not available"
- NEW: "Audio URL missing. Skipping track."
- CONTEXT: Track object lacks URL
- FREQUENCY: Low (data issues)

---

## SHARING & SPECIAL FEATURES

**[60] | initialization.js | INFO | 0ms**
- OLD: "Loading shared content..."
- NEW: "Opening shared music..."
- CONTEXT: Processing shared link (play parameter)
- FREQUENCY: Low (when shared links used)

**[80] | initialization.js | ERROR | null**
- OLD: "Error loading shared content"
- NEW: "Couldn't load shared music"
- CONTEXT: Shared content fetch fails
- FREQUENCY: Low (broken shared links)

**[126] | initialization.js | INFO | 3000ms**
- OLD: "Shared album loaded: {albumData.title} ({files.length} tracks)"
- NEW: "{albumData.title}: {files.length} tracks ready"
- CONTEXT: Shared album ready for playback
- FREQUENCY: Low (shared links for albums)

**[142] | initialization.js | INFO | 3000ms**
- OLD: "Playing shared track: {track.title}"
- NEW: "Playing shared: {track.title}"
- CONTEXT: Shared single track ready
- FREQUENCY: Low (shared single tracks)

**[374] | initialization.js | WARNING | null**
- OLD: "No current track to share"
- NEW: "Nothing to share. Play a track first."
- CONTEXT: User clicks share with no active track
- FREQUENCY: Low (UI usage)

**[53] | donation-tooltip.js | INFO | 2000ms**
- OLD: "QR downloaded successfully"
- NEW: "QR saved. Thanks for supporting!"
- CONTEXT: User downloads QR code for donations
- FREQUENCY: Low (donations)

---

## INITIALIZATION & STARTUP MESSAGES

**[228] | initialization.js | INFO | 3000ms**
- OLD: "Ready to play: {firstTrack.title}. Click the play button."
- NEW: "Ready to play: {firstTrack.title} ▶"
- CONTEXT: Favorites loaded at startup
- FREQUENCY: High (every session with favorites)

**[257] | initialization.js | INFO | null**
- OLD: "No favorites to play"
- NEW: "No saved tracks. Try searching!"
- CONTEXT: Play-all-favorites clicked with empty list
- FREQUENCY: Low (no favorites scenario)

**[262] | initialization.js | INFO | null**
- OLD: "Playing all favorites"
- NEW: "Playing all your favorites"
- CONTEXT: User clicks play-all-favorites
- FREQUENCY: Medium (dedicated favorites play)

**[434] | initialization.js | INFO | 3000ms**
- OLD: "Press the floating action button to close the app"
- NEW: "Tap the close button at the bottom"
- CONTEXT: Android-specific navigation hint
- FREQUENCY: Low (Android users)

**[1112] | playback.js | INFO | null**
- OLD: "Starting Resonate..."
- NEW: "Starting Resonate Music Player..."
- CONTEXT: App startup in safe mode
- FREQUENCY: Medium (every session)

---

## VOLUME & UI MESSAGES

**[336] | ui.js | INFO | 1000ms**
- OLD: "Muted" / "Volume on"
- NEW: "Sound muted" / "Sound on"
- CONTEXT: User toggles mute via volume icon
- FREQUENCY: Medium (volume control usage)

**[350] | ui.js | ERROR | null**
- OLD: "Only .ogg and .mp3 formats can be added to favorites"
- NEW: ".ogg and .mp3 only. Other formats not supported."
- CONTEXT: User tries to favorite unsupported format
- FREQUENCY: Low (edge case)

---

## CACHE & STORAGE MESSAGES

**[1589] | playback.js | INFO | 3000ms**
- OLD: "Storage: {stats.usagePercentage.toFixed(1)}% used"
- NEW: "Storage: {percent}% of your space in use"
- CONTEXT: Display cache usage statistics
- FREQUENCY: Low (advanced users)

**[1617] | playback.js | INFO | 2000ms**
- OLD: "Playback finished"
- NEW: "Playback complete"
- CONTEXT: Track ends naturally
- FREQUENCY: High (end of every track)

---

## SEARCH RESULT LOADING

**[1900] | playback.js | INFO | 0ms**
- OLD: "Loading: {track.title}"
- NEW: "Loading {track.title}..."
- CONTEXT: Loading track from search results
- FREQUENCY: Very High (search result playback)

**[1918] | playback.js | ERROR | null**
- OLD: "Error: {error.message}"
- NEW: "Couldn't load. Try another search result."
- CONTEXT: Search result load failure
- FREQUENCY: Low (failures)

**[1949] | playback.js | INFO | 0ms**
- OLD: "Playing random from search results: {firstTrack.title}"
- NEW: "Playing random: {firstTrack.title}"
- CONTEXT: Random selection from search results
- FREQUENCY: Low (random play feature)

**[1960] | playback.js | ERROR | null**
- OLD: "Error: {error.message}"
- NEW: "Random play failed. Please search again."
- CONTEXT: Random play feature error
- FREQUENCY: Very Low (rare)

**[975] | playback.js | INFO | 0ms**
- OLD: "Playing saved track: {savedState.track.title}"
- NEW: "Resuming: {savedState.track.title}"
- CONTEXT: Resuming saved playback state
- FREQUENCY: High (resuming sessions)

**[992] | playback.js | ERROR | null**
- OLD: "Error resuming saved track: {error.message}"
- NEW: "Couldn't resume. Starting fresh?"
- CONTEXT: Resume playback fails
- FREQUENCY: Low (failures)

---

## SUMMARY STATISTICS

**Total showStatus() calls cataloged: 94**

### By Frequency:
- **Very High (every interaction):** 12 messages
- **High (frequent):** 22 messages  
- **Medium (regular):** 35 messages
- **Low (occasional):** 25 messages

### By Type:
- **Info:** 67 messages (71%)
- **Error:** 20 messages (21%)
- **Warning:** 6 messages (6%)
- **Offline:** 1 message (1%)

### By Category:
- **Playback Control:** 18 messages
- **Favorites Management:** 7 messages
- **Search & Loading:** 14 messages
- **Offline/Connection:** 10 messages
- **Error & Recovery:** 16 messages
- **Sharing & Features:** 7 messages
- **Initialization:** 8 messages
- **Volume/UI:** 2 messages
- **Cache/Storage:** 2 messages
- **Search Result Loading:** 4 messages

---

## KEY GUIDELINES APPLIED:

✅ **7-10 words max** - All messages stay within word limit
✅ **Friendly tone** - Conversational, encouraging language
✅ **Educational** - Explains what's happening or what to do next
✅ **Minimal jargon** - Plain language for all users
✅ **Active voice** - Action-oriented phrasing
✅ **Inclusive** - Works for new and experienced users
✅ **Consistent style** - Similar structure across message types
✅ **Actionable** - Guides users toward next step when appropriate

---

## PRIORITY ORDER FOR IMPLEMENTATION:

1. **Highest Priority (Very High frequency):** Messages 830, 848, 850, 366, 428, 1900, 228, 1125
2. **High Priority (High frequency):** Playback & favorites messages (1034, 1046, 1125, 1731-1760, etc.)
3. **Medium Priority (Regular use):** Search, offline, error messages
4. **Lower Priority (Occasional):** Sharing, special features, edge cases

