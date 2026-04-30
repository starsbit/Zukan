import { RarityTier } from './gacha';
import { MediaType } from './media';
import { EntityRead } from './relations';

export enum CollectionVisibility {
  PRIVATE = 'private',
  FOLLOWERS = 'followers',
  PUBLIC = 'public',
}

export interface CollectionMediaRead {
  id: string;
  filename: string;
  media_type?: MediaType;
  is_nsfw: boolean;
  is_sensitive: boolean;
  tags: string[];
  entities: EntityRead[];
}

export interface CollectionItemRead {
  id: string;
  user_id: string;
  media_id: string;
  rarity_tier_at_acquisition: RarityTier;
  level: number;
  upgrade_xp: number;
  copies_pulled: number;
  locked: boolean;
  tradeable: boolean;
  acquired_at: string;
  updated_at: string;
  media: CollectionMediaRead | null;
}

export interface CollectionItemUpdate {
  locked?: boolean | null;
  tradeable?: boolean | null;
}

export interface CollectionListResponse {
  total: number;
  items: CollectionItemRead[];
}

export interface CollectionDiscardResponse {
  item_id: string;
  media_id: string;
  copies_discarded: number;
  pulls_awarded: number;
  currency_balance: number;
  remaining_copies: number;
  item: CollectionItemRead | null;
}

export interface CollectionStatsResponse {
  total_items: number;
  total_copies_pulled: number;
  duplicate_copies: number;
  max_level_items: number;
  tier_counts: Partial<Record<RarityTier, number>>;
}

export interface CollectionPrivacyRead {
  user_id: string;
  visibility: CollectionVisibility;
  allow_trade_requests: boolean;
  show_stats: boolean;
  show_nsfw: boolean;
}

export interface CollectionPrivacyUpdate {
  visibility?: CollectionVisibility | null;
  allow_trade_requests?: boolean | null;
  show_stats?: boolean | null;
  show_nsfw?: boolean | null;
}

export interface CollectionOwnerRead {
  user_id: string;
  username: string;
  allow_trade_requests: boolean;
  show_stats: boolean;
}

export interface CollectionOwnerListResponse {
  total: number;
  items: CollectionOwnerRead[];
}

export interface CollectionOwnerListParams {
  q?: string;
  tradeable_only?: boolean;
}

export interface CollectionListParams {
  rarity_tier?: RarityTier;
  tags?: string[];
  character_name?: string;
  series_name?: string;
  character_names?: string[];
  series_names?: string[];
  level?: number;
  tradeable?: boolean;
  duplicates_only?: boolean;
}
