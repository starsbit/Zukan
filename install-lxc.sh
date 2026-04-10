#!/usr/bin/env bash
# Zukan — Proxmox LXC installer
# Run on the Proxmox host as root.
#
# Usage:
#   bash install-lxc.sh
#
# Override defaults via environment variables:
#   MEMORY=8192 STORAGE=local-lvm APP_VERSION=0.0.3 bash install-lxc.sh
#   CTID=201 CT_HOSTNAME=zukan-test bash install-lxc.sh
#
# Requirements:
#   - Proxmox VE 8.x
#   - Internet access from both host and container
#   - NVIDIA drivers installed on the host for GPU passthrough
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
CTID="${CTID:-}"
HOSTNAME="${CT_HOSTNAME:-zukan}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
DISK_SIZE="${DISK_SIZE:-32}"
MEMORY="${MEMORY:-4096}"
SWAP="${SWAP:-2048}"
CORES="${CORES:-4}"
BRIDGE="${BRIDGE:-vmbr0}"
IP="${IP:-dhcp}"              # Static IP in CIDR notation, or "dhcp"
GATEWAY="${GATEWAY:-}"
APP_VERSION="${APP_VERSION:-0.0.3}"
GPU_REQUIRED="${GPU_REQUIRED:-0}"

INSTALL_DIR="/opt/zukan"
SOURCE_DIR="${INSTALL_DIR}/source"
COMPOSE_TEMPLATE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/docker-compose.prod.yml"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="/etc/systemd/system/zukan.service"

# ── Helpers ──────────────────────────────────────────────────────────────────
info()  { printf '\033[1;34m  [INFO]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[1;32m  [ OK ]\033[0m  %s\n' "$*"; }
warn()  { printf '\033[1;33m  [WARN]\033[0m  %s\n' "$*"; }
die()   { printf '\033[1;31m  [ERR ]\033[0m  %s\n' "$*" >&2; exit 1; }

run()  { pct exec "${CTID}" -- bash -lc "$1"; }
push() { pct push "${CTID}" "$1" "$2"; }

require_command() {
    command -v "$1" &>/dev/null || die "$1 not found."
}

ensure_storage_exists() {
    pvesm status --storage "$1" &>/dev/null || die "Storage '$1' not found in Proxmox."
}

ensure_bridge_exists() {
    ip link show "$1" &>/dev/null || die "Bridge '$1' not found on the host."
}

wait_for_pct_exec() {
    local attempts="${1:-12}"
    local delay="${2:-5}"
    local i
    for ((i = 1; i <= attempts; i++)); do
        if pct exec "${CTID}" -- true &>/dev/null; then
            return 0
        fi
        sleep "${delay}"
    done
    return 1
}

wait_for_http() {
    local url="$1"
    local attempts="${2:-30}"
    local delay="${3:-5}"
    local i
    for ((i = 1; i <= attempts; i++)); do
        if run "curl -fsS --max-time 5 '${url}' >/dev/null"; then
            return 0
        fi
        sleep "${delay}"
    done
    return 1
}

extract_template_name() {
    awk '
        {
          for (i = 1; i <= NF; i++) {
            if ($i ~ /^debian-12-standard_.*_amd64\.tar\.zst$/) {
              print $i
            }
          }
        }
    ' | sort -V | tail -n 1
}

write_compose_from_template() {
    local destination="$1"
    local include_gpu="$2"
    local tmp

    [[ -f "${COMPOSE_TEMPLATE}" ]] || die "Compose template not found at ${COMPOSE_TEMPLATE}"

    tmp="$(mktemp)"
    awk \
        -v version="${APP_VERSION}" \
        -v include_gpu="${include_gpu}" '
        {
          if (skip_deploy) {
            if ($0 ~ /^  [^[:space:]]/ || $0 ~ /^volumes:/) {
              skip_deploy = 0
            } else {
              next
            }
          }

          if ($0 ~ /^  api:$/) {
            in_api = 1
          } else if ($0 ~ /^  [^[:space:]]/ && $0 !~ /^  api:$/) {
            in_api = 0
          }

          if (include_gpu != "1" && in_api && $0 ~ /^    deploy:$/) {
            skip_deploy = 1
            next
          }


          gsub(/ghcr\.io\/starsbit\/zukan-frontend:latest/, "ghcr.io/starsbit/zukan-frontend:" version)
          gsub(/ghcr\.io\/starsbit\/zukan-api:latest/, "ghcr.io/starsbit/zukan-api:" version)
          print
        }
        ' "${COMPOSE_TEMPLATE}" > "${tmp}"

    push "${tmp}" "${destination}"
    rm -f "${tmp}"
}

write_systemd_service() {
    local tmp

    tmp="$(mktemp)"
    cat > "${tmp}" <<'SERVICE'
[Unit]
Description=Zukan
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/zukan
EnvironmentFile=/opt/zukan/.env
ExecStart=/usr/bin/docker compose up -d --pull always
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
SERVICE

    push "${tmp}" "${SERVICE_FILE}"
    rm -f "${tmp}"
}

push_directory() {
    local source_dir="$1"
    local destination_dir="$2"
    local archive_name
    local local_archive
    local remote_archive

    [[ -d "${source_dir}" ]] || die "Directory not found: ${source_dir}"

    archive_name="$(basename "${source_dir}")-$(date +%s).tar.gz"
    local_archive="$(mktemp "/tmp/${archive_name}.XXXXXX")"
    remote_archive="/tmp/${archive_name}"

    tar -C "$(dirname "${source_dir}")" -czf "${local_archive}" "$(basename "${source_dir}")"
    push "${local_archive}" "${remote_archive}"
    rm -f "${local_archive}"

    run "mkdir -p '${destination_dir}' && tar -xzf '${remote_archive}' -C '${destination_dir}' && rm -f '${remote_archive}'"
}

# ── Pre-flight ───────────────────────────────────────────────────────────────
[[ "$(id -u)" -eq 0 ]] || die "Run as root on the Proxmox host."
require_command pct
require_command pveam
require_command pvesm
require_command pvesh
require_command ip
require_command curl
require_command openssl
require_command lspci

if [[ -z "${CTID}" ]]; then
    CTID="$(pvesh get /cluster/nextid 2>/dev/null)" || die "Unable to determine the next free Proxmox container ID."
    [[ -n "${CTID}" ]] || die "Proxmox did not return a next free container ID."
    info "Selected next available container ID: ${CTID}"
elif pct status "${CTID}" &>/dev/null; then
    die "Container ${CTID} already exists. Set CTID=<id> to use another ID."
fi
ensure_storage_exists "${STORAGE}"
ensure_storage_exists "${TEMPLATE_STORAGE}"
ensure_bridge_exists "${BRIDGE}"
[[ "${GPU_REQUIRED}" == "0" || "${GPU_REQUIRED}" == "1" ]] || die "GPU_REQUIRED must be 0 or 1."
[[ "${APP_VERSION}" =~ ^[0-9A-Za-z._-]+$ ]] || die "APP_VERSION contains unsupported characters."

# ── 1. GPU detection ─────────────────────────────────────────────────────────
info "Detecting NVIDIA GPU devices on the host..."

NVIDIA_DEVICES=()
if lspci -nn 2>/dev/null | grep -Eiq '(VGA|Display|3D).*\[10de:'; then
    for dev in /dev/nvidia*; do
        [[ -c "${dev}" ]] && NVIDIA_DEVICES+=("${dev}")
    done
    if [[ -d /dev/nvidia-caps ]]; then
        for dev in /dev/nvidia-caps/*; do
            [[ -c "${dev}" ]] && NVIDIA_DEVICES+=("${dev}")
        done
    fi
fi

if [[ ${#NVIDIA_DEVICES[@]} -gt 0 ]]; then
    ok "Found ${#NVIDIA_DEVICES[@]} NVIDIA device(s): ${NVIDIA_DEVICES[*]}"
    GPU_ENABLED=1
else
    GPU_ENABLED=0
    if [[ "${GPU_REQUIRED}" == "1" ]]; then
        die "GPU_REQUIRED=1 was set, but no NVIDIA character devices were found on the host."
    fi
    warn "No NVIDIA devices found. Continuing with CPU-only tagging."
fi

# ── 2. Template discovery ────────────────────────────────────────────────────
info "Resolving latest Debian 12 template..."
DOWNLOADED_TEMPLATE="$(pveam list "${TEMPLATE_STORAGE}" 2>/dev/null | extract_template_name)"
AVAILABLE_TEMPLATE="$(pveam available --section system 2>/dev/null | extract_template_name)"

if [[ -z "${AVAILABLE_TEMPLATE}" && -z "${DOWNLOADED_TEMPLATE}" ]]; then
    die "Could not find a Debian 12 LXC template via pveam."
fi

TEMPLATE="${AVAILABLE_TEMPLATE:-${DOWNLOADED_TEMPLATE}}"

if [[ -z "${DOWNLOADED_TEMPLATE}" || "${DOWNLOADED_TEMPLATE}" != "${TEMPLATE}" ]]; then
    info "Downloading template ${TEMPLATE} to ${TEMPLATE_STORAGE}..."
    pveam download "${TEMPLATE_STORAGE}" "${TEMPLATE}" \
        || die "Template download failed. Check Proxmox internet access."
else
    info "Using cached template ${TEMPLATE}"
fi
ok "Template ready"

# ── 3. Create LXC (unprivileged) ─────────────────────────────────────────────
info "Creating LXC container ${CTID} (${HOSTNAME})..."

NET_ARG="name=eth0,bridge=${BRIDGE}"
if [[ "${IP}" == "dhcp" ]]; then
    NET_ARG+=",ip=dhcp"
else
    NET_ARG+=",ip=${IP}"
    [[ -n "${GATEWAY}" ]] && NET_ARG+=",gw=${GATEWAY}"
fi

pct create "${CTID}" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
    --hostname "${HOSTNAME}" \
    --rootfs "${STORAGE}:${DISK_SIZE}" \
    --memory "${MEMORY}" \
    --swap "${SWAP}" \
    --cores "${CORES}" \
    --net0 "${NET_ARG}" \
    --unprivileged 1 \
    --features nesting=1,keyctl=1 \
    --onboot 1

ok "Container created"

# ── 4. GPU passthrough ───────────────────────────────────────────────────────
if [[ "${GPU_ENABLED}" == "1" ]]; then
    info "Configuring GPU passthrough..."
    CONF="/etc/pve/lxc/${CTID}.conf"
    dev_idx=0
    for dev in "${NVIDIA_DEVICES[@]}"; do
        printf 'dev%s: %s,gid=44\n' "${dev_idx}" "${dev}" >> "${CONF}"
        dev_idx=$((dev_idx + 1))
    done
    ok "GPU passthrough configured"
else
    info "Skipping GPU passthrough"
fi

# ── 5. Start container ───────────────────────────────────────────────────────
info "Starting container..."
pct start "${CTID}"
wait_for_pct_exec 18 5 || die "Container started, but pct exec never became ready."
ok "Container running"

# ── 6. Base packages ─────────────────────────────────────────────────────────
info "Installing base packages..."
run "export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl gnupg lsb-release"
ok "Base packages ready"

# ── 7. Docker ────────────────────────────────────────────────────────────────
info "Installing Docker..."
run "install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \$(. /etc/os-release && echo \"\$VERSION_CODENAME\") stable\" > /etc/apt/sources.list.d/docker.list
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker"
ok "Docker installed"

# ── 8. NVIDIA Container Toolkit ──────────────────────────────────────────────
if [[ "${GPU_ENABLED}" == "1" ]]; then
    info "Installing NVIDIA Container Toolkit..."
    run "distribution=\$(. /etc/os-release; echo \${ID}\${VERSION_ID})
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/\${distribution}/libnvidia-container.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  > /etc/apt/sources.list.d/nvidia-container-toolkit.list
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker
systemctl restart docker"
    ok "NVIDIA Container Toolkit installed"
fi

# ── 9. Write app config ──────────────────────────────────────────────────────
info "Writing Zukan configuration..."
POSTGRES_PASSWORD="$(openssl rand -hex 16)"
SECRET_KEY="$(openssl rand -hex 32)"

run "mkdir -p '${INSTALL_DIR}'"
write_compose_from_template "${INSTALL_DIR}/docker-compose.yml" "${GPU_ENABLED}"

ENV_TMP="$(mktemp)"
cat > "${ENV_TMP}" <<ENV
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
SECRET_KEY=${SECRET_KEY}
ENV
push "${ENV_TMP}" "${INSTALL_DIR}/.env"
rm -f "${ENV_TMP}"
run "chmod 600 '${INSTALL_DIR}/.env'"

write_systemd_service
run "systemctl daemon-reload"
run "systemctl enable zukan"
ok "Zukan service installed"

# ── 10. Verification ─────────────────────────────────────────────────────────
info "Verifying Docker, application startup, and service state..."
run "docker compose -f '${INSTALL_DIR}/docker-compose.yml' --env-file '${INSTALL_DIR}/.env' pull" \
    || die "Docker image pull failed. Check whether the GHCR images for version ${APP_VERSION} are public and accessible from the container."
run "systemctl start zukan"
run "systemctl is-enabled zukan"
run "systemctl is-active zukan"
run "docker compose -f '${INSTALL_DIR}/docker-compose.yml' --env-file '${INSTALL_DIR}/.env' ps"

wait_for_http "http://127.0.0.1/" 36 5 || {
    run "docker compose -f '${INSTALL_DIR}/docker-compose.yml' --env-file '${INSTALL_DIR}/.env' logs --tail=200"
    die "Frontend did not become reachable on port 80 inside the container."
}

run "docker compose -f '${INSTALL_DIR}/docker-compose.yml' --env-file '${INSTALL_DIR}/.env' logs api --tail=200 | grep -q 'Database migration bootstrap finished'" \
    || die "API logs did not confirm database migration completion."
run "docker compose -f '${INSTALL_DIR}/docker-compose.yml' --env-file '${INSTALL_DIR}/.env' logs api --tail=200 | grep -q 'Bootstrapped default admin user\|Startup phase complete: ensuring admin user'" \
    || die "API logs did not confirm admin bootstrap/startup completion."

if [[ "${GPU_ENABLED}" == "1" ]]; then
    info "Running NVIDIA runtime smoke test inside the container..."
    if ! run "docker run --rm --pull always --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi >/tmp/zukan-nvidia-smi.log 2>&1"; then
        run "cat /tmp/zukan-nvidia-smi.log 2>/dev/null || true"
        if [[ "${GPU_REQUIRED}" == "1" ]]; then
            die "GPU_REQUIRED=1 was set, but the NVIDIA Docker runtime smoke test failed."
        fi
        die "NVIDIA devices were passed through, but Docker could not use them."
    fi
    ok "GPU runtime validated"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
CT_IP="$(pct exec "${CTID}" -- bash -lc "hostname -I | awk '{print \$1}'" 2>/dev/null || true)"
[[ -n "${CT_IP}" ]] || CT_IP="<pending>"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Zukan v${APP_VERSION} deployed"
echo "══════════════════════════════════════════════════════"
echo "  Container  : ${CTID} (${HOSTNAME})"
echo "  IP address : ${CT_IP}"
echo "  Access URL : http://${CT_IP}"
if [[ "${GPU_ENABLED}" == "1" ]]; then
    echo "  Runtime    : GPU enabled (NVIDIA validated)"
else
    echo "  Runtime    : CPU only"
fi
echo ""
echo "  Config     : ${INSTALL_DIR}/docker-compose.yml"
echo "  Secrets    : ${INSTALL_DIR}/.env"
echo "  Service    : ${SERVICE_FILE}"
echo "  Logs       : pct exec ${CTID} -- docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"
echo ""
echo "  Default login : admin / admin"
echo "  Change your password immediately via the admin panel."
echo ""
echo "  Useful commands:"
echo "    pct enter ${CTID}"
echo "    pct exec ${CTID} -- systemctl status zukan"
echo "    pct exec ${CTID} -- docker compose -f ${INSTALL_DIR}/docker-compose.yml ps"
echo ""
echo "  To upgrade the app in-place inside the container:"
echo "    edit ${INSTALL_DIR}/docker-compose.yml image tags"
echo "    systemctl restart zukan"
echo "══════════════════════════════════════════════════════"
echo ""
