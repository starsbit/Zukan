#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="docker compose --project-name zukan-e2e -f $ROOT_DIR/docker-compose.e2e.yml"
FRONTEND_URL="http://localhost:4201"
API_URL="http://localhost:4201"   # goes through nginx proxy

E2E_FAILED=0

cleanup() {
  echo
  echo "==> Tearing down e2e stack"
  $COMPOSE down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

wait_for() {
  local label="$1"
  local url="$2"
  local max_attempts="${3:-60}"
  local attempt=0

  echo "==> Waiting for $label at $url"
  until curl -sf "$url" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [[ $attempt -ge $max_attempts ]]; then
      echo "ERROR: $label did not become ready after $max_attempts attempts" >&2
      $COMPOSE logs
      exit 1
    fi
    sleep 2
  done
  echo "    $label is ready"
}

echo "==> Building and starting e2e stack"
$COMPOSE up -d --build

# API is health-checked inside compose, but we also poll from the host
wait_for "API"      "${API_URL}/api/v1/config/setup-required" 60
wait_for "Frontend" "${FRONTEND_URL}/" 30

echo
echo "==> Running Playwright e2e tests"
cd "$ROOT_DIR/frontend"
PLAYWRIGHT_TEST_BASE_URL="$FRONTEND_URL" \
API_BASE_URL="$API_URL" \
  ng e2e --project=zukan "$@" || E2E_FAILED=1

if [[ $E2E_FAILED -ne 0 ]]; then
  echo
  echo "==> e2e tests FAILED — dumping service logs"
  $COMPOSE logs api
  exit 1
fi

echo
echo "==> All e2e tests passed"
