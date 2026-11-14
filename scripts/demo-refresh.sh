#!/usr/bin/env bash
# Clone the operational Zukan database into the demo instance and sanitize it.
# The operational instance is only read from (pg_dump); nothing is written to it.
#
# Usage:   scripts/demo-refresh.sh
# Env:     SOURCE_PROJECT       operational compose project name (default: zukan)
#          SOURCE_DB_CONTAINER  operational db container id/name (default: detected from SOURCE_PROJECT)
#          DEMO_COMPOSE_FILE    demo compose file (default: docker-compose.demo.yml)
#          PG_USER / PG_DB      database user and name on both sides (default: zukan)
# Nightly: 0 4 * * * cd /path/to/Zukan && scripts/demo-refresh.sh >> demo-refresh.log 2>&1
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

source_project="${SOURCE_PROJECT:-zukan}"
demo_compose_file="${DEMO_COMPOSE_FILE:-docker-compose.demo.yml}"
pg_user="${PG_USER:-zukan}"
pg_db="${PG_DB:-zukan}"

demo() { docker compose -f "$demo_compose_file" "$@"; }

source_container="${SOURCE_DB_CONTAINER:-$(docker ps -q --filter "label=com.docker.compose.project=$source_project" --filter "label=com.docker.compose.service=db" | head -n1)}"
if [[ -z "$source_container" ]]; then
  echo "Operational db container not found for project '$source_project'. Set SOURCE_PROJECT or SOURCE_DB_CONTAINER." >&2
  exit 1
fi

echo "==> Starting demo database"
demo up -d --wait db
demo_container="$(demo ps -q db)"
if [[ "$(docker inspect -f '{{.Id}}' "$source_container")" == "$(docker inspect -f '{{.Id}}' "$demo_container")" ]]; then
  echo "Source and demo database are the same container. Refusing to overwrite it." >&2
  exit 1
fi

echo "==> Stopping demo API"
demo stop api frontend

echo "==> Cloning operational database"
docker exec "$source_container" pg_dump -U "$pg_user" -Fc "$pg_db" \
  | demo exec -T db pg_restore --clean --if-exists --no-owner --no-acl -U "$pg_user" -d "$pg_db"

echo "==> Sanitizing demo database"
demo run --rm --no-deps api python -m backend.app.demo_sanitize

echo "==> Starting demo"
demo up -d --build api frontend
echo "Demo refreshed."
