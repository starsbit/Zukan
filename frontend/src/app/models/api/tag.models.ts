export interface TagRead {
  id: number;
  name: string;
  category: number;
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
  category_name: string;
  confidence: number;
}

export interface ListTagsQuery {
  limit?: number;
  offset?: number;
  category?: number | null;
  q?: string | null;
}
