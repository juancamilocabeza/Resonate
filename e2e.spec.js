import { test, expect } from '@playwright/test';

test('app shell loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app-title')).toBeVisible();
  await expect(page.locator('#search-input')).toBeVisible();
  await expect(page.locator('#play-btn')).toBeVisible();
  await expect(page.locator('#current-track-share')).toBeVisible();
  await expect(page.locator('#progress-bar')).toBeVisible();
  await expect(page.locator('#resontes-toggle')).toBeVisible();
});

test('share button uses copy fallback when Web Share is unavailable', async ({ page }) => {
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

test('share button disables when no share or copy is available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.queryCommandSupported = () => false;
  });

  await page.goto('/');
  await expect(page.locator('#current-track-share')).toHaveAttribute('data-share-mode', 'disabled');
  await expect(page.locator('#current-track-share')).toHaveAttribute('aria-disabled', 'true');
});
