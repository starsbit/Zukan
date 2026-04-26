#!/usr/bin/env bash
# Export a complete Zukan install into one archive.
#
# The archive contains:
#   - database.dump: PostgreSQL custom-format dump, including tags/embeddings
#   - storage.tar:   media files, thumbnails, posters, etc.
#   - manifest.env:  small metadata file used by the import script

set -euo pipefail

SSH_TARGET=""
PCT_ID=""
REMOTE_DIR="/opt/zukan"
COMPOSE_FILE=""
ENV_FILE=""
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zukan}"
OUTPUT=""
STDOUT=0
REMOTE_RUN=0
TEMP_DIR=""

info() { printf '  [INFO]  %s\n' "$*" >&2; }
ok() { printf '  [OK]    %s\n' "$*" >&2; }
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
  $0 --ssh user@host [options]
  $0 --pct CTID [options]
  $0 [options]

Create a single Zukan data archive. With --ssh, the dump is created on the
remote host and streamed back to this machine. Add --pct when SSH lands on a
Proxmox host and Zukan runs inside an LXC created by install-lxc.sh.

Options:
  --ssh TARGET         SSH target, for example root@zukan.example.com
  --pct CTID           Proxmox LXC container ID to enter with pct exec
  --remote-dir PATH    Remote install directory. Default: /opt/zukan
  --compose-file PATH  Compose file on the target host. Default: auto-detect
  --env-file PATH      Compose env file on the target host. Default: auto-detect
  --project-name NAME  Docker Compose project name. Default: zukan
  --output PATH        Archive path. Default: ./zukan-export-TIMESTAMP.tar.gz
  --stdout            Write archive to stdout. Intended for advanced use
  -h, --help          Show this help

Examples:
  $0 --ssh root@prod --remote-dir /opt/zukan --output ./prod-data.tar.gz
  $0 --ssh root@proxmox --pct 201 --output ./prod-data.tar.gz
  $0 --compose-file /opt/zukan/docker-compose.yml --output /tmp/zukan-data.tar.gz
USAGE
}

shell_quote() {
    printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

safe_name() {
    printf "%s" "$1" | tr -c 'A-Za-z0-9_.-' '_'
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

detect_storage_dir() {
    local compose_file="$1"
    local env_file="$2"
    local value

    value="$(
        compose_cmd "$compose_file" "$env_file" exec -T api \
            python -c 'from backend.app.config import settings; print(settings.storage_dir)' 2>/dev/null || true
    )"
    if [ -z "$value" ]; then
        value="storage"
    fi
    printf "%s\n" "$value"
}

write_manifest() {
    local path="$1"
    local compose_file="$2"
    local source_storage_dir="$3"
    local db_name="$4"
    local db_user="$5"

    {
        printf "format=zukan-data-archive-v1\n"
        printf "created_at_utc=%s\n" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        printf "host=%s\n" "$(hostname 2>/dev/null || printf unknown)"
        printf "compose_file=%s\n" "$compose_file"
        printf "source_storage_dir=%s\n" "$source_storage_dir"
        printf "database_name=%s\n" "$db_name"
        printf "database_user=%s\n" "$db_user"
    } > "$path"
}

archive_storage() {
    local compose_file="$1"
    local env_file="$2"
    local output_tar="$3"
    local partial="${output_tar}.partial"

    rm -f "$partial"
    if compose_cmd "$compose_file" "$env_file" exec -T api tar -C /backend/storage -cf - . > "$partial"; then
        mv "$partial" "$output_tar"
        return
    fi

    rm -f "$partial"
    info "The api container is not available for exec; using a one-off api container."
    compose_cmd "$compose_file" "$env_file" run --rm --no-deps -T api tar -C /backend/storage -cf - . > "$partial"
    mv "$partial" "$output_tar"
}

run_export_on_host() {
    local compose_file
    local env_file
    local db_user
    local db_name
    local source_storage_dir

    command -v docker >/dev/null 2>&1 || fail "docker is required on the target host."
    compose_file="$(detect_compose_file)"
    env_file="$(detect_env_file "$compose_file")"

    TEMP_DIR="$(mktemp -d)"

    info "Using compose file: $compose_file"
    if [ -n "$env_file" ]; then
        info "Using env file: $env_file"
    fi

    db_user="$(container_env_or_default "$compose_file" "$env_file" db POSTGRES_USER zukan)"
    db_name="$(container_env_or_default "$compose_file" "$env_file" db POSTGRES_DB zukan)"
    source_storage_dir="$(detect_storage_dir "$compose_file" "$env_file")"

    info "Dumping PostgreSQL database '$db_name'."
    compose_cmd "$compose_file" "$env_file" exec -T db \
        pg_dump -U "$db_user" -d "$db_name" --format=custom --no-owner --no-acl \
        > "${TEMP_DIR}/database.dump"

    info "Archiving media storage volume."
    archive_storage "$compose_file" "$env_file" "${TEMP_DIR}/storage.tar"

    write_manifest "${TEMP_DIR}/manifest.env" "$compose_file" "$source_storage_dir" "$db_name" "$db_user"

    if [ "$STDOUT" = "1" ]; then
        tar -C "$TEMP_DIR" -czf - manifest.env database.dump storage.tar
    else
        if [ -z "$OUTPUT" ]; then
            OUTPUT="./zukan-export-$(date -u '+%Y%m%dT%H%M%SZ').tar.gz"
        fi
        tar -C "$TEMP_DIR" -czf "$OUTPUT" manifest.env database.dump storage.tar
        ok "Wrote $OUTPUT"
    fi
}

run_export_over_ssh() {
    local output_path="$OUTPUT"
    local partial_output
    local remote_cmd
    local inner_cmd
    local target_label

    command -v ssh >/dev/null 2>&1 || fail "ssh is required."
    if [ -z "$output_path" ]; then
        target_label="$(safe_name "$SSH_TARGET")"
        if [ -n "$PCT_ID" ]; then
            target_label="${target_label}-ct${PCT_ID}"
        fi
        output_path="./zukan-export-${target_label}-$(date -u '+%Y%m%dT%H%M%SZ').tar.gz"
    fi

    inner_cmd="cd $(shell_quote "$REMOTE_DIR") && bash -s -- --remote-run --stdout --project-name $(shell_quote "$PROJECT_NAME")"
    if [ -n "$COMPOSE_FILE" ]; then
        inner_cmd="${inner_cmd} --compose-file $(shell_quote "$COMPOSE_FILE")"
    fi
    if [ -n "$ENV_FILE" ]; then
        inner_cmd="${inner_cmd} --env-file $(shell_quote "$ENV_FILE")"
    fi

    if [ -n "$PCT_ID" ]; then
        remote_cmd="pct exec $(shell_quote "$PCT_ID") -- bash -lc $(shell_quote "$inner_cmd")"
        info "Connecting to $SSH_TARGET and exporting from LXC $PCT_ID:$REMOTE_DIR."
    else
        remote_cmd="$inner_cmd"
        info "Connecting to $SSH_TARGET and exporting from $REMOTE_DIR."
    fi

    partial_output="${output_path}.partial"
    if [ "$STDOUT" = "1" ]; then
        ssh "$SSH_TARGET" "$remote_cmd" < "$0"
        return
    fi

    rm -f "$partial_output"
    if ssh "$SSH_TARGET" "$remote_cmd" < "$0" > "$partial_output"; then
        mv "$partial_output" "$output_path"
    else
        rm -f "$partial_output"
        fail "Remote export failed."
    fi
    ok "Wrote $output_path"
}

run_export_over_pct() {
    local output_path="$OUTPUT"
    local partial_output
    local inner_cmd

    command -v pct >/dev/null 2>&1 || fail "pct is required on the Proxmox host."
    if [ -z "$output_path" ]; then
        output_path="./zukan-export-ct${PCT_ID}-$(date -u '+%Y%m%dT%H%M%SZ').tar.gz"
    fi

    inner_cmd="cd $(shell_quote "$REMOTE_DIR") && bash -s -- --remote-run --stdout --project-name $(shell_quote "$PROJECT_NAME")"
    if [ -n "$COMPOSE_FILE" ]; then
        inner_cmd="${inner_cmd} --compose-file $(shell_quote "$COMPOSE_FILE")"
    fi
    if [ -n "$ENV_FILE" ]; then
        inner_cmd="${inner_cmd} --env-file $(shell_quote "$ENV_FILE")"
    fi

    info "Exporting from local LXC $PCT_ID:$REMOTE_DIR."
    partial_output="${output_path}.partial"
    if [ "$STDOUT" = "1" ]; then
        pct exec "$PCT_ID" -- bash -lc "$inner_cmd" < "$0"
        return
    fi

    rm -f "$partial_output"
    if pct exec "$PCT_ID" -- bash -lc "$inner_cmd" < "$0" > "$partial_output"; then
        mv "$partial_output" "$output_path"
    else
        rm -f "$partial_output"
        fail "LXC export failed."
    fi
    ok "Wrote $output_path"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --ssh)
            SSH_TARGET="$2"
            shift 2
            ;;
        --pct)
            PCT_ID="$2"
            shift 2
            ;;
        --remote-dir)
            REMOTE_DIR="$2"
            shift 2
            ;;
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
        --output)
            OUTPUT="$2"
            shift 2
            ;;
        --stdout)
            STDOUT=1
            shift
            ;;
        --remote-run)
            REMOTE_RUN=1
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
            if [ -z "$SSH_TARGET" ]; then
                SSH_TARGET="$1"
                shift
            else
                fail "Unexpected argument: $1"
            fi
            ;;
    esac
done

if [ "$REMOTE_RUN" = "1" ]; then
    run_export_on_host
elif [ -n "$SSH_TARGET" ]; then
    run_export_over_ssh
elif [ -n "$PCT_ID" ]; then
    run_export_over_pct
else
    run_export_on_host
fi
