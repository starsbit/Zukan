#!/usr/bin/env bash
set -euo pipefail

docker compose stop api
docker compose build api
docker compose up -d api
