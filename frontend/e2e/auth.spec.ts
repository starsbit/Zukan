import { test, expect } from '@playwright/test';
import { fillLoginForm, fillPasswordFields, isSetupRequired, setRememberMe, submitLoginForm, TEST_ADMIN } from './helpers/auth';

async function expectToolbarTitle(
  page: import('@playwright/test').Page,
) {
  await expect(page.getByRole('button', { name: 'Profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Gallery' })).toBeVisible();
}

async function skipIfSetupCompleted(page: import('@playwright/test').Page, reason: string) {
  await page.goto('/login');
  test.skip(!(await isSetupRequired()), reason);
}

test.describe.serial('Authentication workflows', () => {
  test.describe('First-time setup', () => {
    test('home stays accessible to guests before setup', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      await page.goto('/');

      if (setupRequired) {
        await expect(page.locator('zukan-setup-wizard')).toBeVisible();
        await expect(page).toHaveURL(/\/(?:login)?(?:\?.*)?$/);
        return;
      }

      await expect(page).toHaveURL(/\/login\?returnUrl=%2F$/);
      await expect(page.locator('zukan-login-page')).toBeVisible();
    });

    test('setup wizard is visible when admin:admin user exists', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      test.skip(!setupRequired, 'Setup already completed — admin:admin user no longer exists');

      await skipIfSetupCompleted(page, 'Setup completed while the suite was running');
      await expect(page.locator('zukan-setup-wizard')).toBeVisible();
    });

    test('auth tabs are hidden when setup is required', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      test.skip(!setupRequired, 'Setup already completed');

      await skipIfSetupCompleted(page, 'Setup completed while the suite was running');
      await expect(page.locator('mat-tab-group')).not.toBeVisible();
    });

    test('completing setup creates admin user and redirects to /', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      test.skip(!setupRequired, 'Setup already completed');

      await skipIfSetupCompleted(page, 'Setup completed while the suite was running');

      await page.locator('zukan-setup-wizard input[formcontrolname="username"]').fill(TEST_ADMIN.username);
      await page.locator('zukan-setup-wizard input[formcontrolname="email"]').fill(TEST_ADMIN.email);
      await fillPasswordFields(page, 'zukan-setup-wizard', TEST_ADMIN.password, TEST_ADMIN.password);

      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByText('This action is irreversible.')).toBeVisible();
      await page.getByRole('button', { name: 'Complete Setup' }).click();

      await expect(page).toHaveURL('/');
      await expectToolbarTitle(page);
      await expect(page.getByRole('link', { name: 'Gallery' })).toBeVisible();
    });
  });

  test.describe('Normal login', () => {
    test('login page shows Sign In and Register tabs when setup is not required', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      test.skip(setupRequired, 'Setup not yet completed');

      await page.goto('/login');
      await expect(page.locator('mat-tab-group')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Sign In' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Register' })).toBeVisible();
    });

    test('setup wizard is hidden when setup is not required', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      test.skip(setupRequired, 'Setup not yet completed');

      await page.goto('/login');
      await expect(page.locator('zukan-setup-wizard')).not.toBeVisible();
    });

    test('valid credentials redirect to /', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      test.skip(setupRequired, 'Setup not yet completed');

      await page.goto('/login');
      await fillLoginForm(page, TEST_ADMIN.username, TEST_ADMIN.password);
      await submitLoginForm(page);

      await expect(page).toHaveURL('/');
      await expectToolbarTitle(page);
    });

    test('invalid credentials show error and stay on /login', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      test.skip(setupRequired, 'Setup not yet completed');

      await page.goto('/login');
      await fillLoginForm(page, TEST_ADMIN.username, 'wrongpassword');
      await submitLoginForm(page);

      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('.form-error')).toBeVisible();
    });

    test('authenticated user visiting /login is redirected to /', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      test.skip(setupRequired, 'Setup not yet completed');

      await page.goto('/login');
      await fillLoginForm(page, TEST_ADMIN.username, TEST_ADMIN.password);
      await submitLoginForm(page);
      await expect(page).toHaveURL('/');

      await page.goto('/login');
      await expect(page).toHaveURL('/');
    });

    test('remembered login survives a page reload', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      test.skip(setupRequired, 'Setup not yet completed');

      const rememberUser = {
        username: `remember_${Date.now()}`,
        email: `remember_${Date.now()}@example.com`,
        password: 'RememberPass1!',
      };

      await page.goto('/login');
      await page.getByRole('tab', { name: 'Register' }).click();
      await page.locator('zukan-register-form input[formcontrolname="username"]').fill(rememberUser.username);
      await page.locator('zukan-register-form input[formcontrolname="email"]').fill(rememberUser.email);
      await fillPasswordFields(page, 'zukan-register-form', rememberUser.password, rememberUser.password);
      await page.getByRole('button', { name: 'Create Account' }).click();

      await expect(page.locator('.form-success')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Sign In' })).toHaveAttribute('aria-selected', 'true');

      await fillLoginForm(page, rememberUser.username, rememberUser.password);
      await setRememberMe(page, true);
      await submitLoginForm(page);

      await expect(page).toHaveURL('/');
      await expect(page.getByRole('link', { name: 'Gallery' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Profile' })).toBeVisible();

      await page.reload();

      await expect(page).toHaveURL('/');
      await expect(page.getByRole('link', { name: 'Gallery' })).toBeVisible();
      await page.getByRole('button', { name: 'Profile' }).click();
      await expect(page.getByText(rememberUser.username, { exact: true })).toBeVisible();
    });
  });

  test.describe('Registration', () => {
    const newUser = {
      username: `e2e_user_${Date.now()}`,
      email: `e2e_${Date.now()}@example.com`,
      password: 'RegisterPass1!',
    };

    test('registering a new user shows success and switches to Sign In tab', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      test.skip(setupRequired, 'Setup not yet completed');

      await page.goto('/login');
      await page.getByRole('tab', { name: 'Register' }).click();

      await page.locator('zukan-register-form input[formcontrolname="username"]').fill(newUser.username);
      await page.locator('zukan-register-form input[formcontrolname="email"]').fill(newUser.email);
      await fillPasswordFields(page, 'zukan-register-form', newUser.password, newUser.password);

      await page.getByRole('button', { name: 'Create Account' }).click();

      await expect(page.locator('.form-success')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Sign In' })).toHaveAttribute('aria-selected', 'true');
    });

    test('newly registered user can log in', async ({ page }) => {
      const setupRequired = await isSetupRequired();
      test.skip(setupRequired, 'Setup not yet completed');

      await page.goto('/login');
      await fillLoginForm(page, newUser.username, newUser.password);
      await submitLoginForm(page);

      await expect(page).toHaveURL('/');
      await expectToolbarTitle(page);
    });
  });
});
