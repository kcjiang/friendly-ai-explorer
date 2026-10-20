# 数据库全新初始化

当前唯一入口是 `db/init.sql`，已合并历史迁移的最终结构，并加入产品唯一识别名称。`db/archive/` 只保留历史，不再由 Compose 执行。初始化不包含历史业务数据；默认开发者账号为 `dev@kaicheng.me`，初始密码为 `123456`。用户、业务资料和 AI 配置需重新维护，默认 AI 服务、系统配置、提示词及基础选项会初始化。

## 本地重建

先备份数据库并停止写入服务，然后只重建应用数据库。以下操作会清除该库全部数据，不删除上传文件卷或其他数据库。不要使用 `docker compose down -v`，它会同时删除其他持久化卷。

```powershell
docker compose stop frontend backend task-worker
docker compose exec -T postgres pg_dump -U admin -d fae_app_pgdb --no-owner --no-acl | Set-Content -Encoding utf8 database-backup.sql
docker compose exec -T postgres dropdb -U admin --force fae_app_pgdb
docker compose exec -T postgres createdb -U admin fae_app_pgdb
Get-Content db/init.sql -Raw | docker compose exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1
docker compose up -d backend task-worker frontend
```

## 服务器下次部署时重建

同步新代码、`compose.prod.yml` 和 `db/init.sql`，先正常启动 PostgreSQL。确认备份成功，再执行数据库重建，最后启动新版应用。本次开发不会连接或操作服务器。

```bash
docker compose --env-file .env.production -f compose.prod.yml stop frontend backend task-worker
docker compose --env-file .env.production -f compose.prod.yml exec -T postgres pg_dump -U admin -d fae_app_pgdb --no-owner --no-acl > database-before-reset.sql
# 检查上一条命令成功且备份非空后，再执行下列命令。
docker compose --env-file .env.production -f compose.prod.yml exec -T postgres dropdb -U admin --force fae_app_pgdb
docker compose --env-file .env.production -f compose.prod.yml exec -T postgres createdb -U admin fae_app_pgdb
docker compose --env-file .env.production -f compose.prod.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1 < db/init.sql
docker compose --env-file .env.production -f compose.prod.yml up -d backend task-worker frontend
```

此方式无需删除 `${FAE_DATA_DIR}/postgres/data`，上传文件及日志目录也不会被删除。旧上传文件会成为无数据库引用的文件，如需清理应另行处理。若在全新服务器使用空的 PostgreSQL 数据目录，Compose 会自动运行一次 init.sql，无需再手动导入。更新脚本本身不会清空已有服务器数据库。
