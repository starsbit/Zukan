#!/bin/sh
set -eu

json_response() {
    status="$1"
    body="$2"
    printf 'HTTP/1.1 %s\r\n' "$status"
    printf 'Content-Type: application/json\r\n\r\n'
    printf '%s\n' "$body"
}

if [ "${REQUEST_METHOD:-GET}" != "POST" ]; then
    json_response "405 Method Not Allowed" '{"detail":"Method not allowed"}'
    exit 0
fi

expected="Bearer ${UPDATER_TOKEN:-}"
provided="${HTTP_AUTHORIZATION:-}"
if [ -z "${UPDATER_TOKEN:-}" ] || [ "$provided" != "$expected" ]; then
    json_response "401 Unauthorized" '{"detail":"Unauthorized"}'
    exit 0
fi

run_update_script="${RUN_UPDATE_SCRIPT:-/scripts/run-update.sh}"
nohup sh "$run_update_script" >/tmp/zukan-updater.log 2>&1 &
json_response "202 Accepted" '{"message":"Update initiated"}'
