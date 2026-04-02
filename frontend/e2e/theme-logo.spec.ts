import { test, expect } from '@playwright/test';
import { ensureAdminAuthenticated, isSetupRequired } from './helpers/auth';

async function setTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  if (await isSetupRequired()) {
    await page.goto('/');
  } else {
    await ensureAdminAuthenticated(page);
    await page.goto('/');
  }
  await page.evaluate((value) => {
    localStorage.setItem('zukan-theme', value);
    document.documentElement.classList.remove('theme-light', 'theme-dark');
    document.documentElement.classList.add(`theme-${value}`);
  }, theme);
  await page.reload();
}

test.describe('Navbar logo theme variants', () => {
  test('uses the black logo in light mode', async ({ page }) => {
    await setTheme(page, 'light');

    const lightLogo = page.locator('.brand-logo-light');
    const darkLogo = page.locator('.brand-logo-dark');

    await expect(lightLogo).toBeVisible();
    await expect(darkLogo).toBeHidden();
    await expect(lightLogo).toHaveAttribute('src', '/assets/starsbit-logo-black.webp');
  });

  test('uses the white logo in dark mode', async ({ page }) => {
    await setTheme(page, 'dark');

    const lightLogo = page.locator('.brand-logo-light');
    const darkLogo = page.locator('.brand-logo-dark');

    await expect(darkLogo).toBeVisible();
    await expect(lightLogo).toBeHidden();
    await expect(darkLogo).toHaveAttribute('src', '/assets/starsbit-logo-white.webp');
  });
});
