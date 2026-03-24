# Zukan Public API Contract

This document defines the public API behavior expected by external clients.

## 1. Auth Model

- Authentication uses OAuth2 password flow against `POST /api/v1/auth/login`.
- Access tokens are bearer JWTs sent as `Authorization: Bearer <token>`.
- Refresh flow uses `POST /api/v1/auth/refresh` with refresh token in JSON body.
- Logout uses `POST /api/v1/auth/logout` and is safe to repeat (`204` even when token is already revoked or unknown).

## 2. Token Lifetime and Refresh

- `access_token_expire_minutes`: configured in settings.
- `refresh_token_expire_days`: configured in settings.
- `remember_me_refresh_token_expire_days`: configured in settings when remember-me login is used.
- Refresh token rotation is enforced on `POST /auth/refresh`.

## 3. File Limits

- `max_upload_size_mb`: per-file upload size limit.
- `max_batch_size`: maximum files in one upload request.
- `/api/v1/config/upload` returns these limits for client-side enforcement.

## 4. Rate Limits

Rate limits are enforced per client IP and endpoint scope.

- Register: `auth_register_rate_limit_requests` per `auth_register_rate_limit_window_seconds`
- Login: `auth_login_rate_limit_requests` per `auth_login_rate_limit_window_seconds`
- Refresh: `auth_refresh_rate_limit_requests` per `auth_refresh_rate_limit_window_seconds`
- Upload: `upload_rate_limit_requests` per `upload_rate_limit_window_seconds`

When exceeded, API returns `429` with:

- `code: rate_limit_exceeded`
- `details.retry_after_seconds`

## 5. Share and Visibility Model

- Albums are private to owner by default.
- Album sharing is owner-managed via `/api/v1/albums/{album_id}/shares`.
- Share roles for create/update: `viewer`, `editor`.
- Ownership transfer is a distinct owner-only operation: `POST /api/v1/albums/{album_id}/owner/transfer`.
- Shared album media is accessible through album-scoped listing and `/media?album_id=...`.
- Non-admin media visibility rules apply for NSFW filtering and trashed ownership.

## 6. 404 vs 403 Semantics

Behavior is intentionally conservative to prevent resource enumeration.

- `404` is used when a resource is not visible to the caller (for example inaccessible album/media in many object-level checks).
- `403` is used when resource existence is known but operation is forbidden in current context (for example read-only share role modifying album).
- `409` is used for optimistic-lock conflicts and idempotency key payload conflicts.
- `422` is used for request validation and invalid state transitions.

## 7. Retention and Deletion Semantics

- Soft delete moves media to trash (`deleted_at` set).
- `POST /api/v1/media/actions/empty-trash` permanently purges trashed items visible to the caller.
- Expired trash is auto-purged by retention policy (`TRASH_RETENTION_DAYS`).
- Purged media is no longer retrievable and duplicate detection may allow re-upload.

## 8. Idempotency and Retries

`Idempotency-Key` is supported on selected mutation endpoints:

- `POST /api/v1/media`
- `PATCH /api/v1/media`
- `POST /api/v1/media/actions/delete`
- `POST /api/v1/media/actions/purge`
- `POST /api/v1/albums/{album_id}/shares`

Rules:

- Same key + same payload returns replay of original response.
- Same key + different payload returns `409` (`idempotency_key_conflict`).
- Without key, normal non-idempotent behavior applies.

## 9. Admin Boundary

- `/api/v1/auth/register` uses a public user response model and does not expose `is_admin`.
- `/api/v1/me` is a self-profile endpoint and may expose caller role state used by first-party clients.
- Admin-only user visibility and mutation semantics are isolated under `/api/v1/admin/...`.

## 10. Optimistic Locking Contract

- Versioned update endpoints accept an optional `version` field for optimistic locking.
- If the provided `version` does not match the persisted resource version, API returns `409` with `code: version_conflict`.
- Conflict responses include `details.current_version` (current persisted version) and `details.provided_version` (version sent by client).
- Version mismatch behavior is consistent across versioned user, album, and media update operations.

## 11. Async Upload Job Contract

- `POST /api/v1/media` returns `202` and includes a concrete upload job identifier:
  - `batch_id`
  - `batch_url` (`/api/v1/me/import-batches/{batch_id}`)
  - `batch_items_url` (`/api/v1/me/import-batches/{batch_id}/items`)
- Clients poll `batch_url` for aggregate progress/status and `batch_items_url` for per-file state.
- `results[*].batch_item_id` correlates each upload result row with a specific import batch item.
- `results[*].id` (media id) can be correlated with `import_batch_items.media_id` and media detail/tagging state endpoints.
- Current webhook support is explicit: `webhooks_supported=false` in upload responses.

## 12. Media Filtering and Search Contract

- `GET /api/v1/media` is the lightweight browse endpoint.
- `GET /api/v1/media/search` is the advanced filtering and discovery endpoint.

Browse (`GET /api/v1/media`) supports:

- Scope: `state`, `album_id`
- Ordering and pagination: `sort_by`, `sort_order`, `after`, `page_size`, `include_total`

Advanced filtering belongs on `GET /api/v1/media/search`.

Filter groups:

- Scope and lifecycle: `state`, `album_id`, `favorited`
- Content and classification: `tag`, `exclude_tag`, `character_name`, `media_type`, `nsfw`, `status`
- Time and metadata: `captured_year`, `captured_month`, `captured_day`, `captured_after`, `captured_before`, `captured_before_year`
- Ranking and pagination: `sort_by`, `sort_order`, `after`, `page_size`, `include_total`

Precedence rules:

- Scope filters apply first.
- Visibility guardrails apply next (for example `nsfw=only` requires NSFW visibility).
- Content and metadata filters are then composed to narrow the result set.
- Sorting and cursor pagination are applied last.

Notable combinations:

- `nsfw=only` with NSFW disabled returns `403`.
- For `state=trashed`, NSFW inclusion flags are not applied.
- `include_total=false` skips total count computation for lower latency.
