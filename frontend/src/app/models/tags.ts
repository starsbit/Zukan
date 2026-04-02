import { CursorPage } from './common';

export const TAG_CATEGORY_NAMES: Record<number, string> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
  9: 'rating',
};

export interface TagRead {
  id: number;
  name: string;
  category: number;
  category_name: string;
  category_key: string;
  media_count: number;
}

export interface CharacterSuggestion {
  name: string;
  media_count: number;
}

export interface SeriesSuggestion {
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

export type TagListResponse = CursorPage<TagRead>;
