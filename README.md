# Zukan

Self-hosted anime image server. Upload images and video, tag them automatically with AI (WD ViT tagger v3), and browse by character, series, artist, or rating.

---

## Table of Contents

- [Self-hosting](#self-hosting)
  - [Quick install (Proxmox LXC / Debian / Ubuntu)](#quick-install)
  - [Proxmox LXC install](#proxmox-lxc-install)
  - [Manual install with Docker Compose](#manual-install)
  - [Upgrading](#upgrading)
  - [Configuration](#configuration)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Running locally](#running-locally)
  - [Backend tests](#backend-tests)
  - [E2E tests](#e2e-tests)
- [Releasing (maintainers)](#releasing)
  - [CI/CD overview](#cicd-overview)
  - [Creating a release](#creating-a-release)

---

## Self-hosting

### Quick install

Runs on any Debian 11+ or Ubuntu 22.04+ host, including Proxmox LXC containers.

```bash
curl -fsSL https://raw.githubusercontent.com/starsbit/zukan/main/install.sh | bash
```

If you are deploying on a Proxmox host and want Zukan to create and configure the LXC for you, use the dedicated [Proxmox LXC install](#proxmox-lxc-install) guide below instead of running this inside a container.

The script will:
1. Install Docker and the Compose plugin if not already present
2. Fetch the latest release from GitHub
3. Create `/opt/zukan/` with a `docker-compose.yml` pinned to that version
4. Generate a random `SECRET_KEY` and `POSTGRES_PASSWORD` and write them to `/opt/zukan/.env`
5. Pull the images and start the stack

Once complete the app is available at `http://<host-ip>`. The default login is **admin / admin** - change it immediately via the account settings.

Re-running the script later upgrades to the latest release while preserving your `.env` and all data volumes.

---

### Proxmox LXC install

This is the recommended path if you want to deploy Zukan as a Proxmox LXC. The installer runs on the Proxmox host as `root`, creates an unprivileged Debian 12 container, installs Docker inside it, and starts Zukan for you.

**1. Check the prerequisites on the Proxmox host**

- Proxmox VE 8.x
- Internet access from both the Proxmox host and the future container
- A valid Proxmox storage for the container disk, such as `local-lvm`
- A valid storage for LXC templates, such as `local`
- A valid bridge, usually `vmbr0`
- Optional: NVIDIA drivers and `/dev/nvidia*` devices on the host if you want GPU tagging

The installer auto-detects NVIDIA devices. If no GPU is found, it falls back to CPU-only mode. Set `GPU_REQUIRED=1` if the install should fail instead of continuing without GPU support.

**2. Run the installer directly on the Proxmox host**

Run this on the Proxmox host shell, not inside a container:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/starsbit/zukan/main/install-lxc.sh)
```

This downloads only the installer script into a temporary shell process. It does not require cloning the repository and does not leave a Zukan checkout behind on the Proxmox node after the install finishes.

If the installer fails after creating the container, it cleans up the partial LXC automatically so the Proxmox node is not left with a half-finished Zukan install.

**3. Run the installer**

The command above is the default install command. By default, the script:

- Picks the next free container ID automatically
- Creates a container named `zukan`
- Uses `local-lvm` for the root disk and `local` for the Debian template
- Creates a 32 GB disk
- Assigns 4 GB RAM, 2 GB swap, and 4 CPU cores
- Attaches the container to `vmbr0`
- Uses DHCP networking
- Deploys Zukan version `0.0.11`

**4. Customize the install if needed**

Set environment variables before the command to override the defaults:

```bash
CTID=201 \
CT_HOSTNAME=zukan \
STORAGE=local-lvm \
TEMPLATE_STORAGE=local \
DISK_SIZE=64 \
MEMORY=8192 \
SWAP=2048 \
CORES=6 \
BRIDGE=vmbr0 \
IP=192.168.178.50/24 \
GATEWAY=192.168.178.1 \
APP_VERSION=0.0.11 \
GPU_REQUIRED=1 \
bash <(curl -fsSL https://raw.githubusercontent.com/starsbit/zukan/main/install-lxc.sh)
```

Common options:

| Variable | Default | Description |
|---|---|---|
| `CTID` | next free ID | Proxmox container ID |
| `CT_HOSTNAME` | `zukan` | Hostname inside Proxmox |
| `STORAGE` | `local-lvm` | Storage used for the LXC root disk |
| `TEMPLATE_STORAGE` | `local` | Storage used for the Debian 12 template |
| `DISK_SIZE` | `32` | Root disk size in GB |
| `MEMORY` | `4096` | RAM in MB |
| `SWAP` | `2048` | Swap in MB |
| `CORES` | `4` | Number of CPU cores |
| `BRIDGE` | `vmbr0` | Proxmox network bridge |
| `IP` | `dhcp` | Static IP in CIDR format, or `dhcp` |
| `GATEWAY` | empty | Gateway for static IP setups |
| `APP_VERSION` | `0.0.11` | Zukan image tag to deploy |
| `GPU_REQUIRED` | `0` | Fail if no NVIDIA GPU is available |

**5. What the installer does**

The Proxmox installer performs these steps automatically:

1. Detect NVIDIA GPU devices on the host
2. Resolve and download the latest Debian 12 LXC template
3. Create an unprivileged LXC with `nesting=1` and `keyctl=1`
4. Optionally add NVIDIA device passthrough to the container config
5. Start the container
6. Install base packages, Docker Engine, Buildx, and Docker Compose
7. Install the NVIDIA Container Toolkit when GPU passthrough is enabled
8. Generate `/opt/zukan/.env` with a random `POSTGRES_PASSWORD` and `SECRET_KEY`
9. Write `/opt/zukan/docker-compose.yml`
10. Install `/etc/systemd/system/zukan.service`
11. Pull the Zukan images, start the stack, and verify the frontend and API startup logs

**6. Open Zukan after the installer finishes**

At the end, the script prints the container ID, detected IP address, and access URL. Open:

```text
http://<container-ip>
```

The frontend listens on port `80` inside the container, so you normally do not need to add a port to the URL.

**7. Sign in and secure the default account**

The first login is:

```text
admin / admin
```

Change the password immediately in the Zukan account settings after the first sign-in.

**8. Verify the deployment and manage the service**

Useful commands after install:

```bash
pct enter 201
pct exec 201 -- systemctl status zukan
pct exec 201 -- docker compose -f /opt/zukan/docker-compose.yml ps
pct exec 201 -- docker compose -f /opt/zukan/docker-compose.yml logs -f
```

Replace `201` with your actual container ID. The installer also writes:

- Compose file: `/opt/zukan/docker-compose.yml`
- Secrets file: `/opt/zukan/.env`
- Systemd unit: `/etc/systemd/system/zukan.service`

**9. Upgrade the Proxmox LXC install later**

To upgrade an existing LXC deployment in place:

1. Edit `/opt/zukan/docker-compose.yml` inside the container and change the image tags to the target version.
2. Restart the service:

```bash
pct exec 201 -- systemctl restart zukan
```

You can also inspect the current stack state with:

```bash
pct exec 201 -- docker compose -f /opt/zukan/docker-compose.yml ps
```

Database migrations run automatically on startup, and the named Docker volumes are preserved.

---

### Manual install

**1. Copy the production env template and fill in the two required secrets:**

```bash
cp .env.prod.example .env
# Edit .env - generate SECRET_KEY with: openssl rand -hex 32
```

**2. Start the stack:**

```bash
docker compose -f docker-compose.prod.yml up -d
```

On macOS hosts without NVIDIA GPUs, use the CPU-only compose variant instead:

```bash
docker compose -f docker-compose.prod.macos.yml up -d
```

All other settings (AniList OAuth, tagger thresholds, token expiry, OCR, rate limits, etc.) are configurable through the admin panel after first login - no env vars needed for those.

---

### Upgrading

Edit `docker-compose.prod.yml` and update the image tags to the new version, then:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Database migrations run automatically on startup. Named volumes (`postgres_data`, `storage_data`, `model_cache`) are preserved.

When a new version is available, all users will receive an in-app notification automatically.

---

### Configuration

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | Yes | JWT signing key. Generate with `openssl rand -hex 32`. |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password (used to build `DATABASE_URL` inside the compose file). |

Everything else is configured through the **Admin → App Config** panel after login, including:

- AniList OAuth credentials and redirect URI
- Tagger confidence thresholds
- OCR on/off and language settings
- Access and refresh token expiry
- Upload and auth rate limits
- Thumbnail size and trash purge interval

---

## Development

### Prerequisites

- Docker and Docker Compose
- Python 3.12+ with a virtual environment
- Node.js 24+ and npm (project is developed on Node 25)

### Running locally

**1. Clone and install dependencies:**

```bash
# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt -r backend/requirements-dev.txt

# Frontend
cd frontend && npm ci
```

**2. Copy the dev env file:**

```bash
cp .env.example .env
```

**3. Start the full stack with Docker Compose:**

```bash
docker compose up -d
```

This starts PostgreSQL, the API (port 8000), and the frontend (port 4200). The API rebuilds automatically when the compose file is re-run.

On macOS hosts, use the CPU-only stack file:

```bash
docker compose -f docker-compose.macos.yml up -d
```

For faster backend iteration, run the API outside Docker:

```bash
# With the DB container still running:
uvicorn backend.app.main:api --reload --host 0.0.0.0 --port 8000
```

The API docs (Swagger UI) are available at `http://localhost:8000/docs`.

---

### Backend tests

The test suite uses `pytest` with `testcontainers` - a Postgres container is spun up automatically, no manual DB setup needed.

```bash
# Run all tests
pytest backend/tests

# Run a specific file or test
pytest backend/tests/routers/test_admin.py
pytest backend/tests/routers/test_admin.py::test_admin_app_config_contract

# With coverage
pytest backend/tests --cov=backend/app --cov-report=term-missing
```

---

### E2E tests

E2E tests use Playwright via Angular CLI and run against a full Docker Compose stack.

```bash
# Install Playwright browsers (first time only)
cd frontend && npx playwright install --with-deps chromium

# Run the e2e suite
bash e2e.sh
```

`e2e.sh` builds and starts the stack from `docker-compose.e2e.yml`, waits for the API and frontend to be healthy, runs the tests, and tears the stack down on exit. Logs from the API are printed on failure.

The e2e stack uses an external Docker volume named `zukan_model_cache` to avoid re-downloading the tagger model on each run. Create it once:

```bash
docker volume create zukan_model_cache
```

The model is downloaded into the volume on the first run (~600 MB, takes a few minutes).

---

## Releasing

### CI/CD overview

Two GitHub Actions workflows live in [.github/workflows/](.github/workflows/):

- `ci.yml`
  - Runs backend tests
  - Runs frontend build
  - Runs e2e tests
- `release.yml`
  - Publishes versioned Docker images to GHCR
  - Creates GitHub Releases

---

### Creating a release

1. Ensure all changes are merged to `main` and tests are green.
2. Tag the commit with a semantic version:

```bash
git tag v1.2.3
git push origin v1.2.3
```

3. The `release.yml` workflow runs automatically. It will:
   - Run backend tests, frontend build, and e2e tests in parallel
   - Build `zukan-api` and `zukan-frontend` images with `APP_VERSION=1.2.3` baked in
   - Push both images to GHCR tagged `1.2.3` and `latest`
   - Create a GitHub Release with auto-generated release notes

4. Self-hosters running a previous version will receive an in-app update notification the next time their instance starts.

To delete a tag if something went wrong before the images were pushed:

```bash
git push origin :v1.2.3
```
