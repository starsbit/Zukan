export enum MediaEntityType {
  CHARACTER = 'character',
  SERIES = 'series',
}

export interface EntityRead {
  id: string;
  entity_type: MediaEntityType;
  entity_id: string | null;
  name: string;
  role: string;
  source: string;
  confidence: number | null;
}

export interface EntityCreate {
  entity_type: MediaEntityType;
  entity_id?: string | null;
  name: string;
  role?: string;
  confidence?: number | null;
}

export interface ExternalRefRead {
  id: string;
  provider: string;
  external_id: string | null;
  url: string | null;
}

export interface ExternalRefCreate {
  provider: string;
  external_id?: string | null;
  url?: string | null;
}
