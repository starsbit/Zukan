import { CursorPage } from './common';

export interface AlbumPreviewMedia {
  id: string;
}

export interface AlbumRead {
  id: string;
  name: string;
  description: string | null;
  cover_media_id: string | null;
  preview_media: AlbumPreviewMedia[];
  media_count: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AlbumCreate {
  name: string;
  description?: string | null;
}

export interface AlbumUpdate {
  name?: string | null;
  description?: string | null;
  cover_media_id?: string | null;
  version?: number | null;
}

export type AlbumListResponse = CursorPage<AlbumRead> & { total: number };
