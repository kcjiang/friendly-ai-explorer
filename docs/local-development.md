# 本地开发环境

## 文件说明

| 用途 | Compose | 环境变量 |
| --- | --- | --- |
| 本地开发 | `docker-compose.yml` | `.env`，示例 `.env.example` |
| 生产部署 | `compose.prod.yml` | 显式传入 `--env-file .env.production` |

## 首次启动

启动 Docker Desktop，确认 Linux 容器引擎可用。在项目根目录的 PowerShell 中执行：

```powershell
Copy-Item .env.example .env
```

填写 DB_PASSWORD、JWT_SECRET_KEY 和 AUTH_SECRET 三个不同的随机值，推荐使用至少 32 字节随机值的十六进制表示。不要将 `.env` 提交 Git。

```powershell
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
```

访问 `http://localhost:3000`。浏览器同源访问 `/api/v1` 和 `/uploads`，由 Next.js 转发至 `backend:8000`。`NEXT_PUBLIC_API_URL` 在 Compose 中设为空字符串，不能使用 Docker 服务名作为浏览器地址。

开发容器使用 Node 22、pnpm 9.15.9，与生产构建工具版本一致。前后端代码挂载支持热更新，并启用轮询以适配 Windows 文件共享。修改环境变量或 Dockerfile 后重新执行 `up -d --build`。

## 验收与排查

### 工单库升级

工单重构新增 `db/migration_v6_tickets.sql`，最近删除新增 `db/migration_v7_catalog_trash.sql`。已有数据库需按 v5 → v6 → v7 顺序迁移；无需删除数据库。编号、权限、新旧状态映射及完整操作步骤见 [工单库与看板](tickets.md)。

### 团队资料库

访问 `/catalog` 可维护客户、产品和项目。已有开发数据库需先执行 `db/migration_v5_catalog.sql`，再重建后端以安装离线城市目录依赖；全新数据库会自动初始化。具体命令和功能说明见 [团队资料库](catalog.md)。

### 丢弃旧开发数据库并重新初始化

以下操作将永久删除本地开发数据库中的记录。上传文件卷会被保留，但原文件的数据库关联记录会消失。生产环境不使用此流程。

1. 修改根目录 `.env` 的 DB_PASSWORD 为新的随机十六进制密码。
2. 在项目根目录 PowerShell 中确认当前开发数据库挂载：

```powershell
docker inspect fae_postgres --format '{{json .Mounts}}'
```

找到 Destination 为 `/var/lib/postgresql/data` 的 volume，其 Name 在当前项目中为 `friendly-ai-explorer_postgres_data`。如项目目录名或项目名称不同，实际卷名可能不同，以下删除命令必须使用刚确认的 Name。

3. 逐条执行，每步成功才继续：

```powershell
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml stop frontend backend postgres
docker compose -f docker-compose.yml rm -f postgres
docker volume rm friendly-ai-explorer_postgres_data
docker compose -f docker-compose.yml up -d --wait
docker compose -f docker-compose.yml ps
```

只删除 postgres 容器和已确认的数据卷，不使用 `down -v`，以免删除上传文件卷。空数据库首次启动会自动执行已挂载的初始化 SQL，新密码会同时用于数据库初始化和后端连接，无需手动执行 SQL 或重新构建镜像。

4. 退出原登录会话，访问 `http://localhost:3000/login`，使用初始账号登录。

### 常规检查

```powershell
docker compose -f docker-compose.yml logs --tail 100 backend frontend
curl.exe http://localhost:8000/health
curl.exe -I http://localhost:3000/login
```

浏览器验证登录、业务列表、上传下载，以及修改前后端源码后的热更新。更改前端依赖后，匿名 node_modules 卷可能保留旧依赖；需要时运行：

```powershell
docker compose -f docker-compose.yml exec frontend pnpm install --frozen-lockfile
docker compose -f docker-compose.yml restart frontend
```

容器端口沿用 3000、8000、5432 的现有发布方式；本机防火墙应按实际开发网络限制访问。

如果重建镜像后页面仍显示旧 Next.js 版本，可重新创建前端匿名依赖与构建缓存卷：

```powershell
docker compose -f docker-compose.yml up -d --build --renew-anon-volumes frontend
```

该选项刷新前端的 node_modules 和 .next 匿名卷，不会删除 postgres_data 和 uploads_data 命名卷。修改 AUTH_SECRET 或 JWT_SECRET_KEY 后，旧登录会话会失效，请清除 localhost 站点 Cookie 并重新登录。
