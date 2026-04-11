#!/bin/sh
set -eu

lockdir=/tmp/zukan-updater.lock
pidfile="$lockdir/pid"

cleanup() {
    rm -f "$pidfile"
    rmdir "$lockdir"
}

if ! mkdir "$lockdir" 2>/dev/null; then
    if [ -f "$pidfile" ]; then
        stale_pid=$(cat "$pidfile" 2>/dev/null || true)
        if [ -n "$stale_pid" ] && kill -0 "$stale_pid" 2>/dev/null; then
            exit 0
        fi
    fi

    rm -f "$pidfile"
    rmdir "$lockdir" 2>/dev/null || exit 0
    mkdir "$lockdir"
fi

printf '%s\n' "$$" > "$pidfile"
trap cleanup EXIT INT TERM

project_name="${COMPOSE_PROJECT_NAME:-zukan}"

docker compose -p "$project_name" -f /work/docker-compose.yml --env-file /work/.env pull api frontend
docker compose -p "$project_name" -f /work/docker-compose.yml --env-file /work/.env up -d --no-deps --force-recreate api frontend
