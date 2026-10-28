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
5. Ensure the storage and logs directories under `FAE_DATA_DIR` are writable by the backend image's UID 10001.
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

## Development and production storage

Both backend images run as UID 10001, use `/app/data` for business files and `/app/logs` for application logs, and disable Python bytecode files. The development image enables Uvicorn reload; Compose bind-mounts the source and uses named `storage_data` and shared `logs_data` volumes. The production image uses server bind mounts under `FAE_DATA_DIR`; prepare `storage` and `logs` with UID 10001 write access. The worker shares application logs with the backend in both environments.

The retired public upload directory, `UPLOAD_DIR`, and `/uploads` proxy are removed. Current uploads still use `/api/v1/uploads`, with temporary chunks and files inside `STORAGE_DIR`. The source tree's old empty upload directory is no longer needed. Legacy Docker upload volumes are not used by the current configuration; existing volume contents are not deleted automatically.

For an existing development volume created by the retired root container, adjust its ownership once before starting the updated image:

```sh
docker compose run --rm --no-deps --user root backend chown -R 10001:10001 /app/data
```

This changes ownership only; it does not migrate or delete files. Fresh named volumes already inherit the image directory ownership.
