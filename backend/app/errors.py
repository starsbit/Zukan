from fastapi import HTTPException


class AppError(HTTPException):
    def __init__(self, status_code: int, code: str, detail: str):
        super().__init__(status_code=status_code, detail={"code": code, "detail": detail})


not_authenticated = "not_authenticated"
forbidden = "forbidden"
admin_required = "admin_required"
media_not_found = "media_not_found"
media_in_trash = "media_in_trash"
media_not_in_trash = "media_not_in_trash"
nsfw_hidden = "nsfw_hidden"
album_not_found = "album_not_found"
album_empty = "album_empty"
album_read_only = "album_read_only"
album_share_forbidden = "album_share_forbidden"
media_not_in_album = "media_not_in_album"
share_not_found = "share_not_found"
share_self = "share_self"
tag_not_found = "tag_not_found"
user_not_found = "user_not_found"
duplicate_username = "duplicate_username"
duplicate_email = "duplicate_email"
invalid_credentials = "invalid_credentials"
invalid_token = "invalid_token"
invalid_refresh_token = "invalid_refresh_token"
upload_limit_exceeded = "upload_limit_exceeded"
unsupported_media_type = "unsupported_media_type"
thumbnail_not_available = "thumbnail_not_available"
nsfw_disabled = "nsfw_disabled"
