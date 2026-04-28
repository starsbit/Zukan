export enum RarityTier {
  N = 'N',
  R = 'R',
  SR = 'SR',
  SSR = 'SSR',
  UR = 'UR',
}

export enum GachaPullMode {
  SINGLE = 'single',
  TEN_PULL = 'ten_pull',
  DAILY = 'daily',
}

export interface GachaPullRequest {
  mode?: GachaPullMode;
  pool?: string | null;
}

export interface GachaPullItemRead {
  id: string;
  media_id: string;
  rarity_tier: RarityTier;
  rarity_score: number;
  was_duplicate: boolean;
  upgrade_material_granted: number;
  position: number;
  collection_item_id: string | null;
}

export interface GachaPullRead {
  id: string;
  user_id: string;
  mode: GachaPullMode;
  pool: string | null;
  currency_spent: number;
  currency_balance: number | null;
  created_at: string;
  items: GachaPullItemRead[];
}

export interface RaritySnapshotRead {
  media_id: string;
  rarity_score: number;
  rarity_tier: RarityTier;
  component_scores: Record<string, number>;
  score_version: string;
  previous_tier: RarityTier | null;
  below_threshold_count: number;
  calculated_at: string;
}

export interface GachaStatsResponse {
  total_rarity_snapshots: number;
  tier_counts: Partial<Record<RarityTier, number>>;
  collection_count: number;
  duplicate_copies: number;
  currency_balance: number;
  daily_claim_available: boolean;
  next_daily_claim_at: string | null;
}

export interface RarityRecalculationResponse {
  recalculated: number;
  score_version: string;
  tier_counts: Partial<Record<RarityTier, number>>;
}

export interface GachaCurrencyBalanceRead {
  user_id: string;
  balance: number;
  total_claimed: number;
  total_spent: number;
  last_daily_claimed_on: string | null;
  daily_claim_amount: number;
  daily_claim_available: boolean;
  next_daily_claim_at: string | null;
}

export interface GachaDailyClaimResponse {
  claimed: number;
  balance: number;
  daily_claim_available: boolean;
  next_daily_claim_at: string;
}
