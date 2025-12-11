/**
 * Onboarding System for Resonate Player
 * Guides first-time users through the app with 3 interactive "acts"
 */

class OnboardingManager {
  constructor() {
    this.currentStep = 0;
    this.completed = false;
    this.skipTooltips = false;
    this.storageKey = 'resonateOnboardingCompleted';
    this.tooltipTimeouts = [];
  }

  /**
   * Check if user has already completed onboarding
   */
  hasCompletedOnboarding() {
    return localStorage.getItem(this.storageKey) === 'true';
  }

  /**
   * Mark onboarding as completed
   */
  markAsCompleted() {
    localStorage.setItem(this.storageKey, 'true');
    this.completed = true;
  }

  /**
   * Reset onboarding (for testing)
   */
  resetOnboarding() {
    localStorage.removeItem(this.storageKey);
    this.completed = false;
  }

  /**
   * Initialize onboarding modal
   */
  initialize() {
    if (this.hasCompletedOnboarding()) {
      return;
    }

    // Create modal container if it doesn't exist
    if (!document.getElementById('onboarding-modal')) {
      this.createOnboardingModal();
    }

    // Show the first step
    this.showStep(0);
  }

  /**
   * Create the onboarding modal DOM structure
   */
  createOnboardingModal() {
    const modalHTML = `
      <div id="onboarding-modal" class="onboarding-modal">
        <div class="onboarding-overlay"></div>
        <div class="onboarding-content">
          <button id="onboarding-close" class="onboarding-close" aria-label="Close tutorial">✕</button>
          
          <div class="onboarding-steps">
            <!-- ACT I: Welcome -->
            <div id="step-0" class="onboarding-step act-1">
              <div class="onboarding-header">
                <h2>Welcome to Resonate Player 🎵</h2>
              </div>
              <div class="onboarding-body">
                <p class="onboarding-subtitle">Your free music player that works without internet</p>
                <ul class="onboarding-features">
                  <li>🎵 <strong>Free music</strong> from Archive.org</li>
                  <li>📱 <strong>Works offline</strong> with your saved songs</li>
                  <li>🔗 <strong>Share</strong> songs on social media</li>
                  <li>💾 <strong>Installable</strong> as native app</li>
                </ul>
              </div>
              <div class="onboarding-footer">
                <button class="onboarding-btn-skip">Skip tutorial</button>
                <button class="onboarding-btn-next">Next</button>
              </div>
            </div>

            <!-- ACT II: Search Music -->
            <div id="step-1" class="onboarding-step act-2">
              <div class="onboarding-header">
                <h2>Search your music 🔍</h2>
              </div>
              <div class="onboarding-body">
                <p class="onboarding-subtitle">Find songs by artist or title</p>
                <div class="onboarding-highlight-box">
                  <div class="onboarding-icon">🔍</div>
                  <p>Type an artist, song or genre in the search bar above</p>
                </div>
                <div class="onboarding-info-box">
                  <p><strong>Tip:</strong> Results appear in real time. Click any to play.</p>
                </div>
              </div>
              <div class="onboarding-footer">
                <button class="onboarding-btn-prev">Back</button>
                <button class="onboarding-btn-next">Next</button>
              </div>
            </div>

            <!-- ACT III: Favorites & Sharing -->
            <div id="step-2" class="onboarding-step act-3">
              <div class="onboarding-header">
                <h2>Save and share 💖</h2>
              </div>
              <div class="onboarding-body">
                <p class="onboarding-subtitle">Customize your experience</p>
                <div class="onboarding-features-list">
                  <div class="feature-item">
                    <span class="feature-emoji">❤️</span>
                    <div class="feature-text">
                      <strong>Favorites</strong>
                      <p>Click the heart to save songs. Access them anytime, even without internet.</p>
                    </div>
                  </div>
                  <div class="feature-item">
                    <span class="feature-emoji">⇄</span>
                    <div class="feature-text">
                      <strong>Shuffle playback</strong>
                      <p>Click the shuffle button to play your favorites in random order.</p>
                    </div>
                  </div>
                  <div class="feature-item">
                    <span class="feature-emoji">🔗</span>
                    <div class="feature-text">
                      <strong>Share</strong>
                      <p>Click the link to share the song on social media with preview.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div class="onboarding-footer">
                <button class="onboarding-btn-prev">Back</button>
                <button class="onboarding-btn-complete">Get Started! 🚀</button>
              </div>
            </div>
          </div>

          <!-- Step indicators -->
          <div class="onboarding-indicators">
            <span class="indicator active" data-step="0"></span>
            <span class="indicator" data-step="1"></span>
            <span class="indicator" data-step="2"></span>
          </div>
        </div>
      </div>
    `;

    // Append modal to body
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Attach event listeners to onboarding controls
   */
  attachEventListeners() {
    const modal = document.getElementById('onboarding-modal');

    // Close button
    document.getElementById('onboarding-close').addEventListener('click', () => {
      this.closeOnboarding();
    });

    // Skip button
    const skipBtn = modal.querySelector('.onboarding-btn-skip');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        this.closeOnboarding();
      });
    }

    // Next buttons
    const nextBtns = modal.querySelectorAll('.onboarding-btn-next');
    nextBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.nextStep();
      });
    });

    // Previous buttons
    const prevBtns = modal.querySelectorAll('.onboarding-btn-prev');
    prevBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.previousStep();
      });
    });

    // Complete button
    const completeBtn = modal.querySelector('.onboarding-btn-complete');
    if (completeBtn) {
      completeBtn.addEventListener('click', () => {
        this.closeOnboarding();
      });
    }

    // Indicator dots
    const indicators = modal.querySelectorAll('.indicator');
    indicators.forEach(indicator => {
      indicator.addEventListener('click', () => {
        const step = parseInt(indicator.dataset.step);
        this.showStep(step);
      });
    });

    // Close on overlay click (optional - disable if you want to prevent accidental close)
    const overlay = modal.querySelector('.onboarding-overlay');
    overlay.addEventListener('click', (e) => {
      // Only close if clicking directly on overlay, not content
      if (e.target === overlay) {
        this.closeOnboarding();
      }
    });
  }

  /**
   * Show a specific step
   */
  showStep(stepNumber) {
    if (stepNumber < 0 || stepNumber > 2) {
      return;
    }

    const modal = document.getElementById('onboarding-modal');
    if (!modal) return;

    // Hide all steps
    const steps = modal.querySelectorAll('.onboarding-step');
    steps.forEach(step => {
      step.classList.remove('active');
    });

    // Show current step
    const currentStep = document.getElementById(`step-${stepNumber}`);
    if (currentStep) {
      currentStep.classList.add('active');
    }

    // Update indicators
    const indicators = modal.querySelectorAll('.indicator');
    indicators.forEach((ind, index) => {
      ind.classList.toggle('active', index === stepNumber);
    });

    this.currentStep = stepNumber;

    // Add accessibility focus
    modal.querySelector('.onboarding-header h2').focus();
  }

  /**
   * Move to next step
   */
  nextStep() {
    if (this.currentStep < 2) {
      this.showStep(this.currentStep + 1);
    }
  }

  /**
   * Move to previous step
   */
  previousStep() {
    if (this.currentStep > 0) {
      this.showStep(this.currentStep - 1);
    }
  }

  /**
   * Close onboarding and mark as completed
   */
  closeOnboarding() {
    const modal = document.getElementById('onboarding-modal');
    if (modal) {
      // Clear any pending tooltips
      this.tooltipTimeouts.forEach(timeout => clearTimeout(timeout));
      this.tooltipTimeouts = [];

      // Add fade-out animation
      modal.classList.add('fade-out');

      // Remove after animation
      setTimeout(() => {
        modal.remove();
        this.markAsCompleted();
        console.log('Onboarding completed and closed');
      }, 300);
    }
  }

  /**
   * Show a tooltip for a specific UI element (advanced feature)
   */
  showTooltip(elementSelector, text, position = 'top') {
    if (this.skipTooltips || this.completed) return;

    const element = document.querySelector(elementSelector);
    if (!element) return;

    const tooltip = document.createElement('div');
    tooltip.className = `onboarding-tooltip tooltip-${position}`;
    tooltip.textContent = text;

    element.parentElement.insertAdjacentElement('afterbegin', tooltip);

    // Remove after delay
    const timeout = setTimeout(() => {
      tooltip.remove();
    }, 5000);

    this.tooltipTimeouts.push(timeout);
  }
}

// Create global instance
const onboardingManager = new OnboardingManager();
