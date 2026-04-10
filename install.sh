#!/usr/bin/env bash
# Zukan self-hosted installer / updater
# Usage: curl -fsSL https://raw.githubusercontent.com/starsbit/zukan/main/install.sh | bash
#
# Requirements: Debian 11+ or Ubuntu 22.04+, internet access, run as root
set -euo pipefail

REPO="starsbit/zukan"
INSTALL_DIR="/opt/zukan"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"
ENV_FILE="$INSTALL_DIR/.env"

# ── Helpers ─────────────────────────────────────────────────────────────────
info()    { echo "  [INFO]  $*"; }
success() { echo "  [OK]    $*"; }
error()   { echo "  [ERROR] $*" >&2; exit 1; }

require_root() {
    [[ "$(id -u)" -eq 0 ]] || error "Run as root (sudo bash install.sh)"
}

detect_os() {
    [[ -f /etc/os-release ]] || error "Cannot detect OS. Only Debian/Ubuntu are supported."
    . /etc/os-release
    [[ "$ID" == "debian" || "$ID" == "ubuntu" ]] \
        || error "Unsupported OS: $ID. This installer supports Debian and Ubuntu."
    info "Detected OS: $PRETTY_NAME"
}

install_docker() {
    if command -v docker &>/dev/null; then
        info "Docker already installed ($(docker --version | head -1))"
        return
    fi
    info "Installing Docker..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg lsb-release
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$ID/gpg" \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/$ID $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable --now docker
    success "Docker installed"
}

fetch_latest_version() {
    LATEST_VERSION=$(curl -fsSL \
        "https://api.github.com/repos/$REPO/releases/latest" \
        | grep '"tag_name"' \
        | sed 's/.*"tag_name": *"v\?\([^"]*\)".*/\1/')
    [[ -n "$LATEST_VERSION" ]] || error "Could not fetch latest version from GitHub"
    info "Latest Zukan version: $LATEST_VERSION"
}

generate_secret() {
    if command -v openssl &>/dev/null; then
        openssl rand -hex 32
    else
        tr -dc 'a-f0-9' < /dev/urandom | head -c 64
    fi
}

write_compose() {
    mkdir -p "$INSTALL_DIR"
    cat > "$COMPOSE_FILE" << COMPOSE
services:
  frontend:
    image: ghcr.io/starsbit/zukan-frontend:latest
    ports:
      - "80:80"
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
    depends_on:
      api:
        condition: service_started
    restart: unless-stopped

  api:
    image: ghcr.io/starsbit/zukan-api:latest
    environment:
      DATABASE_URL: postgresql+asyncpg://zukan:\${POSTGRES_PASSWORD}@db:5432/zukan
      SECRET_KEY: \${SECRET_KEY}
      WATCHTOWER_TOKEN: \${WATCHTOWER_TOKEN}
      LOG_LEVEL: INFO
    volumes:
      - storage_data:/backend/storage
      - model_cache:/backend/model_cache
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: zukan
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: zukan
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U zukan"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  watchtower:
    image: containrrr/watchtower
    command: --http-api-update --label-enable --no-startup-message --interval 0
    environment:
      WATCHTOWER_HTTP_API_TOKEN: \${WATCHTOWER_TOKEN}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped

volumes:
  postgres_data:
  storage_data:
  model_cache:
COMPOSE
    success "Wrote $COMPOSE_FILE"
}

write_env() {
    if [[ -f "$ENV_FILE" ]]; then
        info ".env already exists — keeping existing secrets (delete $ENV_FILE to regenerate)"
        # Ensure WATCHTOWER_TOKEN exists in existing .env (upgrade path)
        if ! grep -q "^WATCHTOWER_TOKEN=" "$ENV_FILE"; then
            local watchtower_token
            watchtower_token=$(generate_secret | head -c 32)
            echo "WATCHTOWER_TOKEN=${watchtower_token}" >> "$ENV_FILE"
            success "Added WATCHTOWER_TOKEN to existing $ENV_FILE"
        fi
        return
    fi
    local secret_key pg_password watchtower_token
    secret_key=$(generate_secret)
    pg_password=$(generate_secret | head -c 32)
    watchtower_token=$(generate_secret | head -c 32)
    cat > "$ENV_FILE" << ENV
SECRET_KEY=${secret_key}
POSTGRES_PASSWORD=${pg_password}
WATCHTOWER_TOKEN=${watchtower_token}
ENV
    chmod 600 "$ENV_FILE"
    success "Generated $ENV_FILE with random secrets"
}

pull_and_start() {
    info "Pulling Docker images (first run may take a few minutes)..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull
    info "Starting Zukan..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
    success "Zukan is running"
}

print_summary() {
    local host_ip
    host_ip=$(hostname -I | awk '{print $1}')
    echo
    echo "══════════════════════════════════════════"
    echo "  Zukan ready (latest)"
    echo "══════════════════════════════════════════"
    echo "  URL:      http://${host_ip}"
    echo "  Install:  ${INSTALL_DIR}"
    echo ""
    echo "  Default login: admin / admin"
    echo "  Change your password and configure the"
    echo "  app via the admin panel immediately."
    echo ""
    echo "  To upgrade, run this script again:"
    echo "    curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash"
    echo "══════════════════════════════════════════"
    echo
}

# ── Main ────────────────────────────────────────────────────────────────────
require_root
detect_os
install_docker
fetch_latest_version
write_compose
write_env
pull_and_start
print_summary
