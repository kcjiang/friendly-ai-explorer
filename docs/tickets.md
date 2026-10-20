> 全新数据库统一执行 `db/init.sql`；下文归档迁移命令仅适用于旧版本升级，不应在新基线之后执行。清空重建参见 [数据库重建](database-reset.md)。

# 工单库与看板

入口：`/ticket`。默认卡片视图仅展示分配给当前用户的工单；列表视图可切换「只看分配给我 / 所有人的工单」。所有启用的已登录成员都可查看工单。同一浏览器按账户记住最后选择的卡片/列表视图；清除站点数据后恢复默认。

## 新建和维护

先在「数据维护」中建立客户、产品和项目，再新建工单。选择项目后，显示名称引用该项目的客户公司名与产品型号。分配给默认为当前账户，也可选择其他启用账户。

- 问题描述支持 Markdown 编写与预览，详情自动渲染。原始客户提报单独保存并提供给 AI 分析。
- 来源可选择 WhatsApp、Email、微信等常用值，也可自行填写。来源编号、来源链接、状态描述、下一步计划及备注可留空。
- 选择已创建 TAPD 工单后必须填写 HTTP(S) 链接；选择「否」会清空链接并禁用输入。
- 重要性：Trivial、Major、Critical。重要性排序使用严重程度，而不是英文拼写顺序。
- 状态：新工单、待复现、修复中、验证修复、挂起、已解决。
- 卡片和列表共用「全部 / 打开 / 关闭」筛选，默认打开；打开包含除已解决以外的全部状态，关闭仅包含已解决。可与搜索、工单范围和被分配人筛选组合使用，切换视图时保留当前筛选。
- 卡片视图点击「创建日期」向下展开日期区间，调整开始和结束日期后点击「确认筛选」。按浏览器本地时区计算，包含结束当天，任一端留空表示不限；「重置」立即清除日期条件。折叠区域保留已确认条件，切换列表视图暂不应用日期条件，返回卡片后继续使用。
- 点击卡片或列表记录打开详情，点击「编辑」解锁。卡片视图支持拖拽改变状态，同时提供状态选择框供键盘和触屏使用。
- 顶部操作栏采用串口页的紧凑风格，单行约 54px，高度随窄屏换行增加；日期调整区在工具栏下方展开并推下内容。搜索涵盖工单名称、标题、描述、下一步计划、来源、项目、客户、产品、中文状态、重要性及被分配人；排序按钮可按创建/更新时间、系统序号、重要性、状态或标题排序。列表每页显示 20 条。
- 列表「只看分配给我」显示名称/标题、项目（客户公司名-产品型号）、重要性、简要问题描述、状态、下一步计划。描述和计划最多显示两行，超出省略；悬停或打开详情可查看完整内容。
- 列表「所有人的工单」在第一列增加「分配给」，并提供被分配人筛选，可与搜索组合使用。该筛选不影响个人列表和卡片视图。

## 编号规则

显示名称：`客户公司名-来源侧编号或来源＋项目序号-产品型号-ft系统序号`。

例如同项目的前两条工单分别来自 Email 和微信，显示片段是 `Email1`、`微信2`，不是各来源分别从 1 开始。填写来源侧编号时显示该编号，但这条工单仍消耗一个项目序号。

- 系统序号使用 PostgreSQL 的现有 `ticket_seq`，全系统递增；删除、事务失败及回滚均不回收序列已领取的值，允许跳号。
- 项目序号使用独立计数表和原子 UPSERT。删除工单不删除计数器；并发创建不会领取重复号码。
- 更改项目时领取目标项目的新序号，原项目不回收原序号，`ft` 编号保持不变。转回原项目也领取新序号。
- 客户公司名、产品型号、来源和来源编号修改后，显示名称相应变化；`ft` 编号是稳定标识。

## 权限与审计

创建人、创建时间、最后更新人、更新时间由后端记录；客户端不能指定这些字段。页面按浏览器本地时区显示时间。

创建后，只有开发者、领导、最后更新人、被分配人可修改或删除。创建人身份本身不提供永久编辑权。每次成功修改、评论或 AI 分析写回都会更新最后更新人与时间，并递增 revision。

后端在持有行锁时重新检查权限和 revision。发生修改冲突会提示刷新；普通工程师不能通过直接调用 API、拖拽、评论或 AI 分析绕过权限。删除需要确认且检查 revision；系统保留邮件与 AI 任务历史，但其已删除工单关联置空。

## 已有数据库升级

先备份，按顺序执行 `migration_v5_catalog.sql`、`migration_v6_tickets.sql`、`migration_v7_catalog_trash.sql`，然后部署对应版本后端和前端。此更改不能只更新前端。

Windows 本地开发（项目根目录 PowerShell）：

```powershell
Get-Content db/archive/migration_v5_catalog.sql -Raw | docker compose -f docker-compose.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1
Get-Content db/archive/migration_v6_tickets.sql -Raw | docker compose -f docker-compose.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1
Get-Content db/archive/migration_v7_catalog_trash.sql -Raw | docker compose -f docker-compose.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1
docker compose -f docker-compose.yml up -d --build
```

生产环境需要将新 SQL 复制到 `/opt/fae/db/` 并同步 Compose 文件。在维护窗口暂停后端，执行迁移后再启动包含本次代码的镜像：

```bash
cd /opt/fae
sudo docker compose --env-file .env.production -f compose.prod.yml stop backend
sudo docker compose --env-file .env.production -f compose.prod.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1 < db/archive/migration_v5_catalog.sql
sudo docker compose --env-file .env.production -f compose.prod.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1 < db/archive/migration_v6_tickets.sql
sudo docker compose --env-file .env.production -f compose.prod.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1 < db/archive/migration_v7_catalog_trash.sql
sudo docker compose --env-file .env.production -f compose.prod.yml pull backend frontend
sudo docker compose --env-file .env.production -f compose.prod.yml up -d --wait
```

只有镜像已经发布并确认包含此迁移对应代码后才能升级生产。目前本次开发未发布镜像。迁移后不能直接回退到旧镜像，需使用备份恢复对应旧数据库。

全新数据库由 Compose 自动按顺序执行 SQL。v6 迁移记录在 `schema_migrations`，重复执行不会重新改号。

### 历史数据处理

- 保留原 UUID、文本资料、评论与创建时间；原工单号保存在 `legacy_ticket_no`，并为存量记录分配 `ft` 编号。
- 旧库没有项目关联或最后更新人记录，不能可靠推断：历史工单显示「待关联项目」，首次编辑需选择项目；初始更新人回填创建人，迁移写入会将存量记录的更新时间设为迁移执行时间。未分配工单回填创建人为被分配人。
- 旧状态：open → 新工单，in_progress → 修复中，pending → 挂起，resolved/closed → 已解决。
- 旧重要性：critical → Critical，high/medium → Major，low → Trivial。
- 邮件批准转工单时新增项目选择，使用同一编号与校验流程；原始邮件正文写入原始提报字段。首页统计和 AI TODO 已适配新状态。

## 开发验证

```powershell
docker compose -f docker-compose.yml exec -T backend python -m unittest discover -s tests -v
docker compose -f docker-compose.yml exec -T frontend pnpm exec tsc --noEmit
```

测试覆盖删除不复用、项目转移、多人权限交接、无权限写入、TAPD 与关联校验、并发分配和并发版本冲突。仅在开发数据库运行：大部分测试回滚业务记录，并发测试创建独立项目后按精确 ID 清理。所有测试消耗的全局序号均不回收。
