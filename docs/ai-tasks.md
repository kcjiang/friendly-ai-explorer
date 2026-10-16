# AI任务

页面：`/ai-tasks`。复用登录用户和默认 AI 服务；每个用户仅可访问自己的账户、任务、模板、问题、草稿和执行记录。

## 部署

新数据库通过 Compose 初始化 v11 表。已有数据库需先执行：

```powershell
Get-Content -Raw db/migration_v11_ai_tasks.sql | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U admin -d fae_app_pgdb
docker compose up -d --build backend task-worker frontend
```

生产环境用 `docker compose -f compose.prod.yml`，并先构建发布包含本次代码的镜像。数据库迁移可重复执行。

`task-worker` 是独立后台服务，每15秒查找数据库中到期的任务。计划不依赖网页打开。每次扫描持有数据库任务行锁；多个 worker 或同时点击手动检查不会重复执行。最多扫描4分钟，失败记录错误并等待下一次计划，可手动重试。进程退出时数据库自动释放锁，未完成的扫描回滚，重启后重新检查到期任务。用户禁用后自动停止其定时任务。

## 配置与使用

1. 管理员配置 `JIRA_ALLOWED_HOSTS`，多个主机用逗号分隔，自定义端口需显式填写。默认为 `jira.sdmctech.com:9380`。仅允许 HTTPS，保持证书校验，不跟随重定向。公司 CA 应安装到运行容器的可信证书库。
2. 可设置独立 `TASK_ENCRYPTION_KEY`。留空按 `AI_ENCRYPTION_KEY`、`JWT_SECRET_KEY` 的顺序回退。首次保存后保持密钥稳定；密钥改变需要重新输入账户密码。备份数据库时也要安全备份密钥。
3. 在托管账户中填写 Jira 根地址、用户名、密码并保存，再点击测试连接。凭据用 Fernet 加密，不返回前端，不写入日志或 AI 提示。
4. 创建检查任务，支持 `project = DRACO ORDER BY created DESC`、`key in (DRACO-35, DRACO-30)` 或 `filter = 12345`。间隔最少5分钟，可手动运行或开启定时。首次扫描所有未处理问题均待处理，不采用静默基线。
5. 在问题收件箱点击导入，选择内置或自定义模板，点击 AI 转换。转换时重新读取问题原文、全部评论和附件信息；只传递这些问题数据给已配置的默认 AI 服务，API 不向模型传递密码。
6. AI 返回的缺失值留空并标红。可手动补充、保存、复制。点击复制不改变处理状态；在 TAPD 提交后，点击标记已处理。可恢复为待处理。

## 规则和边界

- 使用 Jira Server/Data Center REST API v2 的 Basic Auth，并通过 `/myself` 验证身份。不支持验证码、浏览器 SSO 或禁用密码 API 认证的站点；遇到此类策略需管理员提供 API 凭据或后续适配登录方式。实现参考 [Atlassian 官方 REST API 文档](https://developer.atlassian.com/server/jira/platform/about-the-jira-server-rest-apis/)。
- 搜索分页读取，单次最多10000个问题；超限或分页异常整次回滚并提示缩小 JQL。评论单独分页读取，不依赖搜索接口中可能截断的评论。
- 以用户、站点和 Jira 问题编号去重。重复或重叠任务会更新来源，保留草稿和已处理状态；已处理问题后续更新不会自动恢复待处理。预览提示来源更新时间与草稿不一致。
- 删除任务保留问题和草稿；删除账户前必须删除其任务。删除自定义模板不影响草稿。内置模板固定保留。
- 本期不写入 Jira 或 TAPD。附件仅保留文件名和来源链接，不下载、解析或上传附件。AI 只生成草稿，仍需人工核实事实和补齐信息。
- 默认使用现有 AI 路由 `default`，不改变其它 AI 任务路由。AI 未配置或返回无效结构时保留原草稿并显示错误。
- 草稿转换含多个模板字段和客户原始描述，单次请求默认提供至少8192输出 token 预算；如果管理员在默认任务路由显式设置输出上限，则遵循该上限。不会修改共享的模型服务配置。
- 模型按原文片段整理信息。概率与分析在后端另行检查复现频率、原因分析依据，避免误用优先级或把现象推测为根因；无附件或日志依据时日志附件留空。客户原始描述和附件列表直接从 Jira 保留。此校验不能代替人工审核语义。
- 调度进程顺序执行最多20个到期任务后重新轮询，当前规模无需消息队列。若后续任务量增长，可替换为队列 worker，保留现有任务和运行记录。

## 验证

```powershell
docker compose exec -T backend python -m unittest tests.test_ai_tasks -v
cd frontend
npx tsc --noEmit
```

测试使用 PostgreSQL 回滚事务和模拟 Jira/AI 响应，不依赖客户站点、不发送缺陷。
