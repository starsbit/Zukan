import { CollectionItemRead } from './collection';

export enum TradeSide {
  SENDER = 'sender',
  RECEIVER = 'receiver',
}

export enum TradeStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export interface TradeCreateRequest {
  receiver_user_id: string;
  offered_item_ids: string[];
  requested_item_ids: string[];
  message?: string | null;
}

export interface TradeOfferItemRead {
  id: string;
  trade_offer_id: string;
  side: TradeSide;
  collection_item_id: string;
  collection_item: CollectionItemRead | null;
}

export interface TradeOfferRead {
  id: string;
  sender_user_id: string;
  receiver_user_id: string;
  status: TradeStatus;
  message: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  items: TradeOfferItemRead[];
}

export interface TradeListResponse {
  total: number;
  items: TradeOfferRead[];
}
