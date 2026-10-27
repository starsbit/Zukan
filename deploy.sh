#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
export SOURCE_REVISION="$(git rev-parse --short HEAD)"
exec docker compose -p zukan -f docker-compose.selfhost.yml -f docker-compose.nas.yml -f compose.homeserver.yml "$@"
