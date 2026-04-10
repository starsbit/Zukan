#!/bin/sh
set -eu

REQUEST_METHOD=""
HTTP_AUTHORIZATION=""

IFS=' ' read -r REQUEST_METHOD _ _ || true

while IFS= read -r line; do
    stripped=$(printf '%s' "$line" | tr -d '\r')
    [ -z "$stripped" ] && break
    case "$stripped" in
        Authorization:*)
            HTTP_AUTHORIZATION=$(printf '%s' "$stripped" | sed 's/^Authorization:[[:space:]]*//')
            ;;
    esac
done

export REQUEST_METHOD HTTP_AUTHORIZATION
exec /bin/sh /scripts/update.cgi
