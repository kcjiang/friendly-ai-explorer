# 升级到 v0.2.0-dev.1

适用于已部署 v0.1.0-dev.3、数据库已完成 v7 迁移的 Linux Docker Compose 环境。先确认 GitHub 的 Publish Docker images 工作流成功，再升级。以下假设代码与 `.env.production` 位于 `/opt/fae`，数据目录也是 `/opt/fae`；按实际路径调整。

保留原 `.env.production`、数据库、上传文件、证书及 Nginx 站点配置；不要执行 `down -v`。如果服务器的 Nginx 配置经过定制，合并本版本的代理超时设置，勿直接覆盖域名和证书配置。

```sh
cd /opt/fae
git fetch origin --tags
# 如有受 Git 跟踪的本地配置改动，先备份并处理，再切换版本。
git checkout v0.2.0-dev.1

# 备份环境配置与数据库；备份文件包含敏感信息。
umask 077
backup_dir="/opt/fae-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp .env.production "$backup_dir/env.production"
cp -a nginx "$backup_dir/nginx"
docker compose --env-file .env.production -f compose.prod.yml exec -T postgres pg_dump -U admin -d fae_app_pgdb -Fc > "$backup_dir/database.dump"
test -s "$backup_dir/database.dump"

# 固定镜像版本，避免 latest 后续变化。此环境变量覆盖 env 文件内的 IMAGE_TAG。
export IMAGE_TAG=v0.2.0-dev.1
docker compose --env-file .env.production -f compose.prod.yml pull backend frontend

# 维护窗口暂停应用写入，再做迁移。postgres 保持运行。
docker compose --env-file .env.production -f compose.prod.yml stop frontend backend
docker compose --env-file .env.production -f compose.prod.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1 < db/archive/migration_v8_ai_routing.sql
docker compose --env-file .env.production -f compose.prod.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1 < db/archive/migration_v9_ai_diagnostics.sql

# 若 FAE_DATA_DIR 不是 /opt/fae，改用实际数据目录。
sudo install -d -o 10001 -g 10001 -m 750 /opt/fae/logs
docker compose --env-file .env.production -f compose.prod.yml up -d --wait backend frontend
docker compose --env-file .env.production -f compose.prod.yml up -d nginx
docker compose --env-file .env.production -f compose.prod.yml exec -T nginx nginx -t
docker compose --env-file .env.production -f compose.prod.yml exec -T nginx nginx -s reload
docker compose --env-file .env.production -f compose.prod.yml ps
docker compose --env-file .env.production -f compose.prod.yml exec -T backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read().decode())"
```

每一步成功后再执行下一步；迁移失败时保持应用停止，排查后重试。SQL 可重复执行。健康检查应返回 `status: ok`、`version: 0.2.0-dev.1`。确认成功后，将 `.env.production` 中的 `IMAGE_TAG` 持久设为 `v0.2.0-dev.1`。

如果服务器不是 Git 克隆目录，从该版本标签下载部署文件，至少同步 `compose.prod.yml`、`db/archive/migration_v8_ai_routing.sql`、`db/archive/migration_v9_ai_diagnostics.sql`，并合并 Nginx 配置变更，再执行备份之后的步骤。GHCR 拉取若提示权限不足，先使用有 `read:packages` 权限的账号登录 `ghcr.io`。

`EMBEDDING_MODEL` 应为 `gemini-embedding-001`（不设置时使用此默认值），保留有效 `GOOGLE_API_KEY`。首次配置 AI 服务前可设置稳定的 `AI_ENCRYPTION_KEY`；已保存加密密钥后不要随意更换它或其回退来源 `JWT_SECRET_KEY`。

升级后在管理后台测试 AI 服务及任务路由，检查应用日志；在知识库为已有已发布文档点击“重建索引”，确认索引状态并测试真实产品问题。向量接口不可用时仍可使用关键词检索。

回退前先停止应用并备份当前数据库。数据库迁移后不能只切换旧镜像，需配合恢复升级前的数据库备份、环境和配置；恢复会丢失备份之后的新数据。
