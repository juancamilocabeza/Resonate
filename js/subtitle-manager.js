// Subtitle Manager - Real-time Audio Transcription using Web Speech API
// Leverages browser capabilities for instant subtitling on web and mobile

(function initSubtitleManager() {
  'use strict';

  const SUBTITLE_CONFIG = {
    MAX_LINES: 2,
    FADE_DURATION: 300,
    AUTO_HIDE_DELAY: 5000,
    STORAGE_KEY: 'resonate_subtitle_enabled',
    LANGUAGE_KEY: 'resonate_subtitle_language'
  };

  let recognition = null;
  let isRecognitionActive = false;
  let currentSubtitleText = '';
  let autoHideTimer = null;
  let subtitleEnabled = false;
  let recognitionSupported = false;

  // Check browser support for Web Speech API
  function checkSpeechRecognitionSupport() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionSupported = true;
      return true;
    }
    console.warn('Web Speech API not supported in this browser');
    recognitionSupported = false;
    return false;
  }

  // Initialize speech recognition
  function initSpeechRecognition() {
    if (!recognitionSupported) {
      return null;
    }

    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRecognition();
      
      // Configuration for optimal real-time transcription
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      
      // Get language from storage or use browser language
      const storedLanguage = localStorage.getItem(SUBTITLE_CONFIG.LANGUAGE_KEY);
      recognition.lang = storedLanguage || navigator.language || 'en-US';

      // Handle recognition results
      recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }

        // Update subtitle display with interim or final results
        const displayText = finalTranscript || interimTranscript;
        if (displayText.trim()) {
          updateSubtitleDisplay(displayText.trim());
        }
      };

      recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        
        // Auto-restart on certain errors (network, aborted)
        if (event.error === 'network' || event.error === 'aborted') {
          if (subtitleEnabled && isRecognitionActive) {
            setTimeout(() => {
              startRecognition();
            }, 1000);
          }
        }
        
        // Show error in subtitle area with helpful guidance
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          updateSubtitleDisplay('Microphone access required. Please allow microphone permissions in your browser settings.');
        } else if (event.error === 'no-speech') {
          // Silent error - no need to show to user
        }
      };

      recognition.onend = () => {
        isRecognitionActive = false;
        
        // Auto-restart if subtitles are still enabled and audio is playing
        if (subtitleEnabled && isAudioPlaying()) {
          setTimeout(() => {
            startRecognition();
          }, 500);
        }
      };

      recognition.onstart = () => {
        isRecognitionActive = true;
      };

      return recognition;
    } catch (error) {
      console.error('Failed to initialize speech recognition:', error);
      return null;
    }
  }

  // Start speech recognition
  function startRecognition() {
    if (!recognition || !subtitleEnabled || isRecognitionActive) {
      return;
    }

    try {
      recognition.start();
    } catch (error) {
      // Recognition might already be running
      if (error.message.includes('already started')) {
        isRecognitionActive = true;
      } else {
        console.warn('Failed to start recognition:', error);
      }
    }
  }

  // Stop speech recognition
  function stopRecognition() {
    if (!recognition || !isRecognitionActive) {
      return;
    }

    try {
      recognition.stop();
      isRecognitionActive = false;
    } catch (error) {
      console.warn('Failed to stop recognition:', error);
    }
  }

  // Check if audio is currently playing
  function isAudioPlaying() {
    try {
      const audio = document.getElementById('audio');
      return audio && !audio.paused && !audio.ended && audio.readyState > 2;
    } catch {
      return false;
    }
  }

  // Update subtitle display
  function updateSubtitleDisplay(text) {
    const subtitleContainer = document.getElementById('subtitle-display');
    if (!subtitleContainer) return;

    currentSubtitleText = text;
    subtitleContainer.textContent = text;
    subtitleContainer.classList.add('visible');

    // Clear previous timer
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
    }

    // Auto-hide after delay if recognition is not active and audio is not playing
    if (!isRecognitionActive && !isAudioPlaying()) {
      autoHideTimer = setTimeout(() => {
        subtitleContainer.classList.remove('visible');
      }, SUBTITLE_CONFIG.AUTO_HIDE_DELAY);
    }
  }

  // Clear subtitle display
  function clearSubtitleDisplay() {
    const subtitleContainer = document.getElementById('subtitle-display');
    if (subtitleContainer) {
      subtitleContainer.textContent = '';
      subtitleContainer.classList.remove('visible');
    }
    currentSubtitleText = '';
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  // Enable subtitles
  function enableSubtitles() {
    if (!recognitionSupported) {
      updateSubtitleDisplay('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
      setTimeout(() => clearSubtitleDisplay(), 5000);
      return false;
    }

    subtitleEnabled = true;
    localStorage.setItem(SUBTITLE_CONFIG.STORAGE_KEY, 'true');
    
    const toggleBtn = document.getElementById('subtitle-toggle-btn');
    if (toggleBtn) {
      toggleBtn.classList.add('active');
      toggleBtn.setAttribute('aria-pressed', 'true');
    }

    if (isAudioPlaying()) {
      startRecognition();
    }

    return true;
  }

  // Disable subtitles
  function disableSubtitles() {
    subtitleEnabled = false;
    localStorage.setItem(SUBTITLE_CONFIG.STORAGE_KEY, 'false');
    
    const toggleBtn = document.getElementById('subtitle-toggle-btn');
    if (toggleBtn) {
      toggleBtn.classList.remove('active');
      toggleBtn.setAttribute('aria-pressed', 'false');
    }

    stopRecognition();
    clearSubtitleDisplay();
  }

  // Toggle subtitles on/off
  function toggleSubtitles() {
    if (subtitleEnabled) {
      disableSubtitles();
    } else {
      enableSubtitles();
    }
  }

  // Set subtitle language
  function setSubtitleLanguage(langCode) {
    if (!recognition) return;
    
    try {
      const wasActive = isRecognitionActive;
      if (wasActive) {
        stopRecognition();
      }
      
      recognition.lang = langCode;
      localStorage.setItem(SUBTITLE_CONFIG.LANGUAGE_KEY, langCode);
      
      if (wasActive && subtitleEnabled) {
        setTimeout(() => startRecognition(), 500);
      }
    } catch (error) {
      console.error('Failed to set subtitle language:', error);
    }
  }

  // Get current subtitle language
  function getSubtitleLanguage() {
    return recognition ? recognition.lang : (localStorage.getItem(SUBTITLE_CONFIG.LANGUAGE_KEY) || navigator.language || 'en-US');
  }

  // Initialize subtitle UI
  function initSubtitleUI() {
    // Create subtitle display container if it doesn't exist
    let subtitleDisplay = document.getElementById('subtitle-display');
    if (!subtitleDisplay) {
      subtitleDisplay = document.createElement('div');
      subtitleDisplay.id = 'subtitle-display';
      subtitleDisplay.className = 'subtitle-display';
      subtitleDisplay.setAttribute('role', 'status');
      subtitleDisplay.setAttribute('aria-live', 'polite');
      subtitleDisplay.setAttribute('aria-atomic', 'true');
      
      // Insert before footer
      const playerContainer = document.querySelector('.player-container');
      if (playerContainer) {
        playerContainer.appendChild(subtitleDisplay);
      }
    }

    // Auto-enable subtitles by default for instant subtitling
    subtitleEnabled = true;
    localStorage.setItem(SUBTITLE_CONFIG.STORAGE_KEY, 'true');
  }

  // Setup audio event listeners
  function setupAudioListeners() {
    const audio = document.getElementById('audio');
    if (!audio) return;

    // Start recognition when audio starts playing
    audio.addEventListener('play', () => {
      if (subtitleEnabled) {
        setTimeout(() => startRecognition(), 500);
      }
    });

    // Stop recognition when audio is paused
    audio.addEventListener('pause', () => {
      stopRecognition();
      clearSubtitleDisplay();
    });

    // Stop recognition when audio ends
    audio.addEventListener('ended', () => {
      stopRecognition();
      clearSubtitleDisplay();
    });

    // Clear subtitles on track change
    audio.addEventListener('loadstart', () => {
      clearSubtitleDisplay();
    });
  }

  // Initialize subtitle manager
  function init() {
    // Subtitle feature disabled - should not access microphone
    console.log('Subtitle manager: Feature disabled (microphone access not appropriate for audio playback subtitles)');
    return;
  }

  // Public API
  window.SubtitleManager = {
    init,
    toggleSubtitles,
    enableSubtitles,
    disableSubtitles,
    setLanguage: setSubtitleLanguage,
    getLanguage: getSubtitleLanguage,
    isEnabled: () => subtitleEnabled,
    isSupported: () => recognitionSupported
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
