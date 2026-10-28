# Production deployment

## Files

| Purpose | Configuration | Environment file |
| --- | --- | --- |
| Local development | `docker-compose.yml` | `.env`, copied from `.env.example` |
| Production | `docker-compose.prod.yml` | `.env.prod`, copied from `.env.prod.example` |

The production stack runs PostgreSQL, the backend, the workbench worker, the frontend, and Nginx. Images are published under `ghcr.io/kcjiang/fae-backend` and `ghcr.io/kcjiang/fae-frontend`. Prefer an explicit release tag in `IMAGE_TAG` for reproducible deployments.

## First installation

1. Install Docker Engine and Docker Compose on the server. Copy `docker-compose.prod.yml`, `db/init.sql`, and the `nginx/` configuration into the deployment directory.
2. Copy `.env.prod.example` to `.env.prod`. Set independent random values for `DB_PASSWORD`, `APP_MASTER_KEY`, and `AUTH_SECRET`. Restrict access to this file, for example with `chmod 600 .env.prod`.
3. Set `APP_URL` to the public HTTPS URL, including any externally mapped port. Set `FAE_DATA_DIR` to the persistent data directory and set the bind address and HTTP/HTTPS ports for the host's network configuration.
4. Prepare the hostname and TLS certificates. See [Nginx configuration](../nginx/README.md). The default configuration requires the host's `/etc/letsencrypt/live` and `/etc/letsencrypt/archive` directories.
5. Ensure the uploads, storage and logs directories under `FAE_DATA_DIR` are writable by the backend image's UID 10001.
6. Start the stack:

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml config --quiet
docker compose --env-file .env.prod -f docker-compose.prod.yml pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --wait
```

An empty PostgreSQL data directory initializes automatically from `db/init.sql`. Change the initial account password after signing in, then configure AI and mail services.

## Updating an existing installation

Back up the database, uploaded files, deployment configuration, and encryption secrets before upgrading. Preserve `APP_MASTER_KEY`, `AUTH_SECRET`, and `DB_PASSWORD` when retaining existing data. Review the release's database requirements before starting a new image.

Installations using the former filenames should rename `compose.prod.yml` to `docker-compose.prod.yml` and `.env.production` to `.env.prod`, preserving the existing environment values and file permissions. Then update operational commands to use the new names. This file rename does not require resetting the database.

Set `IMAGE_TAG` to the selected release, pull the images, and run `up -d --wait` using the commands above. Inspect status with:

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs --tail 100 backend workbench-worker frontend nginx
```

## Database initialization

`db/init.sql` is the single fresh-installation schema, including file spaces, resumable uploads and immutable ticket attachments. This release rebaselines the schema: initialize an empty database and do not apply the initialization script to an existing populated database. Historical storage upgrade scripts and the legacy file migration command have been removed. Back up the database and persistent files before a reset; a reset database must not reuse orphaned old managed attachment files. See [file storage](file-storage.md) for the directory layout, quota and cleanup rules.
