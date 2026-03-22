import { APIRequestContext, expect } from '@playwright/test';

const API_BASE_URL = process.env['PLAYWRIGHT_E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8010';

export interface MediaItem {
  id: string;
  original_filename: string | null;
  tags: string[];
  character_name: string | null;
  tagging_status: string;
  thumbnail_status: string;
  poster_status?: string;
}

export interface TagListItem {
  id: number;
  name: string;
  category: number;
  category_name: string;
  media_count: number;
}

export interface CharacterSuggestionItem {
  name: string;
  media_count: number;
}

export interface TagManagementResult {
  matched_media: number;
  updated_media: number;
  trashed_media: number;
  already_trashed: number;
  deleted_tag: boolean;
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

export async function listTags(
  request: APIRequestContext,
  accessToken: string,
  query = ''
): Promise<TagListItem[]> {
  const response = await request.get(`${API_BASE_URL}/tags${query ? `?${query}` : ''}`, {
    headers: authHeaders(accessToken)
  });
  await expect(response).toBeOK();
  return await response.json() as TagListItem[];
}

export async function listCharacterSuggestions(
  request: APIRequestContext,
  accessToken: string,
  query: string
): Promise<CharacterSuggestionItem[]> {
  const response = await request.get(`${API_BASE_URL}/media/character-suggestions?${query}`, {
    headers: authHeaders(accessToken)
  });
  await expect(response).toBeOK();
  return await response.json() as CharacterSuggestionItem[];
}

export async function removeTag(
  request: APIRequestContext,
  accessToken: string,
  tagName: string
): Promise<TagManagementResult> {
  const response = await request.delete(`${API_BASE_URL}/tags/${encodeURIComponent(tagName)}`, {
    headers: authHeaders(accessToken)
  });
  await expect(response).toBeOK();
  return await response.json() as TagManagementResult;
}

export async function trashMediaByTag(
  request: APIRequestContext,
  accessToken: string,
  tagName: string
): Promise<TagManagementResult> {
  const response = await request.post(`${API_BASE_URL}/tags/${encodeURIComponent(tagName)}/trash-media`, {
    headers: authHeaders(accessToken)
  });
  await expect(response).toBeOK();
  return await response.json() as TagManagementResult;
}

export async function removeCharacterName(
  request: APIRequestContext,
  accessToken: string,
  characterName: string
): Promise<TagManagementResult> {
  const response = await request.delete(`${API_BASE_URL}/character-names/${encodeURIComponent(characterName)}`, {
    headers: authHeaders(accessToken)
  });
  await expect(response).toBeOK();
  return await response.json() as TagManagementResult;
}

export async function trashMediaByCharacterName(
  request: APIRequestContext,
  accessToken: string,
  characterName: string
): Promise<TagManagementResult> {
  const response = await request.post(
    `${API_BASE_URL}/character-names/${encodeURIComponent(characterName)}/trash-media`,
    {
      headers: authHeaders(accessToken)
    }
  );
  await expect(response).toBeOK();
  return await response.json() as TagManagementResult;
}
