#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
PYTEST_BIN="$ROOT_DIR/.venv/bin/pytest"

run_step() {
  local label="$1"
  shift

  echo
  echo "==> $label"
  "$@"
}

if [[ ! -d "$FRONTEND_DIR" ]]; then
  echo "Frontend directory not found: $FRONTEND_DIR" >&2
  exit 1
fi

if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "Backend directory not found: $BACKEND_DIR" >&2
  exit 1
fi

if [[ ! -x "$PYTEST_BIN" ]]; then
  echo "Pytest not found at $PYTEST_BIN" >&2
  exit 1
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Frontend dependencies are missing. Expected $FRONTEND_DIR/node_modules" >&2
  exit 1
fi

run_step "Frontend unit tests" npm --prefix "$FRONTEND_DIR" run test -- --watch=false
run_step "Backend tests" "$PYTEST_BIN" "$BACKEND_DIR/tests"
run_step "Frontend e2e tests" npm --prefix "$FRONTEND_DIR" run e2e

echo
echo "All test suites passed."
