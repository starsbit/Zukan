#!/usr/bin/env bash
# Import a Zukan data archive created by export-production-data.sh.
#
# This restores the PostgreSQL dump, imports media files into the current
# install's storage volume, and rewrites stored media paths when the source and
# target storage roots differ.

set -euo pipefail

ARCHIVE=""
COMPOSE_FILE=""
ENV_FILE=""
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zukan}"
YES=0
REPLACE_STORAGE=0
NO_START=0
TARGET_STORAGE_DIR="${ZUKAN_IMPORT_STORAGE_DIR:-}"
TEMP_DIR=""

info() { printf '  [INFO]  %s\n' "$*"; }
ok() { printf '  [OK]    %s\n' "$*"; }
warn() { printf '  [WARN]  %s\n' "$*" >&2; }
fail() { printf '  [ERROR] %s\n' "$*" >&2; exit 1; }

cleanup_temp_dir() {
    if [ -n "${TEMP_DIR:-}" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
}

trap cleanup_temp_dir EXIT

usage() {
    cat <<USAGE
Usage:
  $0 ARCHIVE [options]

Import a Zukan archive into the current Docker Compose install. Database data is
replaced. Media files are copied into the target storage volume.

Options:
  --compose-file PATH       Compose file. Default: auto-detect
  --env-file PATH           Compose env file. Default: auto-detect
  --project-name NAME       Docker Compose project name. Default: zukan
  --target-storage-dir DIR  Path value to store in media rows. Default: detect
  --replace-storage         Clear existing media files before unpacking archive
  --yes                     Do not prompt for confirmation
  --no-start                Do not restart compose services after import
  -h, --help                Show this help

Examples:
  $0 ./prod-data.tar.gz --yes
  $0 ./prod-data.tar.gz --compose-file docker-compose.yml --replace-storage
USAGE
}

detect_compose_file() {
    if [ -n "$COMPOSE_FILE" ]; then
        printf "%s\n" "$COMPOSE_FILE"
        return
    fi

    for candidate in \
        "./docker-compose.yml" \
        "./docker-compose.prod.yml" \
        "/opt/zukan/docker-compose.yml" \
        "/opt/zukan/docker-compose.prod.yml"
    do
        if [ -f "$candidate" ]; then
            printf "%s\n" "$candidate"
            return
        fi
    done

    fail "Could not find a compose file. Pass --compose-file PATH."
}

detect_env_file() {
    if [ -n "$ENV_FILE" ]; then
        printf "%s\n" "$ENV_FILE"
        return
    fi

    local compose_dir
    compose_dir="$(cd "$(dirname "$1")" && pwd)"
    if [ -f "${compose_dir}/.env" ]; then
        printf "%s\n" "${compose_dir}/.env"
    fi
}

compose_cmd() {
    local compose_file="$1"
    local env_file="$2"
    shift 2

    if [ -n "$env_file" ]; then
        docker compose -p "$PROJECT_NAME" -f "$compose_file" --env-file "$env_file" "$@"
    else
        docker compose -p "$PROJECT_NAME" -f "$compose_file" "$@"
    fi
}

container_env_or_default() {
    local compose_file="$1"
    local env_file="$2"
    local service="$3"
    local key="$4"
    local default_value="$5"
    local value

    value="$(compose_cmd "$compose_file" "$env_file" exec -T "$service" printenv "$key" 2>/dev/null || true)"
    if [ -n "$value" ]; then
        printf "%s\n" "$value"
    else
        printf "%s\n" "$default_value"
    fi
}

manifest_value() {
    local manifest="$1"
    local key="$2"
    awk -F= -v wanted="$key" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }' "$manifest"
}

strip_trailing_slashes() {
    local value="$1"
    while [ "$value" != "/" ] && [ "${value%/}" != "$value" ]; do
        value="${value%/}"
    done
    printf "%s\n" "$value"
}

detect_target_storage_dir() {
    local compose_file="$1"
    local env_file="$2"
    local value="$TARGET_STORAGE_DIR"

    if [ -n "$value" ]; then
        strip_trailing_slashes "$value"
        return
    fi

    value="$(
        compose_cmd "$compose_file" "$env_file" exec -T api \
            python -c 'from backend.app.config import settings; print(settings.storage_dir)' 2>/dev/null || true
    )"
    if [ -z "$value" ]; then
        value="$(
            compose_cmd "$compose_file" "$env_file" run --rm --no-deps -T api \
                python -c 'from backend.app.config import settings; print(settings.storage_dir)' 2>/dev/null || true
        )"
    fi
    if [ -z "$value" ]; then
        value="storage"
    fi

    strip_trailing_slashes "$value"
}

confirm_import() {
    local compose_file="$1"
    local archive="$2"

    if [ "$YES" = "1" ]; then
        return
    fi
    if [ ! -t 0 ]; then
        fail "Refusing destructive import without an interactive prompt. Re-run with --yes."
    fi

    warn "This will replace the database for compose file: $compose_file"
    warn "Archive: $archive"
    if [ "$REPLACE_STORAGE" = "1" ]; then
        warn "Existing media files in the target storage volume will also be deleted first."
    fi
    printf "Type IMPORT to continue: "
    read -r answer
    if [ "$answer" != "IMPORT" ]; then
        fail "Import cancelled."
    fi
}

restore_database() {
    local compose_file="$1"
    local env_file="$2"
    local dump_file="$3"
    local db_user="$4"
    local db_name="$5"

    info "Resetting public schema in database '$db_name'."
    compose_cmd "$compose_file" "$env_file" exec -T db \
        psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" \
        -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS vector;"

    info "Restoring PostgreSQL schema."
    compose_cmd "$compose_file" "$env_file" exec -T db \
        pg_restore --exit-on-error --no-owner --no-acl --section=pre-data -U "$db_user" -d "$db_name" \
        < "$dump_file"

    info "Restoring PostgreSQL data."
    compose_cmd "$compose_file" "$env_file" exec -T db \
        pg_restore --exit-on-error --no-owner --no-acl --section=data -U "$db_user" -d "$db_name" \
        < "$dump_file"

    cleanup_restored_data "$compose_file" "$env_file" "$db_user" "$db_name" "${TEMP_DIR}/dedupe-restore.sql"

    info "Restoring PostgreSQL constraints and indexes."
    compose_cmd "$compose_file" "$env_file" exec -T db \
        pg_restore --exit-on-error --no-owner --no-acl --section=post-data -U "$db_user" -d "$db_name" \
        < "$dump_file"
}

cleanup_restored_data() {
    local compose_file="$1"
    local env_file="$2"
    local db_user="$3"
    local db_name="$4"
    local sql_file="$5"

    cat > "$sql_file" <<'SQL'
\set ON_ERROR_STOP on

DO $$
DECLARE
    duplicate_tag_groups integer := 0;
    duplicate_entity_groups integer := 0;
BEGIN
    SELECT count(*) INTO duplicate_tag_groups
    FROM (
        SELECT owner_user_id, name
        FROM tags
        GROUP BY owner_user_id, name
        HAVING count(*) > 1
    ) duplicates;

    IF duplicate_tag_groups > 0 THEN
        RAISE NOTICE 'Merging % duplicate tag group(s) before constraints are restored', duplicate_tag_groups;
    END IF;

    SELECT count(*) INTO duplicate_entity_groups
    FROM (
        SELECT owner_user_id, entity_type, normalized_name
        FROM owned_entities
        GROUP BY owner_user_id, entity_type, normalized_name
        HAVING count(*) > 1
    ) duplicates;

    IF duplicate_entity_groups > 0 THEN
        RAISE NOTICE 'Merging % duplicate owned entity group(s) before indexes are restored', duplicate_entity_groups;
    END IF;
END $$;

WITH ranked AS (
    SELECT
        id,
        first_value(id) OVER (
            PARTITION BY owner_user_id, name
            ORDER BY media_count DESC, id
        ) AS keep_id
    FROM tags
)
UPDATE media_tags AS mt
SET tag_id = ranked.keep_id
FROM ranked
WHERE mt.tag_id = ranked.id
  AND ranked.id <> ranked.keep_id;

DELETE FROM media_tags AS mt
USING (
    SELECT
        ctid,
        row_number() OVER (
            PARTITION BY media_id, tag_id
            ORDER BY
                CASE source
                    WHEN 'manual' THEN 0
                    WHEN 'imported' THEN 1
                    ELSE 2
                END,
                confidence DESC,
                created_at DESC NULLS LAST,
                ctid
        ) AS row_number
    FROM media_tags
) AS ranked
WHERE mt.ctid = ranked.ctid
  AND ranked.row_number > 1;

WITH ranked AS (
    SELECT
        id,
        first_value(id) OVER (
            PARTITION BY owner_user_id, name
            ORDER BY media_count DESC, id
        ) AS keep_id
    FROM tags
)
DELETE FROM tags AS t
USING ranked
WHERE t.id = ranked.id
  AND ranked.id <> ranked.keep_id;

UPDATE tags SET media_count = 0;

UPDATE tags AS t
SET media_count = counts.media_count
FROM (
    SELECT tag_id, count(*)::int AS media_count
    FROM media_tags
    GROUP BY tag_id
) AS counts
WHERE counts.tag_id = t.id;

WITH ranked AS (
    SELECT
        id,
        first_value(id) OVER (
            PARTITION BY owner_user_id, entity_type, normalized_name
            ORDER BY media_count DESC, updated_at DESC NULLS LAST, id
        ) AS keep_id
    FROM owned_entities
)
UPDATE media_entities AS me
SET entity_id = ranked.keep_id
FROM ranked
WHERE me.entity_id = ranked.id
  AND ranked.id <> ranked.keep_id;

DO $$
BEGIN
    IF to_regclass('public.library_classification_feedback') IS NOT NULL THEN
        EXECUTE $dedupe$
            WITH ranked AS (
                SELECT
                    id,
                    first_value(id) OVER (
                        PARTITION BY owner_user_id, entity_type, normalized_name
                        ORDER BY media_count DESC, updated_at DESC NULLS LAST, id
                    ) AS keep_id
                FROM owned_entities
            )
            UPDATE library_classification_feedback AS feedback
            SET suggested_entity_id = ranked.keep_id
            FROM ranked
            WHERE feedback.suggested_entity_id = ranked.id
              AND ranked.id <> ranked.keep_id
        $dedupe$;
    END IF;
END $$;

WITH ranked AS (
    SELECT
        id,
        first_value(id) OVER (
            PARTITION BY owner_user_id, entity_type, normalized_name
            ORDER BY media_count DESC, updated_at DESC NULLS LAST, id
        ) AS keep_id
    FROM owned_entities
)
DELETE FROM owned_entities AS oe
USING ranked
WHERE oe.id = ranked.id
  AND ranked.id <> ranked.keep_id;

UPDATE owned_entities SET media_count = 0;

UPDATE owned_entities AS oe
SET media_count = counts.media_count
FROM (
    SELECT entity_id, count(DISTINCT media_id)::int AS media_count
    FROM media_entities
    WHERE entity_id IS NOT NULL
    GROUP BY entity_id
) AS counts
WHERE counts.entity_id = oe.id;
SQL

    info "Normalizing duplicate tags and owned entities before constraints."
    compose_cmd "$compose_file" "$env_file" exec -T db \
        psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" \
        < "$sql_file"
}

import_storage() {
    local compose_file="$1"
    local env_file="$2"
    local storage_tar="$3"

    if [ "$REPLACE_STORAGE" = "1" ]; then
        info "Clearing target storage volume."
        compose_cmd "$compose_file" "$env_file" run --rm --no-deps -T api \
            sh -c 'find /backend/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} +'
    fi

    info "Unpacking media storage."
    compose_cmd "$compose_file" "$env_file" run --rm --no-deps -T api \
        tar -C /backend/storage -xf - \
        < "$storage_tar"
}

rewrite_media_paths() {
    local compose_file="$1"
    local env_file="$2"
    local source_storage_dir="$3"
    local target_storage_dir="$4"
    local db_user="$5"
    local db_name="$6"
    local sql_file="$7"

    cat > "$sql_file" <<'SQL'
\set ON_ERROR_STOP on
WITH params AS (
    SELECT :'source_storage_dir'::text AS source_root, :'target_storage_dir'::text AS target_root
), roots AS (
    SELECT DISTINCT root, target_root
    FROM params, unnest(ARRAY[source_root, '/backend/storage', 'storage']) AS root
    WHERE root IS NOT NULL AND root <> '' AND root <> target_root
)
UPDATE media AS m
SET filepath = roots.target_root || substring(m.filepath FROM char_length(roots.root) + 1)
FROM roots
WHERE m.filepath = roots.root OR m.filepath LIKE roots.root || '/%';

WITH params AS (
    SELECT :'source_storage_dir'::text AS source_root, :'target_storage_dir'::text AS target_root
), roots AS (
    SELECT DISTINCT root, target_root
    FROM params, unnest(ARRAY[source_root, '/backend/storage', 'storage']) AS root
    WHERE root IS NOT NULL AND root <> '' AND root <> target_root
)
UPDATE media AS m
SET thumbnail_path = roots.target_root || substring(m.thumbnail_path FROM char_length(roots.root) + 1)
FROM roots
WHERE m.thumbnail_path IS NOT NULL
  AND (m.thumbnail_path = roots.root OR m.thumbnail_path LIKE roots.root || '/%');

WITH params AS (
    SELECT :'source_storage_dir'::text AS source_root, :'target_storage_dir'::text AS target_root
), roots AS (
    SELECT DISTINCT root, target_root
    FROM params, unnest(ARRAY[source_root, '/backend/storage', 'storage']) AS root
    WHERE root IS NOT NULL AND root <> '' AND root <> target_root
)
UPDATE media AS m
SET poster_path = roots.target_root || substring(m.poster_path FROM char_length(roots.root) + 1)
FROM roots
WHERE m.poster_path IS NOT NULL
  AND (m.poster_path = roots.root OR m.poster_path LIKE roots.root || '/%');
SQL

    info "Adjusting media paths from '$source_storage_dir' to '$target_storage_dir'."
    compose_cmd "$compose_file" "$env_file" exec -T db \
        psql \
        -v source_storage_dir="$source_storage_dir" \
        -v target_storage_dir="$target_storage_dir" \
        -v ON_ERROR_STOP=1 \
        -U "$db_user" \
        -d "$db_name" \
        < "$sql_file"
}

run_import() {
    local compose_file
    local env_file
    local manifest
    local source_storage_dir
    local target_storage_dir
    local db_user
    local db_name

    command -v docker >/dev/null 2>&1 || fail "docker is required."
    [ -n "$ARCHIVE" ] || fail "Archive path is required."
    [ -f "$ARCHIVE" ] || fail "Archive not found: $ARCHIVE"

    compose_file="$(detect_compose_file)"
    env_file="$(detect_env_file "$compose_file")"

    TEMP_DIR="$(mktemp -d)"

    info "Extracting archive."
    tar -xzf "$ARCHIVE" -C "$TEMP_DIR"

    manifest="${TEMP_DIR}/manifest.env"
    [ -f "$manifest" ] || fail "Archive is missing manifest.env."
    [ -f "${TEMP_DIR}/database.dump" ] || fail "Archive is missing database.dump."
    [ -f "${TEMP_DIR}/storage.tar" ] || fail "Archive is missing storage.tar."

    source_storage_dir="$(manifest_value "$manifest" source_storage_dir)"
    source_storage_dir="$(strip_trailing_slashes "${source_storage_dir:-storage}")"
    target_storage_dir="$(detect_target_storage_dir "$compose_file" "$env_file")"

    info "Using compose file: $compose_file"
    if [ -n "$env_file" ]; then
        info "Using env file: $env_file"
    fi
    info "Target storage path in DB rows: $target_storage_dir"

    db_user="$(container_env_or_default "$compose_file" "$env_file" db POSTGRES_USER zukan)"
    db_name="$(container_env_or_default "$compose_file" "$env_file" db POSTGRES_DB zukan)"

    confirm_import "$compose_file" "$ARCHIVE"

    info "Stopping app containers before database restore."
    compose_cmd "$compose_file" "$env_file" stop api frontend >/dev/null 2>&1 || true
    compose_cmd "$compose_file" "$env_file" up -d db >/dev/null

    restore_database "$compose_file" "$env_file" "${TEMP_DIR}/database.dump" "$db_user" "$db_name"
    import_storage "$compose_file" "$env_file" "${TEMP_DIR}/storage.tar"
    rewrite_media_paths "$compose_file" "$env_file" "$source_storage_dir" "$target_storage_dir" "$db_user" "$db_name" "${TEMP_DIR}/rewrite-paths.sql"

    if [ "$NO_START" = "1" ]; then
        ok "Import complete. Services were left stopped because --no-start was set."
    else
        info "Starting compose services."
        compose_cmd "$compose_file" "$env_file" up -d >/dev/null
        ok "Import complete."
    fi
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --compose-file)
            COMPOSE_FILE="$2"
            shift 2
            ;;
        --env-file)
            ENV_FILE="$2"
            shift 2
            ;;
        --project-name)
            PROJECT_NAME="$2"
            shift 2
            ;;
        --target-storage-dir)
            TARGET_STORAGE_DIR="$2"
            shift 2
            ;;
        --replace-storage)
            REPLACE_STORAGE=1
            shift
            ;;
        --yes)
            YES=1
            shift
            ;;
        --no-start)
            NO_START=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            fail "Unknown option: $1"
            ;;
        *)
            if [ -z "$ARCHIVE" ]; then
                ARCHIVE="$1"
                shift
            else
                fail "Unexpected argument: $1"
            fi
            ;;
    esac
done

run_import
