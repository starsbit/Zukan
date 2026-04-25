export type GraphSeriesMode = 'any' | 'same' | 'different';

export interface CharacterGraphSearchResult {
  id: string;
  name: string;
  media_count: number;
}

export interface CharacterGraphNode {
  id: string;
  name: string;
  media_count: number;
  embedding_support: number;
  series_names: string[];
  representative_media_ids: string[];
}

export interface CharacterGraphEdge {
  id: string;
  source: string;
  target: string;
  similarity: number;
  shared_series: string[];
}

export interface CharacterGraphResponse {
  model_version: string;
  total_characters_considered: number;
  center_entity_id: string | null;
  nodes: CharacterGraphNode[];
  edges: CharacterGraphEdge[];
}
