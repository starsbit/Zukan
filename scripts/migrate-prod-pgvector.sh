#!/usr/bin/env bash
# Repair an existing self-hosted Zukan install for releases that require pgvector.
#
# This script does not reinstall Zukan and does not delete Docker volumes. It
# updates the deployed compose file so the existing PostgreSQL 16 data volume is
# started with the pgvector-enabled PostgreSQL 16 image, then recreates only the
# needed containers.

set -euo pipefail

REPO="${ZUKAN_REPO:-starsbit/zukan}"
SOURCE_REF="${ZUKAN_SOURCE_REF:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/zukan}"
COMPOSE_FILE="${COMPOSE_FILE:-${INSTALL_DIR}/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-${INSTALL_DIR}/.env}"
UPDATER_DIR="${UPDATER_DIR:-${INSTALL_DIR}/updater}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zukan}"
DRY_RUN="${DRY_RUN:-0}"
NO_RESTART="${NO_RESTART:-0}"
REFRESH_UPDATER="${REFRESH_UPDATER:-1}"

info() { printf '  [INFO]  %s\n' "$*"; }
ok() { printf '  [OK]    %s\n' "$*"; }
warn() { printf '  [WARN]  %s\n' "$*" >&2; }
fail() { printf '  [ERROR] %s\n' "$*" >&2; exit 1; }

generate_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    else
        tr -dc 'a-f0-9' < /dev/urandom | head -c 64
    fi
}

usage() {
    cat <<USAGE
Usage: $0 [options]

Safely repair an existing Zukan production install for the pgvector migration.
No Docker volumes are removed.

Options:
  --install-dir PATH   Install directory. Default: /opt/zukan
  --compose-file PATH  Compose file. Default: /opt/zukan/docker-compose.yml
  --env-file PATH      Env file. Default: /opt/zukan/.env
  --project-name NAME  Docker Compose project name. Default: zukan
  --source-ref REF     Git ref used when refreshing updater scripts. Default: main
  --dry-run            Show what would be changed without writing or restarting
  --no-restart         Patch files and validate compose, but do not pull/restart containers
  --skip-updater-refresh
                       Do not download refreshed updater helper scripts
  -h, --help           Show this help

Environment variables with the same names are also supported:
  INSTALL_DIR, COMPOSE_FILE, ENV_FILE, COMPOSE_PROJECT_NAME, ZUKAN_SOURCE_REF,
  ZUKAN_REPO, DRY_RUN, NO_RESTART, REFRESH_UPDATER
USAGE
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --install-dir)
            INSTALL_DIR="$2"
            COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yml"
            ENV_FILE="${INSTALL_DIR}/.env"
            UPDATER_DIR="${INSTALL_DIR}/updater"
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
        --source-ref)
            SOURCE_REF="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        --no-restart)
            NO_RESTART=1
            shift
            ;;
        --skip-updater-refresh)
            REFRESH_UPDATER=0
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "Unknown option: $1"
            ;;
    esac
done

compose_cmd() {
    docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

run() {
    if [ "$DRY_RUN" = "1" ]; then
        printf '  [DRY]   %s\n' "$*"
    else
        "$@"
    fi
}

fetch_to_file() {
    url="$1"
    dest="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" -o "$dest"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$dest" "$url"
    else
        return 127
    fi
}

sed_in_place() {
    if sed --version >/dev/null 2>&1; then
        sed -i "$@"
    else
        sed -i '' "$@"
    fi
}

compose_has_service() {
    service_name="$1"
    file="$2"
    awk -v service_name="$service_name" '
        $0 ~ "^  " service_name ":[[:space:]]*$" { found = 1 }
        END { exit found ? 0 : 1 }
    ' "$file"
}

compose_service_has_line() {
    service_name="$1"
    pattern="$2"
    file="$3"
    awk -v service_name="$service_name" -v pattern="$pattern" '
        $0 ~ "^  " service_name ":[[:space:]]*$" { in_service = 1; next }
        in_service && $0 ~ "^  [A-Za-z0-9_-]+:[[:space:]]*$" { in_service = 0 }
        in_service && $0 ~ pattern { found = 1 }
        END { exit found ? 0 : 1 }
    ' "$file"
}

detect_compose_template() {
    explicit_template="$(sed -n 's/^[[:space:]]*ZUKAN_COMPOSE_TEMPLATE:[[:space:]]*//p' "$COMPOSE_FILE" | head -n 1 || true)"
    if [ -n "$explicit_template" ]; then
        printf '%s\n' "$explicit_template"
        return 0
    fi

    case "$(basename "$COMPOSE_FILE")" in
        docker-compose.prod.yml)
            printf '%s\n' "docker-compose.prod.yml"
            ;;
        docker-compose.selfhost.gpu.yml)
            printf '%s\n' "docker-compose.selfhost.gpu.yml"
            ;;
        docker-compose.selfhost.yml)
            printf '%s\n' "docker-compose.selfhost.yml"
            ;;
        *)
            if grep -q 'capabilities: \[gpu\]' "$COMPOSE_FILE" 2>/dev/null; then
                printf '%s\n' "docker-compose.selfhost.gpu.yml"
            else
                printf '%s\n' "docker-compose.selfhost.yml"
            fi
            ;;
    esac
}

validate_refreshed_compose() {
    refreshed_file="$1"

    grep -q '^services:' "$refreshed_file" \
        && grep -q 'image:[[:space:]]*ghcr.io/starsbit/zukan-api' "$refreshed_file" \
        && grep -q 'image:[[:space:]]*pgvector/pgvector:pg16' "$refreshed_file" \
        && grep -q 'UPDATER_URL:[[:space:]]*http://updater:8080' "$refreshed_file" \
        && compose_has_service updater "$refreshed_file"
}

normalize_refreshed_compose() {
    refreshed_file="$1"
    container_compose="/work/$(basename "$COMPOSE_FILE")"

    if grep -q '^[[:space:]]*ZUKAN_COMPOSE_FILE:' "$refreshed_file"; then
        sed_in_place "s#^\([[:space:]]*ZUKAN_COMPOSE_FILE:[[:space:]]*\).*$#\1${container_compose}#" "$refreshed_file"
    fi
}

refresh_compose_from_repo() {
    template="$(detect_compose_template)"
    tmp_file="$(mktemp)"
    url="https://raw.githubusercontent.com/${REPO}/${SOURCE_REF}/${template}"

    info "Fetching ${template} from ${REPO}@${SOURCE_REF}"
    if ! fetch_to_file "$url" "$tmp_file"; then
        rm -f "$tmp_file"
        warn "Could not fetch ${template}; falling back to patching the existing compose file"
        return 1
    fi

    normalize_refreshed_compose "$tmp_file"

    if ! validate_refreshed_compose "$tmp_file"; then
        rm -f "$tmp_file"
        warn "Downloaded ${template} failed validation; falling back to patching the existing compose file"
        return 1
    fi

    if [ "$DRY_RUN" = "1" ]; then
        info "Would replace $COMPOSE_FILE with ${template} from ${REPO}@${SOURCE_REF}"
        rm -f "$tmp_file"
        return 0
    fi

    mv "$tmp_file" "$COMPOSE_FILE"
    ok "Refreshed compose file from ${template}"
    return 0
}

ensure_updater_token() {
    if grep -q '^UPDATER_TOKEN=' "$ENV_FILE"; then
        return 0
    fi

    updater_token="$(grep '^WATCHTOWER_TOKEN=' "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)"
    [ -n "$updater_token" ] || updater_token="$(generate_secret)"

    if [ "$DRY_RUN" = "1" ]; then
        info "Would add UPDATER_TOKEN to $ENV_FILE"
    else
        printf '\nUPDATER_TOKEN=%s\n' "$updater_token" >> "$ENV_FILE"
        ok "Added UPDATER_TOKEN to $ENV_FILE"
    fi
}

require_inputs() {
    [ -f "$COMPOSE_FILE" ] || fail "Compose file not found: $COMPOSE_FILE"
    [ -f "$ENV_FILE" ] || fail "Env file not found: $ENV_FILE"
    command -v docker >/dev/null 2>&1 || fail "docker is not installed or not in PATH"
    docker compose version >/dev/null 2>&1 || fail "docker compose is not available"
}

backup_compose() {
    timestamp="$(date +%Y%m%d-%H%M%S)"
    BACKUP_FILE="${COMPOSE_FILE}.bak-${timestamp}"
    if [ "$DRY_RUN" = "1" ]; then
        info "Would back up $COMPOSE_FILE to $BACKUP_FILE"
    else
        cp "$COMPOSE_FILE" "$BACKUP_FILE"
        ok "Backed up compose file to $BACKUP_FILE"
    fi
}

patch_compose() {
    tmp_file="$(mktemp)"
    cp "$COMPOSE_FILE" "$tmp_file"
    container_compose="/work/$(basename "$COMPOSE_FILE")"

    if grep -q 'image:[[:space:]]*pgvector/pgvector:pg16' "$tmp_file"; then
        info "Compose file already uses pgvector/pgvector:pg16 for PostgreSQL"
    else
        sed_in_place \
            -e 's#^\([[:space:]]*image:[[:space:]]*\)postgres:16-alpine[[:space:]]*$#\1pgvector/pgvector:pg16#' \
            -e 's#^\([[:space:]]*image:[[:space:]]*\)postgres:16[[:space:]]*$#\1pgvector/pgvector:pg16#' \
            "$tmp_file"
    fi

    if ! grep -q 'image:[[:space:]]*pgvector/pgvector:pg16' "$tmp_file"; then
        rm -f "$tmp_file"
        fail "Could not find a PostgreSQL 16 image to migrate. Please inspect $COMPOSE_FILE manually."
    fi

    if ! compose_service_has_line api 'UPDATER_URL:' "$tmp_file"; then
        if grep -q '^[[:space:]]*SECRET_KEY:' "$tmp_file"; then
            sed_in_place "/^[[:space:]]*SECRET_KEY:/a\\
      UPDATER_URL: http://updater:8080" "$tmp_file"
        elif compose_service_has_line api 'DATABASE_URL:' "$tmp_file"; then
            sed_in_place "/^[[:space:]]*DATABASE_URL:/a\\
      UPDATER_URL: http://updater:8080" "$tmp_file"
        else
            rm -f "$tmp_file"
            fail "Could not find api environment entries to add UPDATER_URL. Please inspect $COMPOSE_FILE manually."
        fi
    fi

    if ! compose_service_has_line api 'UPDATER_TOKEN:' "$tmp_file"; then
        sed_in_place "/^[[:space:]]*UPDATER_URL:/a\\
      UPDATER_TOKEN: \${UPDATER_TOKEN}" "$tmp_file"
    fi

    if ! compose_has_service updater "$tmp_file"; then
        updater_block="$(mktemp)"
        cat > "$updater_block" <<UPDATER

  updater:
    image: docker:29.4.0-cli
    command:
      - sh
      - -c
      - |
        cp /scripts/serve-update.sh /tmp/serve-update.sh
        chmod 755 /tmp/serve-update.sh
        exec nc -lk -p 8080 -e /tmp/serve-update.sh
    environment:
      UPDATER_TOKEN: \${UPDATER_TOKEN}
      COMPOSE_PROJECT_NAME: \${COMPOSE_PROJECT_NAME:-zukan}
      ZUKAN_COMPOSE_FILE: ${container_compose}
      ZUKAN_UPDATER_DIR: /work/updater
      ZUKAN_REPO: \${ZUKAN_REPO:-starsbit/zukan}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - .:/work
      - ./updater:/scripts:ro
    restart: unless-stopped
UPDATER

        if [ "$(basename "$COMPOSE_FILE")" = "docker-compose.prod.yml" ]; then
            sed_in_place "/ZUKAN_COMPOSE_FILE:/a\\
      ZUKAN_COMPOSE_TEMPLATE: docker-compose.prod.yml" "$updater_block"
        fi

        patched_file="$(mktemp)"
        awk -v block_file="$updater_block" '
            function print_block() {
                while ((getline line < block_file) > 0) {
                    print line
                }
                close(block_file)
            }
            /^volumes:[[:space:]]*$/ && !inserted {
                print_block()
                inserted = 1
            }
            { print }
            END {
                if (!inserted) {
                    print ""
                    print_block()
                }
            }
        ' "$tmp_file" > "$patched_file"
        mv "$patched_file" "$tmp_file"
        rm -f "$updater_block"
    fi

    if ! grep -q 'ZUKAN_COMPOSE_FILE:' "$tmp_file" && grep -q 'COMPOSE_PROJECT_NAME:' "$tmp_file"; then
        sed_in_place "/COMPOSE_PROJECT_NAME:/a\\
      ZUKAN_COMPOSE_FILE: ${container_compose}\\
      ZUKAN_REPO: \${ZUKAN_REPO:-starsbit/zukan}" "$tmp_file"
    fi

    if ! grep -q 'ZUKAN_UPDATER_DIR:' "$tmp_file" && grep -q 'ZUKAN_COMPOSE_FILE:' "$tmp_file"; then
        sed_in_place "/ZUKAN_COMPOSE_FILE:/a\\
      ZUKAN_UPDATER_DIR: /work/updater" "$tmp_file"
    fi

    if [ "$(basename "$COMPOSE_FILE")" = "docker-compose.prod.yml" ] \
        && ! grep -q 'ZUKAN_COMPOSE_TEMPLATE:' "$tmp_file" \
        && grep -q 'ZUKAN_COMPOSE_FILE:' "$tmp_file"; then
        sed_in_place "/ZUKAN_COMPOSE_FILE:/a\\
      ZUKAN_COMPOSE_TEMPLATE: docker-compose.prod.yml" "$tmp_file"
    fi

    sed_in_place \
        -e '\#^[[:space:]]*- ./docker-compose[^:]*:/work/.*:ro[[:space:]]*$#d' \
        -e '\#^[[:space:]]*- ./.env:/work/.env:ro[[:space:]]*$#d' \
        "$tmp_file"

    if ! grep -q '^[[:space:]]*- \.:/work[[:space:]]*$' "$tmp_file"; then
        sed_in_place '/^[[:space:]]*- \/var\/run\/docker.sock:\/var\/run\/docker.sock[[:space:]]*$/a\
      - .:/work' "$tmp_file"
    fi

    if [ "$DRY_RUN" = "1" ]; then
        info "Would update $COMPOSE_FILE with pgvector DB image and writable updater workdir"
        rm -f "$tmp_file"
    else
        cat "$tmp_file" > "$COMPOSE_FILE"
        rm -f "$tmp_file"
        ok "Updated compose file"
    fi
}

refresh_updater_scripts() {
    [ "$REFRESH_UPDATER" = "0" ] && {
        info "Skipping updater script refresh"
        return 0
    }

    [ "$DRY_RUN" = "1" ] && {
        info "Would refresh updater scripts in $UPDATER_DIR from ${REPO}@${SOURCE_REF}"
        return 0
    }

    mkdir -p "$UPDATER_DIR"
    refreshed=0
    for script_name in update.cgi serve-update.sh run-update.sh; do
        tmp_script="$(mktemp)"
        url="https://raw.githubusercontent.com/${REPO}/${SOURCE_REF}/updater/${script_name}"
        if fetch_to_file "$url" "$tmp_script"; then
            mv "$tmp_script" "${UPDATER_DIR}/${script_name}"
            chmod 755 "${UPDATER_DIR}/${script_name}"
            refreshed=$((refreshed + 1))
        else
            rm -f "$tmp_script"
            warn "Could not refresh updater/${script_name} from GitHub"
        fi
    done

    if [ "$refreshed" -gt 0 ]; then
        ok "Refreshed $refreshed updater script(s)"
    else
        warn "Updater scripts were not refreshed; continuing with the database repair"
    fi
}

validate_compose() {
    info "Validating compose file"
    run compose_cmd config >/dev/null
}

restart_services() {
    info "Pulling pgvector-enabled database image and app images"
    if ! run compose_cmd pull db updater api frontend; then
        warn "Could not pull updater service; retrying core services only"
        run compose_cmd pull db api frontend
    fi

    info "Recreating the database container without deleting postgres_data"
    run compose_cmd up -d --no-deps --force-recreate db

    info "Recreating updater and API containers"
    if ! run compose_cmd up -d --no-deps --force-recreate updater; then
        warn "Could not recreate updater service; continuing with API restart"
    fi
    run compose_cmd up -d --no-deps --force-recreate api
}

print_summary() {
    cat <<SUMMARY

Zukan pgvector repair complete.

What changed:
  - The compose file now uses pgvector/pgvector:pg16 for the db service.
  - Missing updater wiring was added for legacy compose files when needed.
  - Existing Docker volumes were preserved. No reinstall and no volume deletion happened.
  - The updater mount was adjusted so future compose changes can be fetched automatically.

Useful follow-up checks:
  docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
  docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs api --tail=120

If anything looks wrong, restore the compose backup and restart:
  cp "$BACKUP_FILE" "$COMPOSE_FILE"
  docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

SUMMARY
}

require_inputs
info "Repairing compose file: $COMPOSE_FILE"
info "Using env file: $ENV_FILE"
info "Important: this script never runs docker compose down -v and never deletes postgres_data."
backup_compose
ensure_updater_token
if ! refresh_compose_from_repo; then
    patch_compose
fi
refresh_updater_scripts
validate_compose
if [ "$NO_RESTART" = "1" ]; then
    info "Skipping container restart because --no-restart was requested"
else
    restart_services
fi
print_summary
