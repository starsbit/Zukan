#!/usr/bin/env bash
# Pull the latest commits, then rebuild and restart the current checkout.
# If a demo checkout exists next to it (../zukan-demo, or ZUKAN_DEMO_DIR), it is
# pulled and refreshed from this instance's database afterwards.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ -z "${ZUKAN_RESTART_PULLED:-}" ]]; then
  git pull --ff-only
  ZUKAN_RESTART_PULLED=1 exec "./$(basename -- "${BASH_SOURCE[0]}")" "$@"
fi

if [[ -f compose.homeserver.yml ]]; then
  compose_file="docker-compose.selfhost.yml"
  project_name="zukan"
  compose() { ./deploy.sh "$@"; }
else
  compose_file="${COMPOSE_FILE:-docker-compose.selfhost.yml}"
  project_name="${COMPOSE_PROJECT_NAME:-zukan}"
  compose() { docker compose -p "$project_name" -f "$compose_file" "$@"; }
fi

require_secret() {
  local name="$1"
  grep -qF "\${$name}" "$compose_file" || return 0
  [[ -n "${!name:-}" ]] && return 0
  [[ -f .env ]] && grep -qE "^$name=.+" .env && return 0
  echo "$name is not set in $PWD/.env. Refusing to restart: is this the deployed checkout?" >&2
  exit 1
}

require_secret POSTGRES_PASSWORD
require_secret SECRET_KEY

compose build api frontend
compose stop api
compose up -d --remove-orphans

demo_dir="${ZUKAN_DEMO_DIR:-$(dirname -- "$PWD")/zukan-demo}"
if [[ -f "$demo_dir/docker-compose.demo.yml" && -f "$demo_dir/.env" ]]; then
  echo "==> Updating demo instance in $demo_dir"
  git -C "$demo_dir" pull --ff-only
  SOURCE_PROJECT="$project_name" "$demo_dir/scripts/demo-refresh.sh"
fi
