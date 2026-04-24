export interface UserSelfRead {
  id: string;
  username: string;
  email: string;
  show_nsfw: boolean;
  show_sensitive?: boolean;
  tag_confidence_threshold: number;
  library_classification_enabled?: boolean;
  version: number;
  created_at: string;
}

export interface UserRead {
  id: string;
  username: string;
  email: string;
  is_admin: boolean;
  show_nsfw: boolean;
  show_sensitive?: boolean;
  tag_confidence_threshold: number;
  library_classification_enabled?: boolean;
  version: number;
  created_at: string;
  storage_quota_mb: number;
  storage_used_mb: number;
}

export interface UserRegister {
  username: string;
  email: string;
  password: string;
}

export interface UserLogin {
  username: string;
  password: string;
  remember_me: boolean;
}

export interface UserUpdate {
  show_nsfw?: boolean | null;
  show_sensitive?: boolean | null;
  tag_confidence_threshold?: number | null;
  library_classification_enabled?: boolean | null;
  password?: string | null;
  version?: number | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface ApiKeyStatusResponse {
  has_key: boolean;
  created_at: string | null;
  last_used_at: string | null;
}

export interface ApiKeyCreateResponse extends ApiKeyStatusResponse {
  api_key: string;
}
