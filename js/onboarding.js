/**
 * Minimal Onboarding System for Resonate Player
 * Shows a single welcome screen once per device.
 */

class OnboardingManager {
  constructor() {
    this.storageKey = 'resonateOnboardingCompleted';
    this._isOpen = false;
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
  }

  /**
   * Reset onboarding (for testing)
   */
  resetOnboarding() {
    localStorage.removeItem(this.storageKey);
  }

  /**
   * Initialize onboarding modal
   */
  initialize() {
    if (this.hasCompletedOnboarding()) {
      return;
    }

    // Prevent duplicates if called more than once
    if (this._isOpen || document.getElementById('onboarding-modal')) {
      return;
    }

    // Create modal container if it doesn't exist
    if (!document.getElementById('onboarding-modal')) {
      this.createOnboardingModal();
    }

    this._isOpen = true;
    this._focusInitial();
  }

  /**
   * Create the onboarding modal DOM structure
   */
  createOnboardingModal() {
    const modalHTML = `
      <div id="onboarding-modal" class="onboarding-modal" role="dialog" aria-modal="true" aria-label="Welcome">
        <div class="onboarding-overlay"></div>
        <div class="onboarding-content">
          <button id="onboarding-close" class="onboarding-close" aria-label="Close">✕</button>

          <div class="onboarding-steps">
            <div id="step-0" class="onboarding-step active">
              <div class="onboarding-header">
                <h2 tabindex="-1">Resonate</h2>
              </div>
              <div class="onboarding-body">
                <p class="onboarding-subtitle">Get started</p>
                <ul class="onboarding-features">
                  <li><strong>Search</strong> find songs, artists, or genres</li>
                  <li><strong>Favorites</strong> save songs you like</li>
                  <li><strong>Offline</strong> play saved favorites</li>
                </ul>
              </div>
              <div class="onboarding-footer">
                <button class="onboarding-btn-complete">Done</button>
              </div>
            </div>
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
    if (!modal) return;

    // Close button
    const closeBtn = document.getElementById('onboarding-close');
    if (closeBtn) closeBtn.addEventListener('click', () => {
      this.closeOnboarding();
    });

    // Complete button
    const completeBtn = modal.querySelector('.onboarding-btn-complete');
    if (completeBtn) completeBtn.addEventListener('click', () => {
      this.closeOnboarding();
    });

    // Close on overlay click (optional - disable if you want to prevent accidental close)
    const overlay = modal.querySelector('.onboarding-overlay');
    if (overlay) overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeOnboarding();
    });

    // Escape to close
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeOnboarding();
      }
    };
    modal.addEventListener('keydown', onKeyDown);
  }

  _focusInitial() {
    const modal = document.getElementById('onboarding-modal');
    if (!modal) return;
    const header = modal.querySelector('.onboarding-header h2');
    if (header && typeof header.focus === 'function') header.focus();
  }

  /**
   * Close onboarding and mark as completed
   */
  closeOnboarding() {
    const modal = document.getElementById('onboarding-modal');
    if (modal) {
      // Add fade-out animation
      modal.classList.add('fade-out');

      // Remove after animation
      setTimeout(() => {
        modal.remove();
        this._isOpen = false;
        this.markAsCompleted();
        if (window.logger && typeof window.logger.info === 'function') {
          window.logger.info('Onboarding completed and closed', 'UI');
        } else {
          console.log('Onboarding completed and closed');
        }
      }, 300);
    } else {
      this._isOpen = false;
      this.markAsCompleted();
    }
  }

  /**
   * Show a tooltip for a specific UI element (advanced feature)
   */
  showTooltip(elementSelector, text, position = 'top') {
    // Minimal onboarding: tooltips are intentionally disabled.
    // Kept as a no-op for backward compatibility.
    void elementSelector;
    void text;
    void position;
  }
}

// Create global instance
const onboardingManager = new OnboardingManager();
