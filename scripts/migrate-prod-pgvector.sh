#!/usr/bin/env bash
# Manual PostgreSQL 16 pgvector repair. Back up the database before running.
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/zukan}"
COMPOSE_FILE="${COMPOSE_FILE:-${INSTALL_DIR}/docker-compose.selfhost.yml}"
ENV_FILE="${ENV_FILE:-${INSTALL_DIR}/.env}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zukan}"
if [[ "$#" -gt 0 ]]; then
    echo 'Usage: set COMPOSE_FILE, ENV_FILE and COMPOSE_PROJECT_NAME as needed, then run without arguments.' >&2
    exit 1
fi
[[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]] || { echo 'Compose or environment file missing.' >&2; exit 1; }
compose() { docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
image=$(compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["db"]["image"])')
case "$image" in
    postgres:16|postgres:16.*|pgvector/pgvector:pg16) ;;
    *) echo "Refusing PostgreSQL major version change from $image. Use a tested database upgrade procedure." >&2; exit 1 ;;
esac
backup="${COMPOSE_FILE}.$(date +%Y%m%d%H%M%S).bak"
cp "$COMPOSE_FILE" "$backup"
# Only replace the legacy PostgreSQL 16 image; retain mounts and service settings.
sed -E 's@image: postgres:16([.][0-9]+)?([[:space:]]*)$@image: pgvector/pgvector:pg16\2@' "$backup" > "$COMPOSE_FILE"
compose config --quiet
compose stop api
compose pull db
compose up -d --no-deps --force-recreate db
echo "Database image replaced; compose backup: $backup"
echo 'API remains stopped. Complete owner selection/preflight before starting the breaking release.'
