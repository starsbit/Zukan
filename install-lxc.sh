#!/usr/bin/env bash
# Zukan - Proxmox LXC installer
# Run on the Proxmox host as root.
#
# Usage:
#   bash install-lxc.sh
#   bash <(curl -fsSL https://raw.githubusercontent.com/starsbit/zukan/main/install-lxc.sh)
#
# Override defaults via environment variables:
#   MEMORY=8192 STORAGE=local-lvm bash install-lxc.sh
#   CTID=201 CT_HOSTNAME=zukan-test bash install-lxc.sh
#
# Requirements:
#   - Proxmox VE 8.x
#   - Internet access from both host and container
#   - NVIDIA drivers installed on the host for GPU passthrough
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
REPO="starsbit/zukan"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
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
DNS_SERVERS="${DNS_SERVERS:-1.1.1.1 8.8.8.8}"
GPU_REQUIRED="${GPU_REQUIRED:-0}"

INSTALL_DIR="/opt/zukan"
SERVICE_FILE="/etc/systemd/system/zukan.service"
TEMP_FILES=()
CONTAINER_CREATED=0
INSTALL_SUCCEEDED=0
EXIT_CODE=0

# ── Helpers ──────────────────────────────────────────────────────────────────
info()  { printf '\033[1;34m  [INFO]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[1;32m  [ OK ]\033[0m  %s\n' "$*"; }
warn()  { printf '\033[1;33m  [WARN]\033[0m  %s\n' "$*"; }
die()   { printf '\033[1;31m  [ERR ]\033[0m  %s\n' "$*" >&2; exit 1; }

run()  { pct exec "${CTID}" -- bash -lc "$1"; }
push() { pct push "${CTID}" "$1" "$2"; }

track_temp_file() {
    TEMP_FILES+=("$1")
}

cleanup_temp_files() {
    local path
    for path in "${TEMP_FILES[@]:-}"; do
        [[ -n "${path}" && -e "${path}" ]] && rm -f "${path}"
    done
}

cleanup_failed_install() {
    EXIT_CODE=$?

    if [[ "${EXIT_CODE}" -eq 0 && "${INSTALL_SUCCEEDED}" == "1" ]]; then
        cleanup_temp_files
        return
    fi

    warn "Install failed with exit code ${EXIT_CODE}."
    cleanup_temp_files

    if [[ "${CONTAINER_CREATED}" == "1" ]]; then
        warn "Install failed. Cleaning up container ${CTID} and partial Proxmox config..."
        pct stop "${CTID}" >/dev/null 2>&1 || true
        pct destroy "${CTID}" --purge 1 >/dev/null 2>&1 || true
        if pct status "${CTID}" >/dev/null 2>&1; then
            warn "Automatic cleanup could not fully remove container ${CTID}. Remove it manually with: pct destroy ${CTID} --purge 1"
        else
            ok "Cleaned up failed container ${CTID}"
        fi
    fi

    exit "${EXIT_CODE}"
}

trap cleanup_failed_install EXIT

require_command() {
    command -v "$1" &>/dev/null || die "$1 not found."
}

ensure_storage_exists() {
    pvesm status --storage "$1" &>/dev/null || die "Storage '$1' not found in Proxmox."
}

ensure_bridge_exists() {
    ip link show "$1" &>/dev/null || die "Bridge '$1' not found on the host."
}

reset_debian_apt_sources() {
    info "Resetting Debian APT sources inside the container..."
    run "cat > /etc/apt/sources.list <<'EOF'
deb http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware
deb http://deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
deb http://security.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
EOF
rm -f /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources
apt-get clean
rm -rf /var/lib/apt/lists/*
mkdir -p /var/lib/apt/lists/partial"
    ok "APT sources reset"
}

apt_get() {
    run "export DEBIAN_FRONTEND=noninteractive
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=3 $*"
}

verify_apt_package_available() {
    local package="$1"
    run "apt-cache policy '${package}' | grep -q 'Candidate:' && ! apt-cache policy '${package}' | grep -q 'Candidate: (none)'"
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
    CTID="$(pvesh get /cluster/nextid 2>/dev/null | tr -d '[:space:]')" || die "Unable to determine the next free Proxmox container ID."
    [[ -n "${CTID}" ]] || die "Proxmox did not return a next free container ID."
    info "Selected next available container ID: ${CTID}"
elif pct status "${CTID}" &>/dev/null; then
    die "Container ${CTID} already exists. Set CTID=<id> to use another ID."
fi
ensure_storage_exists "${STORAGE}"
ensure_storage_exists "${TEMPLATE_STORAGE}"
ensure_bridge_exists "${BRIDGE}"
[[ "${GPU_REQUIRED}" == "0" || "${GPU_REQUIRED}" == "1" ]] || die "GPU_REQUIRED must be 0 or 1."


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

if [[ -n "${DNS_SERVERS}" ]]; then
    info "Using container DNS servers: ${DNS_SERVERS}"
fi

pct create "${CTID}" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
    --hostname "${HOSTNAME}" \
    --rootfs "${STORAGE}:${DISK_SIZE}" \
    --memory "${MEMORY}" \
    --swap "${SWAP}" \
    --cores "${CORES}" \
    --net0 "${NET_ARG}" \
    --nameserver "${DNS_SERVERS}" \
    --unprivileged 1 \
    --features nesting=1,keyctl=1 \
    --onboot 1

CONTAINER_CREATED=1
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

# ── 6. Container preparation (Proxmox-template-specific) ────────────────────
reset_debian_apt_sources
apt_get update -qq
verify_apt_package_available gnupg \
    || die "APT metadata is incomplete inside the container. Check container networking/DNS on bridge ${BRIDGE}."
verify_apt_package_available lsb-release \
    || die "APT metadata is incomplete inside the container. Check container networking/DNS on bridge ${BRIDGE}."
ok "Container networking verified"

# ── 7. Run install.sh inside the container ───────────────────────────────────
# Use the local install.sh when the script is run from a checkout so the LXC
# installer can validate in-progress changes. Fall back to GitHub for curl/bash
# usage where no local sibling file exists.
INSTALLER_TMP="$(mktemp)"
track_temp_file "${INSTALLER_TMP}"
if [[ -f "${SCRIPT_DIR}/install.sh" ]]; then
    info "Using local install.sh from ${SCRIPT_DIR}"
    cp "${SCRIPT_DIR}/install.sh" "${INSTALLER_TMP}"
else
    info "Downloading Zukan installer..."
    curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/install.sh" -o "${INSTALLER_TMP}"
fi
push "${INSTALLER_TMP}" /tmp/zukan-install.sh

info "Running Zukan installer inside container (GPU_ENABLED=${GPU_ENABLED})..."
run "GPU_ENABLED=${GPU_ENABLED} NO_SUMMARY=1 bash /tmp/zukan-install.sh"
run "rm -f /tmp/zukan-install.sh"

INSTALL_SUCCEEDED=1

# ── Summary ──────────────────────────────────────────────────────────────────
CT_IP="$(pct exec "${CTID}" -- bash -lc "hostname -I | awk '{print \$1}'" 2>/dev/null || true)"
[[ -n "${CT_IP}" ]] || CT_IP="<pending>"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Zukan deployed"
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
echo "  To upgrade: confirm the update notification in the Zukan admin panel,"
echo "  or run: pct exec ${CTID} -- systemctl restart zukan"
echo "══════════════════════════════════════════════════════"
echo ""
