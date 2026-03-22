import { MediaType, NsfwFilter } from '../../models/api';

export interface GallerySearchFilters {
  favorited: 'any' | 'only';
  album_id: string | null;
  nsfw: NsfwFilter;
  status: Array<'done' | 'pending' | 'processing' | 'failed'>;
  media_type: MediaType[];
  captured_after: string | null;
  captured_before: string | null;
}

export interface GallerySearchState {
  searchText: string;
  filters: GallerySearchFilters;
}

export type GallerySearchSuggestionKind = 'tag' | 'character';

export interface GallerySearchSuggestion {
  kind: GallerySearchSuggestionKind;
  label: string;
  token: string;
  secondary: string;
}
