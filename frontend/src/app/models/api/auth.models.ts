import type { Uuid } from './common.models';

export interface UserRegisterDto {
  username: string;
  email: string;
  password: string;
}

export interface UserLoginDto {
  username: string;
  password: string;
  remember_me?: boolean;
}

export interface RefreshRequestDto {
  refresh_token: string;
}

export interface LogoutRequestDto {
  refresh_token: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
}

export interface AccessTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
}

export interface AuthenticatedUser {
  id: Uuid;
  username: string;
  email: string;
  is_admin: boolean;
  show_nsfw: boolean;
  created_at: string;
}
