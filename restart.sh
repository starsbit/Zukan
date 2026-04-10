#!/usr/bin/env bash
set -euo pipefail

services=(api frontend)

docker compose stop "${services[@]}"
docker compose -f docker-compose.macos.yml build "${services[@]}"
docker compose -f docker-compose.macos.yml up -d "${services[@]}"
