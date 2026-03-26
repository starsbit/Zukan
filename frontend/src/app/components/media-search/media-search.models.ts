import { MediaType, NsfwFilter } from '../../models/api';

export interface MediaSearchFilters {
  favorited: 'any' | 'only';
  album_id: string | null;
  nsfw: NsfwFilter;
  status: Array<'done' | 'pending' | 'processing' | 'failed'>;
  media_type: MediaType[];
  captured_after: string | null;
  captured_before: string | null;
}

export interface MediaSearchState {
  searchText: string;
  filters: MediaSearchFilters;
}

export type MediaSearchSuggestionKind = 'tag' | 'character';

export interface MediaSearchSuggestion {
  kind: MediaSearchSuggestionKind;
  label: string;
  token: string;
  secondary: string;
}
