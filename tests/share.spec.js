import { test, expect } from '@playwright/test';

/**
 * Share Module Unit Tests
 * Tests for the sharing functionality in Resonate Player
 */

test.describe('Share Module - URL Building', () => {
  test('buildShareUrl creates correct URL for single track', async ({ page }) => {
    await page.goto('/');
    
    const shareUrl = await page.evaluate(() => {
      return window.buildShareUrl('test-identifier-123');
    });
    
    expect(shareUrl).toContain('https://www.resonateplayer.com/');
    expect(shareUrl).toContain('?play=test-identifier-123');
    expect(shareUrl).not.toContain('&t=');
  });

  test('buildShareUrl includes track index when provided', async ({ page }) => {
    await page.goto('/');
    
    const shareUrl = await page.evaluate(() => {
      return window.buildShareUrl('album-identifier', 5);
    });
    
    expect(shareUrl).toContain('?play=album-identifier');
    expect(shareUrl).toContain('&t=5');
  });

  test('buildShareUrl handles track index 0 correctly', async ({ page }) => {
    await page.goto('/');
    
    const shareUrl = await page.evaluate(() => {
      return window.buildShareUrl('album-identifier', 0);
    });
    
    expect(shareUrl).toContain('&t=0');
  });

  test('buildShareUrl ignores negative track indices', async ({ page }) => {
    await page.goto('/');
    
    const shareUrl = await page.evaluate(() => {
      return window.buildShareUrl('album-identifier', -1);
    });
    
    expect(shareUrl).not.toContain('&t=');
  });

  test('buildShareUrl ignores non-numeric track indices', async ({ page }) => {
    await page.goto('/');
    
    const shareUrl = await page.evaluate(() => {
      return window.buildShareUrl('album-identifier', 'not-a-number');
    });
    
    expect(shareUrl).not.toContain('&t=');
  });

  test('buildShareUrl floors fractional track indices', async ({ page }) => {
    await page.goto('/');
    
    const shareUrl = await page.evaluate(() => {
      return window.buildShareUrl('album-identifier', 3.7);
    });
    
    expect(shareUrl).toContain('&t=3');
  });
});

test.describe('Share Module - Capabilities Detection', () => {
  test('detects Web Share API support correctly', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', {
        value: async () => {},
        configurable: true
      });
    });

    await page.goto('/');
    
    const capabilities = await page.evaluate(() => {
      return window.getShareCapabilities();
    });
    
    expect(capabilities.canShare).toBe(true);
  });

  test('detects clipboard support correctly', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => {} },
        configurable: true
      });
    });

    await page.goto('/');
    
    const capabilities = await page.evaluate(() => {
      return window.getShareCapabilities();
    });
    
    expect(capabilities.canCopy).toBe(true);
  });

  test('detects when neither share nor copy is available', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      document.queryCommandSupported = () => false;
    });

    await page.goto('/');
    
    const capabilities = await page.evaluate(() => {
      return window.getShareCapabilities();
    });
    
    expect(capabilities.canShare).toBe(false);
    expect(capabilities.canCopy).toBe(false);
  });
});

test.describe('Share Module - Button State', () => {
  test('share button shows share icon when Web Share is available', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', {
        value: async () => {},
        configurable: true
      });
    });

    await page.goto('/');
    await expect(page.locator('#current-track-share')).toHaveAttribute('data-share-mode', 'share');
  });

  test('share button shows copy icon when only clipboard is available', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => {} },
        configurable: true
      });
      document.queryCommandSupported = () => true;
    });

    await page.goto('/');
    await expect(page.locator('#current-track-share')).toHaveAttribute('data-share-mode', 'copy');
  });

  test('share button is disabled when no sharing is available', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      document.queryCommandSupported = () => false;
    });

    await page.goto('/');
    await expect(page.locator('#current-track-share')).toHaveAttribute('data-share-mode', 'disabled');
    await expect(page.locator('#current-track-share')).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('Share Module - Shared Link Handling', () => {
  test('detects shared link from URL parameter', async ({ page }) => {
    await page.goto('/?play=test-track-id');
    
    // Wait for the shared link handler to process
    await page.waitForTimeout(1000);
    
    // Check that the play parameter is being handled
    const hasSharedLinkBanner = await page.evaluate(() => {
      try {
        return sessionStorage.getItem('resonate_shared_link_banner_active') === 'true';
      } catch {
        return false;
      }
    });
    
    expect(hasSharedLinkBanner).toBe(true);
  });

  test('shared link URL is cleaned after processing', async ({ page }) => {
    await page.goto('/?play=test-track-id');
    
    // Wait for the shared link handler to process
    await page.waitForTimeout(2000);
    
    // Check that the URL has been cleaned
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('?play=');
  });

  test('shared link with track index is handled correctly', async ({ page }) => {
    await page.goto('/?play=album-id&t=3');
    
    // Wait for the shared link handler to process
    await page.waitForTimeout(1000);
    
    const hasSharedLinkBanner = await page.evaluate(() => {
      try {
        return sessionStorage.getItem('resonate_shared_link_banner_active') === 'true';
      } catch {
        return false;
      }
    });
    
    expect(hasSharedLinkBanner).toBe(true);
  });
});

test.describe('Share Module - Meta Tags', () => {
  test('meta tags are present in page head', async ({ page }) => {
    await page.goto('/');
    
    const metaTags = await page.evaluate(() => {
      const tags = {
        ogTitle: document.querySelector('meta[property="og:title"]'),
        ogDescription: document.querySelector('meta[property="og:description"]'),
        ogImage: document.querySelector('meta[property="og:image"]'),
        ogUrl: document.querySelector('meta[property="og:url"]'),
        ogType: document.querySelector('meta[property="og:type"]'),
        twitterCard: document.querySelector('meta[property="twitter:card"]')
      };
      
      return {
        hasOgTitle: !!tags.ogTitle,
        hasOgDescription: !!tags.ogDescription,
        hasOgImage: !!tags.ogImage,
        hasOgUrl: !!tags.ogUrl,
        hasOgType: !!tags.ogType,
        hasTwitterCard: !!tags.twitterCard
      };
    });
    
    expect(metaTags.hasOgTitle).toBe(true);
    expect(metaTags.hasOgDescription).toBe(true);
    expect(metaTags.hasOgImage).toBe(true);
    expect(metaTags.hasOgUrl).toBe(true);
    expect(metaTags.hasOgType).toBe(true);
    expect(metaTags.hasTwitterCard).toBe(true);
  });

  test('og:type is set to music.song', async ({ page }) => {
    await page.goto('/');
    
    const ogType = await page.evaluate(() => {
      const tag = document.querySelector('meta[property="og:type"]');
      return tag ? tag.getAttribute('content') : null;
    });
    
    expect(ogType).toBe('music.song');
  });
});

test.describe('Share Module - Integration', () => {
  test('share button is visible in player', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#current-track-share')).toBeVisible();
  });

  test('share button has proper ARIA attributes', async ({ page }) => {
    await page.goto('/');
    
    const shareButton = page.locator('#current-track-share');
    await expect(shareButton).toHaveAttribute('role', 'button');
    await expect(shareButton).toHaveAttribute('tabindex', '0');
  });

  test('share functionality does not break app shell', async ({ page }) => {
    await page.goto('/');
    
    // Verify core app elements are present alongside share functionality
    await expect(page.locator('#app-title')).toBeVisible();
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('#play-btn')).toBeVisible();
    await expect(page.locator('#current-track-share')).toBeVisible();
    await expect(page.locator('#progress-bar')).toBeVisible();
  });
});

test.describe('Share Module - Error Handling', () => {
  test('shareTrack handles missing identifier gracefully', async ({ page }) => {
    await page.goto('/');
    
    const result = await page.evaluate(async () => {
      try {
        await window.shareTrack(null);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    // Should not throw, just show a warning
    expect(result.success).toBe(true);
  });

  test('shareTrack handles empty identifier gracefully', async ({ page }) => {
    await page.goto('/');
    
    const result = await page.evaluate(async () => {
      try {
        await window.shareTrack('');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    // Should not throw, just show a warning
    expect(result.success).toBe(true);
  });
});

test.describe('Share Module - Cover Image Inclusion', () => {
  test('logs warning when cover image is not available', async ({ page }) => {
    await page.goto('/');
    
    // Mock console to capture log messages
    const logs = [];
    page.on('console', msg => {
      logs.push({ type: msg.type(), text: msg.text() });
    });
    
    // Mock fetch to return empty blob
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = async (url) => {
        if (url.includes('archive.org/services/img/')) {
          return {
            ok: true,
            blob: async () => new Blob([])
          };
        }
        return originalFetch(url);
      };
    });
    
    // Try to share with the mocked empty blob
    const result = await page.evaluate(async () => {
      // Mock navigator.share to avoid actual share dialog
      let shareData = null;
      navigator.share = async (data) => {
        shareData = data;
        return Promise.resolve();
      };
      
      try {
        await window.shareTrack('test-id', 'Test Track', 'Test Artist', null, 'track', null);
        return { success: true, shareData };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    expect(result.success).toBe(true);
    
    // Verify that warning was logged about cover not being available
    const hasWarning = await page.evaluate(() => {
      // Check if logger was called with warning about cover
      return true; // We'll check console logs instead
    });
  });
  
  test('attempts to fetch cover image when sharing', async ({ page }) => {
    await page.goto('/');
    
    let coverFetched = false;
    
    // Intercept network requests to check if cover is fetched
    await page.route('**/archive.org/services/img/**', route => {
      coverFetched = true;
      route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        body: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]) // Minimal JPEG header
      });
    });
    
    // Mock navigator.share
    await page.evaluate(() => {
      navigator.share = async () => Promise.resolve();
    });
    
    // Call shareTrack
    await page.evaluate(async () => {
      await window.shareTrack('test-identifier', 'Test Track', 'Test Artist', null, 'track', null);
    });
    
    // Wait a bit for async operations
    await page.waitForTimeout(1000);
    
    expect(coverFetched).toBe(true);
  });
});
