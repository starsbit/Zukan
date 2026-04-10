#!/bin/sh
set -eu

lockdir=/tmp/zukan-updater.lock
if ! mkdir "$lockdir" 2>/dev/null; then
    exit 0
fi
trap 'rmdir "$lockdir"' EXIT

docker compose -f /work/docker-compose.yml --env-file /work/.env pull api frontend
docker compose -f /work/docker-compose.yml --env-file /work/.env up -d api frontend
