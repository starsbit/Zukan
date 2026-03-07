# Zukan Backend Roadmap

Features are ordered by dependency. Each phase builds on the previous.

---

## Phase 1 — Foundation

These two have no dependencies on new features and unblock everything else.

### ~~Thumbnails~~ ✅

**Why first:** Every browsing endpoint returns full-res images without this. The frontend will need thumbnails before it can reasonably display a grid.

**DB changes:**
- Add `thumbnail_path VARCHAR(1024)` to `images`
- Add `thumbnail_status` (mirrors `tagging_status`: `pending | done | failed`)

**Implementation:**
- Generate thumbnail in the tagging worker immediately after saving the file, before queuing for AI tagging
- Use Pillow: pad to square → resize to 512×512 → save as WebP (best size/quality ratio)
- Store under `storage/{xx}/{uuid}_thumb.webp` alongside the original
- New endpoint: `GET /images/{id}/thumbnail` — serves the WebP thumbnail

**New endpoints:**
```
GET /images/{id}/thumbnail
```

---

### ~~Soft Delete~~ ✅

**Why first:** Affects every image query. Better to add it now before albums and favorites reference deleted images.

**DB changes:**
- Add `deleted_at TIMESTAMP NULL` to `images`
- Add index on `deleted_at`

**Implementation:**
- All existing queries add `WHERE deleted_at IS NULL` by default
- `DELETE /images/{id}` moves to trash (sets `deleted_at`) instead of hard-deleting
- New `purge` endpoint for permanent deletion (also deletes file from disk)
- New `restore` endpoint

**New endpoints:**
```
DELETE /images/{id}              → now moves to trash (was hard delete)
POST   /images/{id}/restore      → restore from trash
DELETE /images/{id}/purge        → permanent delete (owner or admin)
GET    /images/trash             → list trashed images (owner or admin)
POST   /images/trash/empty       → purge all trashed images for current user
```

---

## Phase 2 — Library Organisation

### Favorites

**DB changes:**
- New table `user_favorites (user_id UUID FK, image_id UUID FK, created_at)`
- Composite PK on `(user_id, image_id)`

**Implementation:**
- Favorites are per-user
- `GET /images` gains `?favorited=true` filter
- `GET /images/{id}` response gains `is_favorited: bool` field (requires knowing the requesting user)

**New endpoints:**
```
POST   /images/{id}/favorite     → add to favorites
DELETE /images/{id}/favorite     → remove from favorites
GET    /images/favorites         → list favorited images (paginated, tag-filterable)
```

---

### Albums

**DB changes:**
- New table `albums (id UUID PK, owner_id FK, name VARCHAR(255), description TEXT, cover_image_id UUID NULL FK, created_at, updated_at)`
- New table `album_images (album_id UUID FK, image_id UUID FK, added_at, position INT)` — position allows manual ordering
- New table `album_shares (album_id UUID FK, user_id UUID FK, can_edit BOOL)` — share album with another user

**Implementation:**
- Albums are owned by a user; other users can be granted read or edit access via `album_shares`
- Images in an album are not copies — they reference the same `images` row
- Deleting an image removes it from all albums
- Cover image defaults to the first image added; can be set manually

**New endpoints:**
```
POST   /albums                        → create album
GET    /albums                        → list own albums (+ shared-with-me)
GET    /albums/{id}                   → album metadata
GET    /albums/{id}/images            → images in album (paginated, tag-filterable)
PATCH  /albums/{id}                   → rename, update description, set cover
DELETE /albums/{id}                   → delete album (images are NOT deleted)
POST   /albums/{id}/images            → add image(s) to album
DELETE /albums/{id}/images/{image_id} → remove image from album
POST   /albums/{id}/share             → share with another user {user_id, can_edit}
DELETE /albums/{id}/share/{user_id}   → revoke share
```

---

## Phase 3 — Power Features

### Bulk Operations

**Why here:** Natural to add after favorites and albums exist, since most bulk ops target them.

**Implementation:**
- All bulk endpoints accept a JSON body `{"image_ids": ["uuid1", "uuid2", ...]}`
- Ownership is enforced per-image; non-owned images in the list are skipped (not errored), response includes a `skipped` count
- Cap at 500 images per request

**New endpoints:**
```
POST /images/bulk/delete           → bulk soft-delete
POST /images/bulk/restore          → bulk restore from trash
POST /images/bulk/purge            → bulk permanent delete (owner or admin)
POST /images/bulk/favorite         → bulk add to favorites
DELETE /images/bulk/favorite       → bulk remove from favorites
POST /images/bulk/album            → bulk add to album {album_id, image_ids}
DELETE /images/bulk/album          → bulk remove from album {album_id, image_ids}
```

---

### Download as ZIP

**Implementation:**
- Stream the ZIP using Python's `zipfile` module with `ZIP_STORED` (images are already compressed)
- Use `StreamingResponse` in FastAPI — do not buffer the whole ZIP in memory
- Accept either a list of image IDs or an album ID
- Filename inside ZIP: `{original_filename}` with collision suffix if duplicate
- Cap at 500 images per request; return 400 if exceeded

**New endpoints:**
```
POST /images/download              → zip by image ID list {image_ids: [...]}
GET  /albums/{id}/download         → zip entire album
```

---

## Phase 4 — Admin & Discovery

### Admin Panel

Expose management capabilities for admins. All endpoints require `is_admin=true`.

**New endpoints:**
```
GET    /admin/users                → list all users (paginated)
GET    /admin/users/{id}          → user detail + stats (image count, storage used)
PATCH  /admin/users/{id}          → update is_admin, show_nsfw
DELETE /admin/users/{id}          → delete user + optionally their images
GET    /admin/stats                → totals: users, images, storage used, pending tagging
POST   /admin/users/{id}/retag-all → re-queue all of a user's images for tagging
```

**Stats response shape:**
```json
{
  "total_users": 12,
  "total_images": 48320,
  "total_storage_bytes": 183204938,
  "pending_tagging": 4,
  "failed_tagging": 1,
  "trashed_images": 93
}
```

---

### "On This Day"

**Implementation:**
- Query `images` where `EXTRACT(month FROM created_at) = current_month AND EXTRACT(day FROM created_at) = current_day AND EXTRACT(year FROM created_at) < current_year`
- Group results by year
- Respects NSFW setting and soft-delete filter
- No DB changes needed

**New endpoints:**
```
GET /images/on-this-day            → images from same calendar day in past years, grouped by year
```

---

## Summary

| Phase | Feature            | New tables              | New endpoints |
|-------|--------------------|-------------------------|---------------|
| 1     | Thumbnails         | —                       | 1             |
| 1     | Soft delete        | —                       | 5             |
| 2     | Favorites          | `user_favorites`        | 3             |
| 2     | Albums             | `albums`, `album_images`, `album_shares` | 11 |
| 3     | Bulk operations    | —                       | 7             |
| 3     | Download as ZIP    | —                       | 2             |
| 4     | Admin panel        | —                       | 6             |
| 4     | On this day        | —                       | 1             |
