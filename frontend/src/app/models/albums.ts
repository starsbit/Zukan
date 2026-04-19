import { CursorPage } from './common';

export enum AlbumShareRole {
  VIEWER = 'viewer',
  EDITOR = 'editor',
}

export enum AlbumShareReadRole {
  VIEWER = 'viewer',
  EDITOR = 'editor',
  OWNER = 'owner',
}

export enum AlbumAccessRole {
  VIEWER = 'viewer',
  EDITOR = 'editor',
  OWNER = 'owner',
}

export interface AlbumOwnerSummary {
  id: string;
  username: string;
}

export interface AlbumPreviewMedia {
  id: string;
}

export interface AlbumRead {
  id: string;
  owner_id: string;
  owner: AlbumOwnerSummary;
  access_role: AlbumAccessRole;
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

export interface AlbumShareRead {
  user_id: string;
  role: AlbumShareReadRole;
  status: 'pending' | 'accepted';
  shared_at: string;
  shared_by_user_id: string | null;
}

export interface AlbumAccessEntryRead {
  user_id: string;
  username: string;
  role: AlbumShareReadRole;
  status: 'pending' | 'accepted';
  shared_at: string;
  shared_by_user_id: string | null;
  shared_by_username: string | null;
}

export interface AlbumAccessListResponse {
  owner: AlbumOwnerSummary;
  entries: AlbumAccessEntryRead[];
}

export interface AlbumShareCreate {
  username: string;
  role?: AlbumShareRole;
}

export interface AlbumOwnershipTransferRequest {
  new_owner_user_id: string;
  keep_editor_access?: boolean;
}

export type AlbumListResponse = CursorPage<AlbumRead> & { total: number };
