#!/usr/bin/env bash
# Zukan self-hosted installer / updater
# Usage: curl -fsSL https://raw.githubusercontent.com/starsbit/zukan/main/install.sh | bash
#
# Requirements: Debian 11+ or Ubuntu 22.04+, internet access, run as root
#
# Environment variables (all optional):
#   GPU_ENABLED=1    Configure NVIDIA GPU support in Docker (default: 0)
#   NO_SUMMARY=1     Suppress the final summary (used when called from install-lxc.sh)
set -euo pipefail

REPO="starsbit/zukan"
INSTALL_DIR="/opt/zukan"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.yml"
ENV_FILE="$INSTALL_DIR/.env"
SERVICE_FILE="/etc/systemd/system/zukan.service"
GPU_ENABLED="${GPU_ENABLED:-0}"
NO_SUMMARY="${NO_SUMMARY:-0}"

# ── Helpers ─────────────────────────────────────────────────────────────────
info()    { echo "  [INFO]  $*"; }
success() { echo "  [OK]    $*"; }
error()   { echo "  [ERROR] $*" >&2; exit 1; }

require_root() {
    [[ "$(id -u)" -eq 0 ]] || error "Run as root (sudo bash install.sh)"
}

detect_os() {
    [[ -f /etc/os-release ]] || error "Cannot detect OS. Only Debian/Ubuntu are supported."
    # shellcheck source=/dev/null
    . /etc/os-release
    [[ "$ID" == "debian" || "$ID" == "ubuntu" ]] \
        || error "Unsupported OS: $ID. This installer supports Debian and Ubuntu."
    info "Detected OS: $PRETTY_NAME"
}

generate_secret() {
    if command -v openssl &>/dev/null; then
        openssl rand -hex 32
    else
        tr -dc 'a-f0-9' < /dev/urandom | head -c 64
    fi
}

install_base_packages() {
    info "Installing base packages..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg lsb-release
    success "Base packages ready"
}

install_docker() {
    if command -v docker &>/dev/null; then
        info "Docker already installed ($(docker --version | head -1))"
        return
    fi
    info "Installing Docker..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$ID/gpg" \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/$ID $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    success "Docker installed"
}

install_nvidia_toolkit() {
    [[ "${GPU_ENABLED}" == "1" ]] || return 0
    info "Installing NVIDIA Container Toolkit..."
    local distribution
    distribution="$(. /etc/os-release; echo "${ID}${VERSION_ID}")"
    curl -fsSL "https://nvidia.github.io/libnvidia-container/gpgkey" \
        | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -fsSL "https://nvidia.github.io/libnvidia-container/${distribution}/libnvidia-container.list" \
        | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
        > /etc/apt/sources.list.d/nvidia-container-toolkit.list
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nvidia-container-toolkit
    nvidia-ctk runtime configure --runtime=docker
    systemctl restart docker
    success "NVIDIA Container Toolkit installed"
}

write_compose() {
    mkdir -p "$INSTALL_DIR"
    # The compose file uses ${VAR} syntax for docker-compose env substitution.
    # Single-quoted heredoc prevents the shell from expanding these.
    cat > "$COMPOSE_FILE" << 'COMPOSE'
services:
  frontend:
    image: ghcr.io/starsbit/zukan-frontend:latest
    ports:
      - "80:80"
    depends_on:
      api:
        condition: service_started
    restart: unless-stopped

  api:
    image: ghcr.io/starsbit/zukan-api:latest
    environment:
      DATABASE_URL: postgresql+asyncpg://zukan:${POSTGRES_PASSWORD}@db:5432/zukan
      SECRET_KEY: ${SECRET_KEY}
      UPDATER_URL: http://updater:8080
      UPDATER_TOKEN: ${UPDATER_TOKEN}
      LOG_LEVEL: INFO
    volumes:
      - storage_data:/backend/storage
      - model_cache:/backend/model_cache
    depends_on:
      db:
        condition: service_healthy
      updater:
        condition: service_started
    restart: unless-stopped
COMPOSE

    if [[ "${GPU_ENABLED}" == "1" ]]; then
        cat >> "$COMPOSE_FILE" << 'COMPOSE'
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
COMPOSE
    fi

    cat >> "$COMPOSE_FILE" << 'COMPOSE'

  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: zukan
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: zukan
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U zukan"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  updater:
    image: docker:29.4.0-cli
    command:
      - sh
      - -c
      - |
        cp /scripts/serve-update.sh /tmp/serve-update.sh
        chmod 755 /tmp/serve-update.sh
        exec nc -lk -p 8080 -e /tmp/serve-update.sh
    environment:
      UPDATER_TOKEN: ${UPDATER_TOKEN}
      COMPOSE_PROJECT_NAME: ${COMPOSE_PROJECT_NAME:-zukan}
      ZUKAN_COMPOSE_FILE: /work/docker-compose.yml
      ZUKAN_REPO: ${ZUKAN_REPO:-starsbit/zukan}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - .:/work
      - ./updater:/scripts:ro
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
        if ! grep -q "^UPDATER_TOKEN=" "$ENV_FILE"; then
            local updater_token
            updater_token="$(grep '^WATCHTOWER_TOKEN=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)"
            [[ -n "$updater_token" ]] || updater_token=$(generate_secret | head -c 32)
            echo "UPDATER_TOKEN=${updater_token}" >> "$ENV_FILE"
            success "Added UPDATER_TOKEN to existing $ENV_FILE"
        fi
        return
    fi
    local secret_key pg_password updater_token
    secret_key=$(generate_secret)
    pg_password=$(generate_secret | head -c 32)
    updater_token=$(generate_secret | head -c 32)
    cat > "$ENV_FILE" << ENV
SECRET_KEY=${secret_key}
POSTGRES_PASSWORD=${pg_password}
UPDATER_TOKEN=${updater_token}
ENV
    chmod 600 "$ENV_FILE"
    success "Generated $ENV_FILE with random secrets"
}

write_updater_scripts() {
    mkdir -p "$INSTALL_DIR/updater"
    cat > "$INSTALL_DIR/updater/update.cgi" << 'SCRIPT'
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
SCRIPT

    cat > "$INSTALL_DIR/updater/serve-update.sh" << 'SCRIPT'
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
SCRIPT

cat > "$INSTALL_DIR/updater/run-update.sh" << 'SCRIPT'
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
SCRIPT

    chmod 755 "$INSTALL_DIR/updater/update.cgi" "$INSTALL_DIR/updater/serve-update.sh" "$INSTALL_DIR/updater/run-update.sh"
    success "Wrote updater scripts"
}

write_systemd_service() {
    cat > "$SERVICE_FILE" << SERVICE
[Unit]
Description=Zukan
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
SERVICE
    systemctl daemon-reload
    systemctl enable zukan
    success "Installed and enabled zukan systemd service"
}

pull_and_start() {
    info "Pulling Docker images (first run may take a few minutes)..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull
    info "Starting Zukan..."
    if [[ -f "$SERVICE_FILE" ]] && command -v systemctl &>/dev/null; then
        systemctl start zukan
    else
        docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
    fi
    success "Zukan started"
}

verify_install() {
    info "Waiting for Zukan to become healthy..."
    local i
    for ((i = 1; i <= 36; i++)); do
        if curl -fsS --max-time 5 "http://127.0.0.1/" >/dev/null 2>&1; then
            success "Frontend is reachable on port 80"
            break
        fi
        sleep 5
    done

    if ! curl -fsS --max-time 5 "http://127.0.0.1/" >/dev/null 2>&1; then
        docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=200
        error "Frontend did not become reachable on port 80."
    fi

    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs api --tail=200 \
        | grep -q "Database migration bootstrap finished" \
        || error "API logs did not confirm database migration completion."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs api --tail=200 \
        | grep -q "Bootstrapped default admin user\|Startup phase complete: ensuring admin user" \
        || error "API logs did not confirm admin bootstrap/startup completion."
    success "Zukan health checks passed"

    if [[ "${GPU_ENABLED}" == "1" ]]; then
        info "Running NVIDIA Docker runtime smoke test..."
        if ! docker run --rm --pull always --gpus all \
                nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi \
                >/tmp/zukan-nvidia-smi.log 2>&1; then
            cat /tmp/zukan-nvidia-smi.log 2>/dev/null || true
            error "NVIDIA Docker runtime smoke test failed."
        fi
        success "GPU runtime validated"
    fi
}

print_summary() {
    [[ "${NO_SUMMARY}" == "1" ]] && return 0
    local host_ip
    host_ip=$(hostname -I | awk '{print $1}')
    echo
    echo "══════════════════════════════════════════"
    echo "  Zukan ready"
    echo "══════════════════════════════════════════"
    echo "  URL:      http://${host_ip}"
    echo "  Install:  ${INSTALL_DIR}"
    echo "  Service:  ${SERVICE_FILE}"
    if [[ "${GPU_ENABLED}" == "1" ]]; then
        echo "  Runtime:  GPU enabled (NVIDIA)"
    else
        echo "  Runtime:  CPU only"
    fi
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
install_base_packages
install_docker
install_nvidia_toolkit
write_compose
write_env
write_updater_scripts
write_systemd_service
pull_and_start
verify_install
print_summary
