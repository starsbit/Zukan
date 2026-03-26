export interface TagRead {
  id: number;
  name: string;
  category: number;
  category_key: string;
  category_name: string;
  media_count: number;
}

export interface TagManagementResult {
  matched_media: number;
  updated_media: number;
  trashed_media: number;
  already_trashed: number;
  deleted_tag: boolean;
}

export interface TagWithConfidence {
  name: string;
  category: number;
  category_key: string;
  category_name: string;
  confidence: number;
}

export interface TagListResponse {
  total: number;
  next_cursor: string | null;
  has_more: boolean;
  page_size: number;
  items: TagRead[];
}

export interface ListTagsQuery {
  after?: string | null;
  page_size?: number;
  category?: number | null;
  q?: string | null;
  sort_by?: 'name' | 'media_count';
  sort_order?: 'asc' | 'desc';
}
