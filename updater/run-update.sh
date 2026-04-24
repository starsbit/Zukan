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
repo="${ZUKAN_REPO:-starsbit/zukan}"
compose_file="${ZUKAN_COMPOSE_FILE:-/work/docker-compose.yml}"
env_file="${ZUKAN_ENV_FILE:-/work/.env}"
compose_template="${ZUKAN_COMPOSE_TEMPLATE:-}"

fetch_to_file() {
    url="$1"
    dest="$2"
    if command -v wget >/dev/null 2>&1; then
        wget -qO "$dest" "$url"
    elif command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" -o "$dest"
    else
        echo "Neither wget nor curl is available; skipping compose refresh." >&2
        return 127
    fi
}

latest_release_tag() {
    release_json="/tmp/zukan-latest-release.json"
    if ! fetch_to_file "https://api.github.com/repos/${repo}/releases/latest" "$release_json"; then
        return 1
    fi
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$release_json" | head -n 1
}

detect_compose_template() {
    if [ -n "$compose_template" ]; then
        printf '%s\n' "$compose_template"
        return 0
    fi

    case "$(basename "$compose_file")" in
        docker-compose.prod.yml)
            printf '%s\n' "docker-compose.prod.yml"
            ;;
        *)
            if grep -q 'capabilities: \[gpu\]' "$compose_file" 2>/dev/null; then
                printf '%s\n' "docker-compose.selfhost.gpu.yml"
            else
                printf '%s\n' "docker-compose.selfhost.yml"
            fi
            ;;
    esac
}

refresh_compose_from_github() {
    tag="$(latest_release_tag || true)"
    if [ -z "$tag" ]; then
        echo "Could not determine the latest GitHub release; continuing with the existing compose file." >&2
        return 0
    fi

    template="$(detect_compose_template)"
    tmp_compose="/tmp/zukan-compose.yml"
    url="https://raw.githubusercontent.com/${repo}/${tag}/${template}"

    if ! fetch_to_file "$url" "$tmp_compose"; then
        echo "Could not fetch ${template} from ${tag}; continuing with the existing compose file." >&2
        return 0
    fi

    if ! grep -q '^services:' "$tmp_compose" || ! grep -q 'ghcr.io/starsbit/zukan-api' "$tmp_compose"; then
        echo "Downloaded compose template failed validation; keeping the existing compose file." >&2
        return 0
    fi

    cp "$compose_file" "${compose_file}.bak" 2>/dev/null || true
    if ! cat "$tmp_compose" > "$compose_file"; then
        echo "Could not write refreshed compose file; continuing with the existing compose file." >&2
        return 0
    fi
}

refresh_compose_from_github

docker compose -p "$project_name" -f "$compose_file" --env-file "$env_file" pull db updater api frontend
docker compose -p "$project_name" -f "$compose_file" --env-file "$env_file" up -d --no-deps db
docker compose -p "$project_name" -f "$compose_file" --env-file "$env_file" up -d --no-deps --force-recreate api frontend
