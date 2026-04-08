#!/usr/bin/env bash
# Zukan — Proxmox LXC installer
# Run on the Proxmox host as root.
#
# Usage:
#   bash install-lxc.sh
#
# Override defaults via environment variables:
#   CTID=201 MEMORY=8192 STORAGE=local-lvm bash install-lxc.sh
#
# Requirements:
#   - Proxmox VE 8.x
#   - NVIDIA drivers installed on the host (modules must be loaded)
#   - Internet access from both host and container
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
CTID="${CTID:-200}"
HOSTNAME="${HOSTNAME:-zukan}"
STORAGE="${STORAGE:-local-lvm}"               # LXC rootfs storage pool
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}" # Where to store the CT template
DISK_SIZE="${DISK_SIZE:-32}"                  # GB
MEMORY="${MEMORY:-4096}"                      # MB
SWAP="${SWAP:-2048}"                          # MB
CORES="${CORES:-4}"
BRIDGE="${BRIDGE:-vmbr0}"
# Static IP in CIDR notation (e.g. "192.168.1.50/24") or "dhcp"
IP="${IP:-dhcp}"
GATEWAY="${GATEWAY:-}"

REPO="starsbit/zukan"
INSTALL_DIR="/opt/zukan"

TEMPLATE="ubuntu-22.04-standard_22.04-1_amd64.tar.zst"

# ── Helpers ───────────────────────────────────────────────────────────────────
info()  { printf '\033[1;34m  [INFO]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[1;32m  [ OK ]\033[0m  %s\n' "$*"; }
warn()  { printf '\033[1;33m  [WARN]\033[0m  %s\n' "$*"; }
die()   { printf '\033[1;31m  [ERR ]\033[0m  %s\n' "$*" >&2; exit 1; }

run()  { pct exec "${CTID}" -- bash -c "$1"; }
push() { pct push "${CTID}" "$1" "$2"; }

# ── Pre-flight ────────────────────────────────────────────────────────────────
[[ "$(id -u)" -eq 0 ]]         || die "Run as root on the Proxmox host."
command -v pct   &>/dev/null   || die "pct not found — run this on a Proxmox VE host."
command -v pveam &>/dev/null   || die "pveam not found — run this on a Proxmox VE host."
command -v lspci &>/dev/null   || die "lspci not found — install pciutils on the host."

pct status "${CTID}" &>/dev/null && die "Container ${CTID} already exists. Set CTID=<id> to use another ID."

# ── 1. GPU detection ─────────────────────────────────────────────────────────
info "Detecting NVIDIA GPU..."

NVIDIA_DEVICES=()
if lspci -nn 2>/dev/null | grep -qE "VGA|Display|3D" | grep -q "\[10de:"; then
    # Vendor [10de] = NVIDIA — collect all character devices under /dev/nvidia*
    for dev in /dev/nvidia*; do
        [[ -c "$dev" ]] && NVIDIA_DEVICES+=("$dev")
    done
    if [[ -d /dev/nvidia-caps ]]; then
        for dev in /dev/nvidia-caps/*; do
            [[ -c "$dev" ]] && NVIDIA_DEVICES+=("$dev")
        done
    fi
fi

# Simpler fallback: just check for the devices directly if lspci pipe failed
if [[ ${#NVIDIA_DEVICES[@]} -eq 0 ]]; then
    for dev in /dev/nvidia0 /dev/nvidiactl /dev/nvidia-modeset /dev/nvidia-uvm /dev/nvidia-uvm-tools; do
        [[ -c "$dev" ]] && NVIDIA_DEVICES+=("$dev")
    done
    if [[ -d /dev/nvidia-caps ]]; then
        for dev in /dev/nvidia-caps/*; do
            [[ -c "$dev" ]] && NVIDIA_DEVICES+=("$dev")
        done
    fi
fi

if [[ ${#NVIDIA_DEVICES[@]} -gt 0 ]]; then
    ok "Found ${#NVIDIA_DEVICES[@]} NVIDIA device(s): ${NVIDIA_DEVICES[*]}"
else
    warn "No NVIDIA devices found. Install NVIDIA drivers on the host first."
    warn "GPU passthrough entries will be skipped; tagging will run on CPU."
fi

# ── 2. Template ───────────────────────────────────────────────────────────────
info "Checking for Ubuntu 22.04 template..."
if ! pveam list "${TEMPLATE_STORAGE}" 2>/dev/null | grep -q "ubuntu-22.04"; then
    info "Downloading Ubuntu 22.04 template..."
    pveam download "${TEMPLATE_STORAGE}" "${TEMPLATE}" \
        || die "Template download failed. Check your Proxmox internet access."
fi
ok "Template ready"

# ── 3. Create LXC (unprivileged) ──────────────────────────────────────────────
info "Creating LXC container ${CTID} (${HOSTNAME})..."

NET_ARG="name=eth0,bridge=${BRIDGE}"
if [[ "${IP}" == "dhcp" ]]; then
    NET_ARG+=",ip=dhcp"
else
    NET_ARG+=",ip=${IP}"
    [[ -n "${GATEWAY}" ]] && NET_ARG+=",gw=${GATEWAY}"
fi

pct create "${CTID}" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
    --hostname    "${HOSTNAME}"              \
    --storage     "${STORAGE}"              \
    --rootfs      "${STORAGE}:${DISK_SIZE}" \
    --memory      "${MEMORY}"               \
    --swap        "${SWAP}"                 \
    --cores       "${CORES}"               \
    --net0        "${NET_ARG}"              \
    --unprivileged 1                        \
    --features    nesting=1,keyctl=1        \
    --onboot      1

ok "Container created"

# ── 4. GPU passthrough (Proxmox dev-entry format) ────────────────────────────
# The modern "dev0:" syntax tells Proxmox to handle cgroup allowlisting and
# device bind-mounting automatically — no lxc.cgroup2 or lxc.mount.entry needed.
# gid=44 = 'video' group on Debian/Ubuntu
if [[ ${#NVIDIA_DEVICES[@]} -gt 0 ]]; then
    info "Configuring GPU passthrough (${#NVIDIA_DEVICES[@]} devices)..."
    CONF="/etc/pve/lxc/${CTID}.conf"
    dev_idx=0
    for dev in "${NVIDIA_DEVICES[@]}"; do
        echo "dev${dev_idx}: ${dev},gid=44" >> "${CONF}"
        dev_idx=$((dev_idx + 1))
    done
    ok "GPU passthrough configured"
fi

# ── 5. Start ──────────────────────────────────────────────────────────────────
info "Starting container..."
pct start "${CTID}"
for i in {1..12}; do
    pct exec "${CTID}" -- true 2>/dev/null && break
    sleep 5
done
ok "Container running"

# ── 6. Base packages ──────────────────────────────────────────────────────────
info "Updating base system..."
run "DEBIAN_FRONTEND=noninteractive apt-get update -qq"
run "DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq"
run "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg lsb-release"
ok "Base packages ready"

# ── 7. Docker ────────────────────────────────────────────────────────────────
info "Installing Docker..."
run "install -m 0755 -d /etc/apt/keyrings"
run "curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
     | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
     && chmod a+r /etc/apt/keyrings/docker.gpg"
run "echo \"deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] \
     https://download.docker.com/linux/ubuntu \$(lsb_release -cs) stable\" \
     > /etc/apt/sources.list.d/docker.list"
run "DEBIAN_FRONTEND=noninteractive apt-get update -qq"
run "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io docker-compose-plugin"
run "systemctl enable --now docker"
ok "Docker installed"

# ── 8. NVIDIA Container Toolkit ──────────────────────────────────────────────
if [[ ${#NVIDIA_DEVICES[@]} -gt 0 ]]; then
    info "Installing NVIDIA Container Toolkit..."
    run "curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
         | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg"
    run "curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
         | sed 's|deb https://|deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://|g' \
         > /etc/apt/sources.list.d/nvidia-container-toolkit.list"
    run "DEBIAN_FRONTEND=noninteractive apt-get update -qq"
    run "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nvidia-container-toolkit"
    run "nvidia-ctk runtime configure --runtime=docker"
    run "systemctl restart docker"
    ok "NVIDIA Container Toolkit installed"
fi

# ── 9. Fetch latest Zukan version ────────────────────────────────────────────
info "Fetching latest Zukan release..."
LATEST_VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' \
    | sed 's/.*"tag_name": *"v\?\([^"]*\)".*/\1/')
[[ -n "${LATEST_VERSION}" ]] || die "Could not fetch latest version from GitHub."
ok "Latest version: ${LATEST_VERSION}"

# ── 10. Generate secrets ──────────────────────────────────────────────────────
POSTGRES_PASSWORD="$(openssl rand -hex 16)"
SECRET_KEY="$(openssl rand -hex 32)"

# ── 11. Write docker-compose.yml ─────────────────────────────────────────────
info "Writing docker-compose.yml..."

COMPOSE_TMP="$(mktemp)"

# Build the GPU reservation block only when a GPU was found
GPU_BLOCK=""
if [[ ${#NVIDIA_DEVICES[@]} -gt 0 ]]; then
    GPU_BLOCK="    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]"
fi

cat > "${COMPOSE_TMP}" << COMPOSE
services:
  frontend:
    image: ghcr.io/starsbit/zukan-frontend:${LATEST_VERSION}
    ports:
      - "80:80"
    depends_on:
      api:
        condition: service_started
    restart: unless-stopped

  api:
    image: ghcr.io/starsbit/zukan-api:${LATEST_VERSION}
    environment:
      DATABASE_URL: postgresql+asyncpg://zukan:\${POSTGRES_PASSWORD}@db:5432/zukan
      SECRET_KEY: \${SECRET_KEY}
      LOG_LEVEL: INFO
    volumes:
      - storage_data:/backend/storage
      - model_cache:/backend/model_cache
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
${GPU_BLOCK}

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

volumes:
  postgres_data:
  storage_data:
  model_cache:
COMPOSE

run "mkdir -p ${INSTALL_DIR}"
push "${COMPOSE_TMP}" "${INSTALL_DIR}/docker-compose.yml"
rm -f "${COMPOSE_TMP}"
ok "docker-compose.yml written"

# ── 12. Write .env ────────────────────────────────────────────────────────────
info "Writing .env..."
ENV_TMP="$(mktemp)"
cat > "${ENV_TMP}" << ENV
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
SECRET_KEY=${SECRET_KEY}
ENV
push "${ENV_TMP}" "${INSTALL_DIR}/.env"
rm -f "${ENV_TMP}"
run "chmod 600 ${INSTALL_DIR}/.env"
ok ".env written"

# ── 13. Systemd service ───────────────────────────────────────────────────────
info "Registering zukan.service..."
SVC_TMP="$(mktemp)"
cat > "${SVC_TMP}" << 'SERVICE'
[Unit]
Description=Zukan
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/zukan
EnvironmentFile=/opt/zukan/.env
ExecStart=/usr/bin/docker compose up -d --pull always
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
SERVICE
push "${SVC_TMP}" "/etc/systemd/system/zukan.service"
rm -f "${SVC_TMP}"
run "systemctl daemon-reload"
run "systemctl enable zukan"
ok "zukan.service registered"

# ── 14. Start Zukan ───────────────────────────────────────────────────────────
info "Pulling images and starting Zukan (first run downloads ~1 GB of images + model)..."
run "cd ${INSTALL_DIR} && docker compose pull"
run "systemctl start zukan"
ok "Zukan started"

# ── Summary ───────────────────────────────────────────────────────────────────
CT_IP=$(pct exec "${CTID}" -- bash -c \
    "ip -4 addr show eth0 | grep -oP '(?<=inet\s)[\d.]+'" 2>/dev/null \
    || echo "<pending — check: pct exec ${CTID} -- ip addr>")

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Zukan v${LATEST_VERSION} deployed"
echo "══════════════════════════════════════════════════════"
echo "  Container  : ${CTID} (${HOSTNAME})"
echo "  IP address : ${CT_IP}"
echo "  Access URL : http://${CT_IP}"
echo ""
echo "  Secrets stored at ${INSTALL_DIR}/.env inside the container."
echo "  Default login : admin / admin"
echo "  Change your password immediately via the admin panel."
echo ""
echo "  Useful commands:"
echo "    pct enter ${CTID}"
echo "    pct exec ${CTID} -- docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"
echo ""
echo "  To upgrade: systemctl restart zukan  (inside the container)"
echo "══════════════════════════════════════════════════════"
echo ""
