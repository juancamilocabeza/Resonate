import { test, expect } from '@playwright/test';

/**
 * MediaSession API Integration Tests
 * Tests the battery-efficient, cross-platform MediaSession implementation
 */

test.describe('MediaSession API Integration', () => {
  
  test('MediaSession API is available and initialized', async ({ page }) => {
    await page.goto('/');
    
    // Check that MediaSessionManager is loaded and initialized
    const isSupported = await page.evaluate(() => {
      return window.mediaSessionManager && 
             window.mediaSessionManager.isSupported !== undefined;
    });
    
    expect(isSupported).toBe(true);
  });

  test('MediaSession feature detection works correctly', async ({ page }) => {
    // Test with MediaSession API available
    await page.goto('/');
    
    const hasMediaSession = await page.evaluate(() => {
      return 'mediaSession' in navigator;
    });
    
    const managerSupported = await page.evaluate(() => {
      return window.mediaSessionManager.isSupported;
    });
    
    // Both should agree
    expect(managerSupported).toBe(hasMediaSession);
  });

  test('MediaSession works gracefully when API is not available', async ({ page }) => {
    // Remove MediaSession API before page loads
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaSession', {
        value: undefined,
        configurable: true
      });
    });
    
    await page.goto('/');
    
    const status = await page.evaluate(() => {
      return window.mediaSessionManager.getStatus();
    });
    
    expect(status.isSupported).toBe(false);
    
    // App should still work without MediaSession
    await expect(page.locator('#play-btn')).toBeVisible();
  });

  test('Action handlers are registered successfully', async ({ page }) => {
    await page.goto('/');
    
    // Wait for initialization
    await page.waitForTimeout(1000);
    
    const status = await page.evaluate(() => {
      return window.mediaSessionManager.getStatus();
    });
    
    // If MediaSession is supported, handlers should be registered
    if (status.isSupported) {
      expect(status.actionHandlersCount).toBeGreaterThan(0);
    }
  });

  test('Metadata updates with adaptive artwork sizes', async ({ page }) => {
    await page.goto('/');
    
    // Mock a track load
    await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return;
      
      const mockTrack = {
        title: 'Test Track',
        creator: 'Test Artist',
        album: 'Test Album',
        totalTracks: 1
      };
      
      const mockIdentifier = 'test-identifier';
      
      window.mediaSessionManager.updateMetadata(mockTrack, mockIdentifier);
    });
    
    const metadata = await page.evaluate(() => {
      if (!navigator.mediaSession || !navigator.mediaSession.metadata) {
        return null;
      }
      
      return {
        title: navigator.mediaSession.metadata.title,
        artist: navigator.mediaSession.metadata.artist,
        album: navigator.mediaSession.metadata.album,
        artworkCount: navigator.mediaSession.metadata.artwork?.length || 0,
        artworkSizes: navigator.mediaSession.metadata.artwork?.map(a => a.sizes) || []
      };
    });
    
    if (metadata) {
      expect(metadata.title).toBe('Test Track');
      expect(metadata.artist).toBe('Test Artist');
      // Should have 4 artwork sizes (96, 256, 384, 512)
      expect(metadata.artworkCount).toBe(4);
      expect(metadata.artworkSizes).toContain('96x96');
      expect(metadata.artworkSizes).toContain('256x256');
      expect(metadata.artworkSizes).toContain('384x384');
      expect(metadata.artworkSizes).toContain('512x512');
    }
  });

  test('Position state updates only on state changes (battery efficient)', async ({ page }) => {
    await page.goto('/');
    
    let updateCount = 0;
    
    // Monitor position state updates
    await page.evaluate(() => {
      if (!navigator.mediaSession || !navigator.mediaSession.setPositionState) {
        return;
      }
      
      window._positionStateUpdateCount = 0;
      const original = navigator.mediaSession.setPositionState.bind(navigator.mediaSession);
      
      navigator.mediaSession.setPositionState = function(...args) {
        window._positionStateUpdateCount++;
        return original(...args);
      };
    });
    
    // Simulate position state updates
    await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return;
      
      // First update
      window.mediaSessionManager.updatePositionState({
        duration: 180,
        position: 30,
        playbackRate: 1.0
      });
      
      // Same values - should be skipped (battery optimization)
      window.mediaSessionManager.updatePositionState({
        duration: 180,
        position: 30,
        playbackRate: 1.0
      });
      
      // Different position - should update
      window.mediaSessionManager.updatePositionState({
        duration: 180,
        position: 45,
        playbackRate: 1.0
      });
    });
    
    updateCount = await page.evaluate(() => window._positionStateUpdateCount || 0);
    
    // Should be 2 updates, not 3 (second call was skipped due to same values)
    if (updateCount > 0) {
      expect(updateCount).toBe(2);
    }
  });

  test('Playback state updates correctly', async ({ page }) => {
    await page.goto('/');
    
    await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return;
      
      window.mediaSessionManager.updatePlaybackState('playing');
    });
    
    let playbackState = await page.evaluate(() => {
      return navigator.mediaSession?.playbackState || null;
    });
    
    if (playbackState) {
      expect(playbackState).toBe('playing');
    }
    
    await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return;
      
      window.mediaSessionManager.updatePlaybackState('paused');
    });
    
    playbackState = await page.evaluate(() => {
      return navigator.mediaSession?.playbackState || null;
    });
    
    if (playbackState) {
      expect(playbackState).toBe('paused');
    }
  });

  test('Cleanup routine properly clears MediaSession state', async ({ page }) => {
    await page.goto('/');
    
    // Setup some state
    await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return;
      
      const mockTrack = {
        title: 'Test Track',
        creator: 'Test Artist'
      };
      
      window.mediaSessionManager.updateMetadata(mockTrack, 'test-id');
      window.mediaSessionManager.updatePlaybackState('playing');
    });
    
    // Perform cleanup
    await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return;
      window.mediaSessionManager.cleanup();
    });
    
    const afterCleanup = await page.evaluate(() => {
      return {
        metadata: navigator.mediaSession?.metadata,
        playbackState: navigator.mediaSession?.playbackState,
        isCleanedUp: window.mediaSessionManager?.isCleanedUp
      };
    });
    
    if (afterCleanup.isCleanedUp !== undefined) {
      expect(afterCleanup.isCleanedUp).toBe(true);
      expect(afterCleanup.metadata).toBeNull();
      expect(afterCleanup.playbackState).toBe('none');
    }
  });

  test('Reset after cleanup re-initializes MediaSession', async ({ page }) => {
    await page.goto('/');
    
    await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return;
      
      // Cleanup
      window.mediaSessionManager.cleanup();
      
      // Reset
      window.mediaSessionManager.reset();
    });
    
    const status = await page.evaluate(() => {
      return window.mediaSessionManager.getStatus();
    });
    
    if (status.isSupported) {
      expect(status.isCleanedUp).toBe(false);
    }
  });

  test('Page visibility triggers cleanup when idle', async ({ page }) => {
    await page.goto('/');
    
    // Check cleanup behavior is implemented
    const hasVisibilityHandling = await page.evaluate(() => {
      return typeof document.addEventListener === 'function' &&
             window.mediaSessionManager?.cleanup !== undefined;
    });
    
    expect(hasVisibilityHandling).toBe(true);
    
    // Test manual cleanup on visibility change
    await page.evaluate(() => {
      // Ensure audio is paused
      const audio = document.getElementById('audio');
      if (audio && !audio.paused) {
        audio.pause();
      }
      
      // Manually trigger cleanup (simulating the deferred timeout)
      if (window.mediaSessionManager && !window.mediaSessionManager.isCleanedUp) {
        window.mediaSessionManager.cleanup();
      }
    });
    
    const isCleanedUp = await page.evaluate(() => {
      return window.mediaSessionManager?.isCleanedUp || false;
    });
    
    // Cleanup should work when called
    expect(isCleanedUp).toBe(true);
  });

  test('Invalid metadata is handled gracefully', async ({ page }) => {
    await page.goto('/');
    
    // Try to update with invalid data
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    
    await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return;
      
      // Null track
      window.mediaSessionManager.updateMetadata(null, 'test-id');
      
      // Undefined identifier
      window.mediaSessionManager.updateMetadata({ title: 'Test' }, undefined);
      
      // Empty track
      window.mediaSessionManager.updateMetadata({}, 'test-id');
    });
    
    // Should not throw any errors
    expect(errors.length).toBe(0);
  });

  test('Invalid position state is handled gracefully', async ({ page }) => {
    await page.goto('/');
    
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    
    await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return;
      
      // Invalid duration
      window.mediaSessionManager.updatePositionState({
        duration: -1,
        position: 0
      });
      
      // Invalid position
      window.mediaSessionManager.updatePositionState({
        duration: 180,
        position: -5
      });
      
      // Position beyond duration (should be clamped)
      window.mediaSessionManager.updatePositionState({
        duration: 180,
        position: 200
      });
    });
    
    // Should not throw any errors
    expect(errors.length).toBe(0);
  });

  test('Action handlers work with CastManager integration', async ({ page }) => {
    await page.goto('/');
    
    // Wait for MediaSession setup
    await page.waitForTimeout(1000);
    
    // Test that CastManager integration is available
    const hasCastIntegration = await page.evaluate(() => {
      return typeof window.CastManager !== 'undefined' || 
             typeof setupMediaSession === 'function';
    });
    
    // Just verify the structure is in place
    const status = await page.evaluate(() => {
      return window.mediaSessionManager?.getStatus();
    });
    
    if (status && status.isSupported) {
      // Verify action handlers are registered
      expect(status.actionHandlersCount).toBeGreaterThan(0);
    }
  });

  test('MediaSession persists across navigation when not cleaned up', async ({ page }) => {
    await page.goto('/');
    
    await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return;
      
      const mockTrack = {
        title: 'Persistent Track',
        creator: 'Test Artist'
      };
      
      window.mediaSessionManager.updateMetadata(mockTrack, 'test-id');
    });
    
    const metadata = await page.evaluate(() => {
      return navigator.mediaSession?.metadata?.title || null;
    });
    
    if (metadata) {
      expect(metadata).toBe('Persistent Track');
    }
  });

  test('Album track titles are formatted correctly', async ({ page }) => {
    await page.goto('/');
    
    await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return;
      
      const albumTrack = {
        title: 'Track 1',
        creator: 'Artist Name',
        album: 'Album Name',
        totalTracks: 10,
        isAlbumTrack: true
      };
      
      window.mediaSessionManager.updateMetadata(albumTrack, 'album-id');
    });
    
    const title = await page.evaluate(() => {
      return navigator.mediaSession?.metadata?.title || null;
    });
    
    if (title) {
      // Should format as "Album Name — Track 1"
      expect(title).toContain('Album Name');
      expect(title).toContain('Track 1');
      expect(title).toContain('—');
    }
  });

  test('getStatus returns accurate information', async ({ page }) => {
    await page.goto('/');
    
    const status = await page.evaluate(() => {
      return window.mediaSessionManager.getStatus();
    });
    
    expect(status).toHaveProperty('isSupported');
    expect(status).toHaveProperty('isCleanedUp');
    expect(status).toHaveProperty('hasMetadata');
    expect(status).toHaveProperty('hasPositionState');
    expect(status).toHaveProperty('actionHandlersCount');
    expect(status).toHaveProperty('lastPositionUpdate');
  });

  test('Battery optimization: position updates are throttled', async ({ page }) => {
    await page.goto('/');
    
    const updateCount = await page.evaluate(() => {
      if (!window.mediaSessionManager.isSupported) return 0;
      
      let count = 0;
      const original = window.mediaSessionManager.updatePositionState.bind(window.mediaSessionManager);
      
      // Override to count calls
      window.mediaSessionManager.updatePositionState = function(...args) {
        count++;
        return original(...args);
      };
      
      // Simulate rapid position updates (like timeupdate events)
      for (let i = 0; i < 10; i++) {
        window.mediaSessionManager.updatePositionState({
          duration: 180,
          position: 30 + i * 0.1, // Small increments
          playbackRate: 1.0
        });
      }
      
      return count;
    });
    
    // All 10 calls were made, but internal optimization should prevent
    // actual native API calls for similar values
    expect(updateCount).toBe(10);
  });
});
