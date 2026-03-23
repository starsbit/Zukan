from fastapi import HTTPException


class AppError(HTTPException):
    def __init__(self, status_code: int, code: str, detail: str):
        super().__init__(status_code=status_code, detail={"code": code, "detail": detail})


# Auth
not_authenticated = "not_authenticated"
forbidden = "forbidden"
admin_required = "admin_required"
invalid_credentials = "invalid_credentials"
invalid_token = "invalid_token"
invalid_refresh_token = "invalid_refresh_token"

# Users
user_not_found = "user_not_found"
duplicate_username = "duplicate_username"
duplicate_email = "duplicate_email"

# Media
media_not_found = "media_not_found"
media_in_trash = "media_in_trash"
media_not_in_trash = "media_not_in_trash"
nsfw_hidden = "nsfw_hidden"
nsfw_disabled = "nsfw_disabled"
thumbnail_not_available = "thumbnail_not_available"
poster_not_available = "poster_not_available"

# Upload
upload_limit_exceeded = "upload_limit_exceeded"
unsupported_media_type = "unsupported_media_type"

# Tags
tag_not_found = "tag_not_found"

# Albums
album_not_found = "album_not_found"
album_empty = "album_empty"
album_read_only = "album_read_only"
album_share_forbidden = "album_share_forbidden"
media_not_in_album = "media_not_in_album"
share_not_found = "share_not_found"
share_self = "share_self"

# Tagging jobs
tagging_job_already_queued = "tagging_job_already_queued"

# Concurrency
version_conflict = "version_conflict"

# Pagination
invalid_cursor = "invalid_cursor"
