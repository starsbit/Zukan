import { APIRequestContext, expect } from '@playwright/test';

const API_BASE_URL = 'http://127.0.0.1:8000';

export interface MediaItem {
  id: string;
  original_filename: string | null;
  tags: string[];
  character_name: string | null;
  tagging_status: string;
  thumbnail_status: string;
  poster_status?: string;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

export async function listMedia(request: APIRequestContext, accessToken: string): Promise<MediaItem[]> {
  const response = await request.get(`${API_BASE_URL}/media?page=1&page_size=50`, {
    headers: authHeaders(accessToken)
  });
  await expect(response).toBeOK();
  const payload = await response.json();
  return payload.items as MediaItem[];
}

export async function listMediaWithQuery(
  request: APIRequestContext,
  accessToken: string,
  query: string
): Promise<MediaItem[]> {
  const response = await request.get(`${API_BASE_URL}/media?${query}`, {
    headers: authHeaders(accessToken)
  });
  await expect(response).toBeOK();
  const payload = await response.json();
  return payload.items as MediaItem[];
}

export async function getMedia(request: APIRequestContext, accessToken: string, mediaId: string): Promise<MediaItem> {
  const response = await request.get(`${API_BASE_URL}/media/${mediaId}`, {
    headers: authHeaders(accessToken)
  });
  await expect(response).toBeOK();
  return await response.json() as MediaItem;
}

export async function waitForMedia(
  request: APIRequestContext,
  accessToken: string,
  mediaId: string,
  predicate: (media: MediaItem) => boolean,
  timeoutMs = 10_000
): Promise<MediaItem> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const media = await getMedia(request, accessToken, mediaId);
    if (predicate(media)) {
      return media;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for media ${mediaId}`);
}
