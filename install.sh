#!/usr/bin/env bash
# Zukan source checkout installer
# Usage: sudo bash install.sh (from a source checkout)
#
# Requirements: Debian 11+ or Ubuntu 22.04+, internet access, run as root
#
# Environment variables (all optional):
#   GPU_ENABLED=1    Configure NVIDIA GPU support in Docker (default: 0)
#   NO_SUMMARY=1     Suppress the final summary (used when called from install-lxc.sh)
set -euo pipefail

REPO="starsbit/zukan"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/zukan}"
if [[ -f "$SCRIPT_DIR/backend/Dockerfile" ]]; then INSTALL_DIR="$SCRIPT_DIR"; fi
COMPOSE_FILE="$INSTALL_DIR/docker-compose.selfhost.yml"
if [[ "${GPU_ENABLED:-0}" == "1" ]]; then COMPOSE_FILE="$INSTALL_DIR/docker-compose.selfhost.gpu.yml"; fi
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
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg lsb-release git openssl
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

prepare_source() {
    if [[ -f "$INSTALL_DIR/backend/Dockerfile" ]]; then
        info "Using source checkout at $INSTALL_DIR"
    elif [[ ! -e "$INSTALL_DIR" ]] || [[ -z "$(ls -A "$INSTALL_DIR")" ]]; then
        git clone "https://github.com/${REPO}.git" "$INSTALL_DIR"
    else
        error "$INSTALL_DIR contains a legacy installation. Follow the README source migration procedure; preserve its .env and Docker project name."
    fi
}

write_env() {
    if [[ -f "$ENV_FILE" ]]; then
        info ".env already exists — keeping existing secrets (delete $ENV_FILE to regenerate)"
        return
    fi
    local secret_key pg_password setup_token
    setup_token=$(generate_secret)
    secret_key=$(generate_secret)
    pg_password=$(generate_secret | head -c 32)
    cat > "$ENV_FILE" << ENV
AUTH_MODE=local
SETUP_TOKEN=${setup_token}
SECRET_KEY=${secret_key}
POSTGRES_PASSWORD=${pg_password}
ENV
    chmod 600 "$ENV_FILE"
    success "Generated $ENV_FILE with random secrets. Use SETUP_TOKEN from that file for first-time owner setup."
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
Environment=COMPOSE_PROJECT_NAME=zukan
ExecStart=/usr/bin/docker compose -f ${COMPOSE_FILE} up -d --remove-orphans
ExecStop=/usr/bin/docker compose -f ${COMPOSE_FILE} stop
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
SERVICE
    systemctl daemon-reload
    systemctl enable zukan
    success "Installed and enabled zukan systemd service"
}

build_and_start() {
    info "Building local sources (first run may take several minutes)..."
    docker compose -p zukan -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build
    info "Starting Zukan..."
    if [[ -f "$SERVICE_FILE" ]] && command -v systemctl &>/dev/null; then
        systemctl restart zukan
    else
        docker compose -p zukan -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans
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
        | grep -q "Startup phase complete: initializing owner authentication" \
        || error "API logs did not confirm owner authentication startup completion."
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
    echo "  Create your owner login using SETUP_TOKEN from $ENV_FILE."
    echo "  Existing installations require SINGLE_USER_OWNER_ID before upgrade."
    echo ""
    echo "  To upgrade: cd $INSTALL_DIR && git pull --ff-only"
    echo "    Then run: docker compose -p zukan -f $COMPOSE_FILE up -d --build --remove-orphans"
    echo "══════════════════════════════════════════"
    echo
}

# ── Main ────────────────────────────────────────────────────────────────────
require_root
detect_os
install_base_packages
install_docker
install_nvidia_toolkit
prepare_source
write_env
write_systemd_service
build_and_start
verify_install
print_summary
