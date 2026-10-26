#!/usr/bin/env bash
# Rebuild and restart the current checkout. Pull source explicitly beforehand.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
compose_file="${COMPOSE_FILE:-docker-compose.selfhost.yml}"
project_name="${COMPOSE_PROJECT_NAME:-zukan}"
compose() { docker compose -p "$project_name" -f "$compose_file" "$@"; }
compose build api frontend
compose stop api
compose up -d --remove-orphans
