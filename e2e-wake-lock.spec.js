import { test, expect } from '@playwright/test';

/**
 * Wake Lock API Integration Tests
 * Tests the Screen Wake Lock implementation to prevent music from stopping when screen is locked
 */

test.describe('Wake Lock API Integration', () => {
  
  test('WakeLockManager is available and initialized', async ({ page }) => {
    await page.goto('/');
    
    // Check that WakeLockManager is loaded and initialized
    const isAvailable = await page.evaluate(() => {
      return window.wakeLockManager && 
             window.wakeLockManager.isSupported !== undefined;
    });
    
    expect(isAvailable).toBe(true);
  });

  test('Wake Lock feature detection works correctly', async ({ page }) => {
    await page.goto('/');
    
    const hasWakeLock = await page.evaluate(() => {
      return 'wakeLock' in navigator && 
             typeof navigator.wakeLock === 'object' &&
             navigator.wakeLock !== null;
    });
    
    const managerSupported = await page.evaluate(() => {
      return window.wakeLockManager.isSupported;
    });
    
    // Both should agree
    expect(managerSupported).toBe(hasWakeLock);
  });

  test('Wake Lock works gracefully when API is not available', async ({ page }) => {
    // Remove Wake Lock API before page loads
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        value: undefined,
        configurable: true
      });
    });
    
    await page.goto('/');
    
    const status = await page.evaluate(() => {
      return window.wakeLockManager.getStatus();
    });
    
    expect(status.isSupported).toBe(false);
    
    // App should still work without Wake Lock
    await expect(page.locator('#play-btn')).toBeVisible();
  });

  test('Wake Lock manager can acquire lock when API is available', async ({ page }) => {
    // Mock Wake Lock API
    await page.addInitScript(() => {
      let mockLock = null;
      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: async (type) => {
            if (type === 'screen') {
              mockLock = {
                released: false,
                type: 'screen',
                release: async () => {
                  mockLock.released = true;
                  mockLock.dispatchEvent(new Event('release'));
                },
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => {}
              };
              return mockLock;
            }
            throw new Error('Invalid type');
          }
        },
        configurable: true
      });
    });
    
    await page.goto('/');
    
    // Try to acquire wake lock
    const acquireResult = await page.evaluate(async () => {
      return await window.wakeLockManager.acquire();
    });
    
    expect(acquireResult).toBe(true);
    
    // Check status
    const status = await page.evaluate(() => {
      return window.wakeLockManager.getStatus();
    });
    
    expect(status.isSupported).toBe(true);
    expect(status.shouldBeActive).toBe(true);
  });

  test('Wake Lock manager can release lock', async ({ page }) => {
    // Mock Wake Lock API
    await page.addInitScript(() => {
      let mockLock = null;
      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: async (type) => {
            if (type === 'screen') {
              mockLock = {
                released: false,
                type: 'screen',
                release: async () => {
                  mockLock.released = true;
                  mockLock.dispatchEvent(new Event('release'));
                },
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => {}
              };
              return mockLock;
            }
            throw new Error('Invalid type');
          }
        },
        configurable: true
      });
    });
    
    await page.goto('/');
    
    // Acquire and then release
    const result = await page.evaluate(async () => {
      await window.wakeLockManager.acquire();
      const releaseResult = await window.wakeLockManager.release();
      const status = window.wakeLockManager.getStatus();
      return { releaseResult, status };
    });
    
    expect(result.releaseResult).toBe(true);
    expect(result.status.shouldBeActive).toBe(false);
  });

  test('Wake Lock handles permission denial gracefully', async ({ page }) => {
    // Mock Wake Lock API with permission denial
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: async () => {
            const error = new Error('Permission denied');
            error.name = 'NotAllowedError';
            throw error;
          }
        },
        configurable: true
      });
    });
    
    await page.goto('/');
    
    // Try to acquire wake lock (should fail gracefully)
    const acquireResult = await page.evaluate(async () => {
      return await window.wakeLockManager.acquire();
    });
    
    // Should return false but not crash
    expect(acquireResult).toBe(false);
    
    // App should still work
    await expect(page.locator('#play-btn')).toBeVisible();
  });

  test('Status method returns correct information', async ({ page }) => {
    await page.goto('/');
    
    const status = await page.evaluate(() => {
      return window.wakeLockManager.getStatus();
    });
    
    expect(status).toHaveProperty('isSupported');
    expect(status).toHaveProperty('isActive');
    expect(status).toHaveProperty('shouldBeActive');
    expect(status).toHaveProperty('isAcquiring');
    
    expect(typeof status.isSupported).toBe('boolean');
    expect(typeof status.isActive).toBe('boolean');
    expect(typeof status.shouldBeActive).toBe('boolean');
    expect(typeof status.isAcquiring).toBe('boolean');
  });
});
