import uuid
import json
from datetime import datetime
from typing import Literal

from fastapi.exceptions import RequestValidationError
from fastapi import File, Form, Request, UploadFile
from pydantic import BaseModel, HttpUrl, TypeAdapter, ValidationError, model_validator

from backend.app.models.media import MediaVisibility
from backend.app.schemas.relations import ExternalRefCreate


_external_ref_list_adapter = TypeAdapter(list[ExternalRefCreate])


def _request_validation_error(*, msg: str, input_value: object, loc: tuple[object, ...]) -> RequestValidationError:
    return RequestValidationError(
        [
            {
                "type": "value_error",
                "loc": loc,
                "msg": f"Value error, {msg}",
                "input": input_value,
                "ctx": {"error": msg},
            }
        ]
    )


def parse_external_refs_values(
    raw_values: list[str] | None,
    *,
    expected_count: int | None = None,
) -> list[list[ExternalRefCreate]] | None:
    if not raw_values:
        return None
    if expected_count is not None and len(raw_values) != expected_count:
        raise _request_validation_error(
            msg="external_refs_values must include exactly one JSON array per uploaded file",
            input_value=raw_values,
            loc=("body", "external_refs_values"),
        )

    parsed_values: list[list[ExternalRefCreate]] = []
    for index, raw_value in enumerate(raw_values):
        try:
            decoded = json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise _request_validation_error(
                msg=f"external_refs_values[{index}] must be valid JSON",
                input_value=raw_value,
                loc=("body", "external_refs_values", index),
            ) from exc

        try:
            parsed_values.append(_external_ref_list_adapter.validate_python(decoded))
        except ValidationError as exc:
            errors = []
            for error in exc.errors():
                errors.append(
                    {
                        **error,
                        "loc": ("body", "external_refs_values", index, *error["loc"]),
                    }
                )
            raise RequestValidationError(errors) from exc
    return parsed_values


class UploadResult(BaseModel):
    id: uuid.UUID | None = None
    batch_item_id: uuid.UUID | None = None
    original_filename: str
    status: Literal["accepted", "duplicate", "error"]
    message: str | None = None


class BatchUploadResponse(BaseModel):
    batch_id: uuid.UUID
    batch_url: str
    batch_items_url: str
    poll_after_seconds: int = 2
    webhooks_supported: bool = False
    accepted: int
    duplicates: int
    errors: int
    results: list[UploadResult]


class UploadConfigResponse(BaseModel):
    max_batch_size: int


class SetupRequiredResponse(BaseModel):
    setup_required: bool


class MediaUploadRequest(BaseModel):
    files: list[UploadFile]
    album_id: uuid.UUID | None = None
    tags: list[str] | None = None
    captured_at: datetime | None = None
    captured_at_values: list[datetime] | None = None
    external_refs_values: list[list[ExternalRefCreate]] | None = None
    visibility: MediaVisibility = MediaVisibility.private

    model_config = {
        "title": "MediaUploadRequest",
        "arbitrary_types_allowed": True,
    }

    @classmethod
    def as_form(
        cls,
        files: list[UploadFile] = File(...),
        album_id: uuid.UUID | None = Form(default=None),
        tags: list[str] | None = Form(default=None),
        captured_at: datetime | None = Form(default=None),
        captured_at_values: list[datetime] | None = Form(default=None),
        external_refs_values: list[str] | None = Form(default=None),
        visibility: MediaVisibility = Form(default=MediaVisibility.private),
    ) -> "MediaUploadRequest":
        return cls(
            files=files,
            album_id=album_id,
            tags=tags,
            captured_at=captured_at,
            captured_at_values=captured_at_values,
            external_refs_values=parse_external_refs_values(external_refs_values, expected_count=len(files)),
            visibility=visibility,
        )

    @classmethod
    async def from_request(
        cls,
        request: Request,
        *,
        max_files: int,
    ) -> "MediaUploadRequest":
        form = await request.form(max_files=max_files, max_fields=max_files * 2 + 20)
        files = form.getlist("files")
        try:
            return cls(
                files=files or None,
                album_id=form.get("album_id"),
                tags=form.getlist("tags") or None,
                captured_at=form.get("captured_at"),
                captured_at_values=form.getlist("captured_at_values") or None,
                external_refs_values=parse_external_refs_values(
                    form.getlist("external_refs_values") or None,
                    expected_count=len(files),
                ),
                visibility=form.get("visibility") or MediaVisibility.private,
            )
        except ValidationError as exc:
            raise RequestValidationError(exc.errors()) from exc


class MediaAnnotatedUploadRequest(BaseModel):
    files: list[UploadFile]
    album_id: uuid.UUID | None = None
    tags: list[str] | None = None
    character_names: list[str] | None = None
    series_names: list[str] | None = None
    captured_at: datetime | None = None
    captured_at_values: list[datetime] | None = None
    external_refs_values: list[list[ExternalRefCreate]] | None = None
    visibility: MediaVisibility = MediaVisibility.private

    model_config = {
        "title": "MediaAnnotatedUploadRequest",
        "arbitrary_types_allowed": True,
    }

    @model_validator(mode="after")
    def validate_annotations_present(self):
        if not any((self.tags, self.character_names, self.series_names)):
            raise ValueError("At least one of tags, character_names, or series_names must be provided")
        return self

    @classmethod
    def as_form(
        cls,
        files: list[UploadFile] = File(...),
        album_id: uuid.UUID | None = Form(default=None),
        tags: list[str] | None = Form(default=None),
        character_names: list[str] | None = Form(default=None),
        series_names: list[str] | None = Form(default=None),
        captured_at: datetime | None = Form(default=None),
        captured_at_values: list[datetime] | None = Form(default=None),
        external_refs_values: list[str] | None = Form(default=None),
        visibility: MediaVisibility = Form(default=MediaVisibility.private),
    ) -> "MediaAnnotatedUploadRequest":
        try:
            return cls(
                files=files,
                album_id=album_id,
                tags=tags,
                character_names=character_names,
                series_names=series_names,
                captured_at=captured_at,
                captured_at_values=captured_at_values,
                external_refs_values=parse_external_refs_values(external_refs_values, expected_count=len(files)),
                visibility=visibility,
            )
        except ValidationError as exc:
            raise RequestValidationError(exc.errors()) from exc

    @classmethod
    async def from_request(
        cls,
        request: Request,
        *,
        max_files: int,
    ) -> "MediaAnnotatedUploadRequest":
        form = await request.form(max_files=max_files, max_fields=max_files * 2 + 20)
        files = form.getlist("files")
        try:
            return cls(
                files=files or None,
                album_id=form.get("album_id"),
                tags=form.getlist("tags") or None,
                character_names=form.getlist("character_names") or None,
                series_names=form.getlist("series_names") or None,
                captured_at=form.get("captured_at"),
                captured_at_values=form.getlist("captured_at_values") or None,
                external_refs_values=parse_external_refs_values(
                    form.getlist("external_refs_values") or None,
                    expected_count=len(files),
                ),
                visibility=form.get("visibility") or MediaVisibility.private,
            )
        except ValidationError as exc:
            raise RequestValidationError(exc.errors()) from exc


class UrlIngestRequest(BaseModel):
    url: HttpUrl
    tags: list[str] | None = None
    album_id: uuid.UUID | None = None
    captured_at: datetime | None = None
    external_refs: list[ExternalRefCreate] | None = None
    visibility: MediaVisibility = MediaVisibility.private
