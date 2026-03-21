#!/usr/bin/env bash
set -euo pipefail

services=(api frontend)

docker compose stop "${services[@]}"
docker compose build "${services[@]}"
docker compose up -d "${services[@]}"
