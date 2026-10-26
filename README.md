# Zukan

Self-hosted media server for anime illustrations, fanart, and video clips. Upload your collection, let AI tag everything automatically with Danbooru-style tags, then browse and search by character, series, artist, rating, or any combination.

---

## Why self-host?

Most anime image boards and booru sites are public. You upload an image and it's indexed, scraped, and visible to anyone forever. That's fine for sharing, but it's not how most people want to store a personal collection — fan edits, private commissions, screenshots, clips, or anything you just want organised for yourself.

Zukan runs entirely on your own hardware. Nothing leaves your network unless you choose to make it public. There are no accounts to create on third-party services, no usage limits, and no ads. When the project stops being maintained, your library and metadata are still yours in a plain PostgreSQL database you control.

### What you get

**Automatic tagging** — every image and video you upload is analysed by WD ViT tagger v3, a state-of-the-art ONNX model trained on Danbooru. Characters, series, artists, styles, and ratings are detected without any manual work. Tags are stored at configurable confidence thresholds you can tune in the admin panel.

**Tag-based search** — filter your library by any combination of tags, characters, series, artists, and ratings. Include and exclude tags simultaneously. Filter by NSFW or sensitive content flags independently.

**Albums** — organise media into curated albums with cover images and descriptions. All albums belong to the single library.

**Favorites** — star any image or clip for fast access without moving it out of its album or timeline view.

**Timeline and gallery views** — media is grouped by capture date so your library feels chronological. The "On This Day" rail surfaces media from the same calendar date in previous years.

**URL ingest** — paste a URL to import media directly from the web without downloading it to your machine first.

**Characters and series tracking** — the tagger detects character and series entities and links them to media automatically. You can browse by character or series across your whole library.

**OCR** — optional text extraction from images, configurable per language, with a manual override field for corrections.

**Trash and soft-delete** — deleted media goes to trash first with a configurable purge interval, so accidental deletes are recoverable.

**Single owner** — one global library with local password login or OIDC SSO (including Authentik). Configure tagging, OCR, processing and storage through application settings. There is no registration, user management, sharing, public media, gacha, collection economy, or trading.

**SHA-256 deduplication** — uploading the same file twice doesn't create a duplicate. The second upload is silently ignored.

**GPU or CPU** — the tagger runs on NVIDIA GPUs for fast batch processing, and falls back to CPU automatically if no GPU is present.

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

On Debian 11+ or Ubuntu 22.04+, clone the repository and run the installer as root:

```bash
git clone https://github.com/starsbit/Zukan.git /opt/zukan
cd /opt/zukan
sudo bash install.sh
```

The installer installs Docker, generates `.env` secrets and a one-time `SETUP_TOKEN`, builds the local frontend and API sources, and installs a systemd service. Set `GPU_ENABLED=1` when running it to enable NVIDIA support. An existing `.env` is retained. Restarting the service starts the built version; it never fetches source or builds a newer version.

Open `http://<host-ip>` and create the owner login using `SETUP_TOKEN` from `.env`. See the authentication instructions below for OIDC instead.

### Proxmox LXC install

Run `bash install-lxc.sh` from a checkout on the Proxmox host as root. The script creates an unprivileged Debian 12 container with Docker, clones the source into `/opt/zukan` inside it, and builds there. NVIDIA devices are detected automatically; `GPU_REQUIRED=1` requires a GPU. Defaults are 4 GB RAM, 4 cores, 32 GB disk, DHCP, and `local-lvm` storage. Override with `CTID`, `CT_HOSTNAME`, `MEMORY`, `CORES`, `DISK_SIZE`, `STORAGE`, `TEMPLATE_STORAGE`, `BRIDGE`, `IP`, and `GATEWAY`.

Enter the container with `pct enter <id>`. The checkout, `.env`, and systemd service live inside the container. Use the manual upgrade procedure below there. The CPU compose file is `docker-compose.selfhost.yml`; GPU installs use `docker-compose.selfhost.gpu.yml`.

### Manual install

Install Docker Engine with Compose, then:

```bash
git clone https://github.com/starsbit/Zukan.git
cd Zukan
cp .env.prod.example .env
# Fill SECRET_KEY, POSTGRES_PASSWORD and SETUP_TOKEN with independent random secrets:
openssl rand -hex 32
docker compose -p zukan -f docker-compose.selfhost.yml up -d --build --remove-orphans
```

Use `docker-compose.selfhost.gpu.yml` (or `docker-compose.prod.yml`) for NVIDIA GPUs. All deployment templates build the checked-out source. Keep the same compose file, project name and `.env` for subsequent commands. Named volumes retain the database, original media and model cache.

### Upgrading

Back up the database, media, deployment configuration and current source revision first. Read release migration notes. The single-owner release requires the explicit owner selection and maintenance-window procedure below before API startup.

For subsequent source-based upgrades, in the installation checkout:

```bash
docker compose -p zukan -f docker-compose.selfhost.yml stop api
git pull --ff-only
docker compose -p zukan -f docker-compose.selfhost.yml build
docker compose -p zukan -f docker-compose.selfhost.yml up -d --remove-orphans
docker compose -p zukan -f docker-compose.selfhost.yml logs --tail=100 api
```

Use your actual project name and GPU compose file when applicable. Database migrations run on API startup. Build failures leave the API stopped; fix the build before restarting. No update check, in-app update action, updater sidecar, or automatic deployment remains. `--remove-orphans` removes the old updater container when migrating an existing stack. Never use `down -v` during an upgrade.

**Moving an image-based installation to source:** stop its API and updater using the old compose file; back up its `.env`, compose configuration and data. Clone into a new directory rather than overwriting an existing non-Git installation. Copy the existing `.env` into the checkout. Preserve the old Compose project name (inspect `docker compose ls`) with `-p`; this retains the same named volumes. Port any custom bind mounts, volume names, ports and GPU settings to a local compose override, and use that override consistently. Keep `ZUKAN_LIBRARY_HOST_PATH` for NAS mounts. Update the systemd unit's working directory and compose paths to the checkout, and remove old timers or external Watchtower services you configured yourself. Do not start a second API against the same database. Build the new sources, run the breaking migration preflight below, then start the stack with `--remove-orphans`. Legacy updater scripts and `UPDATER_*`/`WATCHTOWER_*` environment entries can then be deleted.

PostgreSQL must support `pgvector`. For legacy PostgreSQL 16 installs, the provided templates use `pgvector/pgvector:pg16` with the same data volume. `scripts/migrate-prod-pgvector.sh` is a manual, PostgreSQL-16-only helper that backs up the compose file and recreates only the database container; it leaves the API stopped for owner migration. It never downloads or installs updater components. Do not switch database major versions against an existing data volume.

---

### NAS-backed media storage

After a first setup or upgrade, admins see a folder prompt until the library folder is explicitly confirmed. Choose **Keep current folder** to retain the current location, **Open storage settings** to configure another folder, or **Later** to defer until the next sign-in or page reload. Successful storage migration also confirms the folder.

PostgreSQL stays in its existing database volume. An admin can move media to a mounted NAS folder and catalog existing images, GIFs, and videos there without changing their filenames or subfolders.

1. Mount your NAS share on the Docker host, then set `ZUKAN_LIBRARY_HOST_PATH=/mnt/nas/anime` in the deployment `.env`. The Compose templates expose this directory to the API at `/library` and retain the old `storage_data` volume during migration. For Proxmox LXC, the path must be mounted inside the LXC where Docker runs.
2. Recreate the API container with your usual Compose file, for example `docker compose -f docker-compose.prod.yml up -d api`.
3. Open **Library maintenance → Storage** and save settings. Discovered files join the global library. The default scan interval is 3600 seconds; set it to 0 for manual scanning.
4. Enter `/library` as the destination, validate it, then choose **Copy, verify and migrate**. Existing IDs, metadata, albums, favorites, and embeddings are preserved. Migration includes trashed media.
5. Zukan copies and hashes every referenced asset, switches the library root, checks file access and image/video processing, then deletes only verified source copies. Unrelated source files remain. Reads continue during copying; writes and processing pause until migration finishes.

Generated thumbnails and posters live under `.zukan/thumbnails/` and `.zukan/posters/` by default. You can choose another hidden subfolder. New uploads use `uploads/`; existing NAS files stay in place. **Scan now** discovers external additions and unambiguous file moves. Missing files keep their database records; changed content requires an admin to accept and reprocess it. Manual tags, character/series annotations, OCR overrides, and rating overrides remain intact. Permanent deletion also deletes the cataloged NAS original; soft deletion retains it.

Storage settings and migration progress survive restarts. Interrupted copying and cleanup resume on startup; jobs paused by an error show **Resume migration** after you correct the reported issue. Missing source assets or conflicting destination content block migration without deleting source files. A NAS disconnect pauses file mutations and scanning, and retains metadata. Keep the `.zukan-library-id` marker in each library: it distinguishes the correct mounted library from an empty mountpoint. Existing thumbnails remain valid if you change the generated-files subfolder; new thumbnails use the updated setting.

**Database maintenance:** In **Admin → Storage**, select **Inspect database** to review missing catalog assets, including trash. Cleanup requires acknowledgment and rechecks only the reviewed IDs. Records whose originals are still missing are permanently deleted through normal media deletion: foreign-key cascades and nulling rules remove dependent links. Surviving generated files are removed only when no other record references them. Recovered originals are skipped. Records missing only generated files retain their annotations and relationships; broken thumbnail/poster references are cleared and marked failed for reprocessing. Storage identity checks and migration/scan locks prevent cleanup of an unavailable library or during migration. This is explicit maintenance; periodic scans continue to preserve missing records. Review or restore externally moved files before choosing permanent cleanup.

Run one API worker per database; startup enforces this with a PostgreSQL advisory lock so separate processes cannot bypass migration pauses. The provided deployment already runs one worker. NAS mount configuration is retained in `.env`. Wait for migration to finish before running backup/export commands.

---

### Exporting and Importing Data

Use the data export script from your laptop to create one archive containing the PostgreSQL dump, tags, embeddings, media files, thumbnails, and posters:

```bash
scripts/export-production-data.sh --ssh root@your-server --remote-dir /opt/zukan --output ./zukan-prod-data.tar.gz
```

For an install created by `install-lxc.sh`, SSH to the Proxmox host and pass the container ID instead of enabling SSH inside the LXC:

```bash
scripts/export-production-data.sh --ssh root@your-proxmox-host --pct 201 --output ./zukan-prod-data.tar.gz
```

Import that archive into the current local Docker Compose install:

```bash
scripts/import-production-data.sh ./zukan-prod-data.tar.gz --yes
```

The import replaces the target database, copies media into the target library directory, and adapts legacy paths when source and target installs use different storage directories. NAS libraries keep relative media paths; the restored library root is set to the target directory. Use `--target-storage-dir /library` to restore into a mounted NAS destination. Existing unreferenced files in the target storage volume are left in place by default; add `--replace-storage` to clear the local storage volume first.

Both scripts accept `--compose-file`, `--env-file`, and `--project-name` for non-standard installs. Run either script with `--help` for the full option list.

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

4. Self-hosters explicitly pull the desired source revision and rebuild their deployment using the upgrade procedure above.

To delete a tag if something went wrong before the images were pushed:

```bash
git push origin :v1.2.3
```

## Breaking upgrade to a single owner

Stop the API and all workers during the upgrade. Back up PostgreSQL and the library, including hidden generated files, before starting. The migration never moves or deletes library files, but removes other accounts, sharing, gacha, collection, trade, and economy records. All previous sessions and API keys stop working.

Before upgrading an existing database, run the new release's read-only preflight command against the old database (without starting the API):

```sh
python -m backend.app.owner_migration preflight
```

For Docker, with the API stopped and the new source built:

```sh
docker compose -p zukan -f docker-compose.selfhost.yml run --rm --no-deps api python -m backend.app.owner_migration preflight
```

Set `SINGLE_USER_OWNER_ID` in the deployment environment to the selected existing account's UUID. Its username, password hash and preferences survive. Startup refuses an existing database without a valid selection, even when it contains only one account. Then start the new API and frontend together; never run the previous API against the migrated schema. Rollback requires restoring the backup and previous release. There is no downgrade migration.

All media IDs, paths, annotations, trash states, albums and background jobs survive. Identical hashes remain separate records. Album names may repeat. Favorites are unioned. Tags merge by exact name and character/series entities by type and normalized name, with the selected owner's metadata taking priority. Other accounts cannot log in after migration. Storage quotas are removed; storage usage and disk availability remain visible.

### Local owner setup

Use `AUTH_MODE=local` (the default) and set a random `SETUP_TOKEN` generated with `openssl rand -hex 32`. Open the login page and enter the token, owner username and password. Setup is available only while no owner exists. There is no `admin/admin` account. The installer writes a setup token into its protected environment file. An upgraded installation uses the selected owner's existing password and does not run setup again.

### OIDC / Authentik

Set `AUTH_MODE=oidc` and configure all six values below through the deployment environment. Password login and password changes are disabled in this mode. The owner API key remains available for integrations.

```dotenv
OIDC_DISCOVERY_URL=https://sso.example.com/application/o/zukan/.well-known/openid-configuration
OIDC_ISSUER=https://sso.example.com/application/o/zukan/
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
OIDC_CALLBACK_URL=https://zukan.example.com/api/v1/auth/oidc/callback
OIDC_ALLOWED_SUBJECT=the-owner-immutable-subject
```

Create an Authentik OAuth2/OpenID provider with authorization-code flow, a signing certificate (RS256), and the exact callback URI above. Use its discovery URL and exact issuer, including trailing slash. Configure the owner's `sub` claim explicitly; email or username is not used to grant access. Other provider identities are rejected. The `openid profile` scopes suffice. Zukan's frontend and API must share an origin, as in the bundled reverse proxy. HTTPS is required except for localhost development.

A fresh OIDC installation creates its singleton owner independently of provider claims. Changing authentication configuration invalidates existing application sessions; API keys remain independent. Logout ends the Zukan session without signing the owner out of the SSO provider. To recover access, update the deployment configuration while the API is stopped; switching an OIDC-only installation to local mode requires setting the owner's password hash through an operator-controlled database recovery procedure. There is no public recovery or fallback login.
