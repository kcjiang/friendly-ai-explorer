# 团队资料库

入口：侧栏 Ticket 下方的「数据维护」或 `/catalog`。所有已登录且启用的团队成员可新建、浏览、编辑、软删除和恢复客户、产品及项目；工单通过项目引用客户和产品信息。

## 使用

- 顶部单行操作栏切换三个库，提供搜索、排序、刷新、最近删除和新建入口；列表每页 20 条。操作栏与标题栏均为 64px 高，小屏时可横向滚动。
- 点击记录打开只读预览，再点击「编辑」解锁。保存后显示最新记录和审计信息。
- 客户可以添加多名联系人，每名联系人可维护多条「类型＋内容」联系方式。
- 产品的型号、芯片和系统根据已保存产品提供可选联想，仍允许自行输入新值。
- 项目从客户和产品库检索选择，保存真实外键。相关名称变化会实时反映到项目名称。
- 更新采用 revision 乐观锁；其他成员已修改时返回 409，需关闭重开再编辑。
- 创建人、更新人和时间来自后端登录身份及 UTC 时钟，页面按浏览器本地时间显示。

## 删除与恢复

- 列表和记录预览提供「删除」，确认后移至当前库的「最近删除」，不会立即永久删除。所有成员均可恢复，只有开发者可以清空当前库的最近删除。
- 客户和产品仍被项目引用时不能删除；项目仍被工单引用时不能删除。最近删除中的项目也会阻止其客户和产品被删除，保证项目能够完整恢复。
- 软删除的记录不参与正常列表、关联选择及产品联想；可预览，但必须恢复后才能编辑。恢复项目保留原项目工单计数器。
- 删除、恢复均检查 revision，记录操作人和时间。创建人和创建时间不变。
- 清空需要二次确认，会永久删除该库全部最近删除记录，**包括当前搜索未显示的记录**，无法通过界面恢复。后端再次检查开发者权限与引用关系。
- 删除联系人仅影响客户编辑草稿，保存后才写入数据库，不会单独进入最近删除。

## 数据库迁移

资料库使用 `db/migration_v5_catalog.sql`，工单关联使用 v6，最近删除新增 `db/migration_v7_catalog_trash.sql`。全新数据库由开发和生产 Compose 按顺序自动执行。已有数据库需要显式执行尚未应用的迁移，不需要删除数据卷。

Win11 开发环境，在项目根目录执行：

```powershell
Get-Content db/migration_v5_catalog.sql -Raw | docker compose -f docker-compose.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1
Get-Content db/migration_v6_tickets.sql -Raw | docker compose -f docker-compose.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1
Get-Content db/migration_v7_catalog_trash.sql -Raw | docker compose -f docker-compose.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1
docker compose -f docker-compose.yml up -d --build
```

正式部署前先备份数据库，将新 SQL 复制到服务器 `/opt/fae/db/`，更新 Compose 和应用镜像。Ubuntu 上对已有数据库执行：

```bash
cd /opt/fae
sudo docker compose --env-file .env.production -f compose.prod.yml stop backend
sudo docker compose --env-file .env.production -f compose.prod.yml exec -T postgres \
  psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1 < db/migration_v5_catalog.sql
sudo docker compose --env-file .env.production -f compose.prod.yml exec -T postgres \
  psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1 < db/migration_v6_tickets.sql
sudo docker compose --env-file .env.production -f compose.prod.yml exec -T postgres \
  psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1 < db/migration_v7_catalog_trash.sql
sudo docker compose --env-file .env.production -f compose.prod.yml up -d --wait
```

初始化脚本可重复执行，不会删除现有表和数据。此次未发布新镜像，生产部署应等待包含本功能的镜像版本。

## 地理目录

使用 geonamescache 3.0.2 的离线数据，国家/地区名及城市名默认使用数据源英文名称。城市库使用人口 15,000 以上的主要城市数据；搜索支持数据集中的别名。单次显示最多 100 个城市结果，可输入关键词缩小范围。数据不是所有乡镇的完整清单。

数据来源：[GeoNames](https://www.geonames.org/)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。库代码：[geonamescache](https://github.com/mick/geonamescache)，MIT 许可。运行时不向第三方发送客户资料或位置查询。后续扩展城市目录可在 `backend/app/services/catalog_locations.py` 中集中维护。

## 验证

```powershell
docker compose -f docker-compose.yml exec -T backend python -m unittest discover -s tests -v
docker compose -f docker-compose.yml exec -T frontend pnpm exec tsc --noEmit
```

`test_catalog.py` 使用当前本地测试数据库的表结构和一个启用用户，覆盖创建、修改、审计、关联名称更新、冲突、搜索及认证，以及引用拦截、软删除、恢复、联想排除和清空权限。测试事务结束后回滚业务记录；工单全局序列已领取的号码不回收。应只在开发/测试数据库运行。
