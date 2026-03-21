import { APIRequestContext, expect, Page } from '@playwright/test';

const API_BASE_URL = 'http://127.0.0.1:8000';

export interface E2eSession {
  username: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

export async function createSession(request: APIRequestContext): Promise<E2eSession> {
  const username = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = 'password123';

  const registerResponse = await request.post(`${API_BASE_URL}/auth/register`, {
    data: {
      username,
      email: `${username}@example.com`,
      password
    }
  });
  await expect(registerResponse).toBeOK();

  const loginResponse = await request.post(`${API_BASE_URL}/auth/login`, {
    data: {
      username,
      password,
      remember_me: true
    }
  });
  await expect(loginResponse).toBeOK();

  const payload = await loginResponse.json();
  return {
    username,
    password,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token
  };
}

export async function seedLocalAuth(page: Page, session: E2eSession): Promise<void> {
  await page.addInitScript((tokens) => {
    localStorage.setItem('zukan.web.access_token', tokens.accessToken);
    localStorage.setItem('zukan.web.refresh_token', tokens.refreshToken);
    localStorage.setItem('zukan.web.token_type', 'bearer');
  }, session);
}
