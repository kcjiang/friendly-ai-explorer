# AI 服务与任务调度

管理后台 → **AI 服务与调度**（仅 developer 角色）可添加 Gemini 原生或 OpenAI 兼容服务。所有调用和测试由后端发起，浏览器不持有供应商密钥。

## 升级已有数据库

先按原部署流程备份数据库；已有 v7 数据库执行以下新增迁移，无需删除数据卷：

```powershell
Get-Content db/migration_v8_ai_routing.sql -Raw | docker compose -f docker-compose.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1
Get-Content db/migration_v9_ai_diagnostics.sql -Raw | docker compose -f docker-compose.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1
docker compose up -d --build backend frontend
```

Linux 生产环境先更新部署目录中的 Compose、SQL 和对应应用镜像，再执行：

```sh
docker compose --env-file .env.production -f compose.prod.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1 < db/migration_v8_ai_routing.sql
docker compose --env-file .env.production -f compose.prod.yml exec -T postgres psql -U admin -d fae_app_pgdb -v ON_ERROR_STOP=1 < db/migration_v9_ai_diagnostics.sql
# If FAE_DATA_DIR differs from /opt/fae, use its actual value below.
sudo install -d -o 10001 -g 10001 -m 750 /opt/fae/logs
docker compose --env-file .env.production -f compose.prod.yml up -d backend frontend
```

全新数据库由开发/生产 Compose 自动执行 v8、v9。已有 v8 数据库只需执行 v9。SQL 可重复执行，不覆盖已保存的密钥、模型和路由。迁移必须先于使用新功能。

## 接入 DGX / New API

点击“添加服务”，设置：

- 名称：`DGX Spark Qwen`
- 接口类型：`OpenAI / OpenAI 兼容`
- API Base URL：`http://116.6.18.118:10443/v1`（不再追加 `/chat/completions`）
- API Key：网关颁发的密钥
- 模型：`qwen3.8-27b`（必须与网关暴露的模型名称一致）
- 并发建议先设为 `1`，超时和输出上限按实际测试调整。

保存后测试“普通回答”和“JSON 输出”；在“任务分配”中把“今日 AI TODO”主服务设为该服务。其余任务继续跟随 Gemini，或分别指定其他服务。也可以设置 OpenAI 官方地址 `https://api.openai.com/v1` 和账号可用的 Chat Completions 模型。不同模型支持的接口和参数可能不同，以测试结果为准。

Gemini 原生 Base URL 默认 `https://generativelanguage.googleapis.com/v1beta`，模型填写 `gemini-2.5-flash` 等实际可用名称。切换聊天服务不会修改知识库向量配置；向量化默认使用 `EMBEDDING_MODEL=gemini-embedding-001`、`GOOGLE_API_KEY` 和 768 维索引。旧 `text-embedding-004` 已停用，旧文档需重建索引，详见 [知识库检索与索引](knowledge-rag.md)。独立日志 AI 分析尚无业务入口。

## 路由、失败和缓存

- “默认服务”决定所有“跟随默认”任务的主服务与默认备用。指定主服务的任务拥有自己的备用设置，留空表示不使用备用。
- 任务超时和输出限制：任务设置 → 默认行设置 → 实际服务设置。未显式设置任务/默认输出限制时，TODO 默认至多 768、邮件 1024、工单 1536 Token，且不超过服务上限。连接测试至多 256 Token。
- 保存后每个新请求读取数据库配置；正在执行的请求继续使用原快照，无需重启。
- 网络失败和 HTTP 429/5xx 在同一服务超时总预算内有限重试，默认 1 次，可设置为 0–2 次。429 优先参考 Retry-After，等待时间同样消耗总预算。超时不会自动延长原预算。401/403/404/参数错误直接报错。
- 结构化输出失败可在剩余预算内额外修正一次；仍失败且配置备用服务时尝试备用。各服务最多使用一次总超时预算，流式回答开始输出后不再重试或切换。
- 每服务并发限制覆盖业务调用与连接测试，达到上限后尝试备用或返回繁忙。限制是**每后端进程**的；多进程/多副本的全局限制应同时在 New API/vLLM 配置。
- TODO 成功结果缓存在进程内 120 秒（最多 256 项），相同输入的并发请求合并为一次推理。工单输入、日期或相关路由/服务参数变化会绕过旧缓存。缓存命中不会新增推理调用记录。失败时仍返回项目原有简化 TODO。
- 普通、JSON、流式测试均实际请求模型，不走任务备用、不修改任务分配。禁用服务仍可单独测试。编辑配置后旧测试状态清空。
- 调用记录保留任务、服务、模型、用量（供应商返回时）、耗时、结果和脱敏错误，页面显示最近 100 条。未提供自动清理，应按部署的数据保留需求定期清理历史记录。

## 本地模型兼容

- 思考模式“自动”仅对名称形如 `Qwen3-0.6B`、`Qwen/Qwen3-8B` 的经典 Qwen3 请求 `chat_template_kwargs.enable_thinking=false`，并追加 `/no_think`。该策略不会仅凭 `Qwen` 名称应用到未知的新架构。其他模型可手动选择开/关，但接口需支持相应参数。[Qwen 官方说明](https://qwen.readthedocs.io/en/latest/deployment/vllm.html#thinking-non-thinking-modes)
- TODO、邮件和 JSON 测试默认优先使用 JSON Schema；接口明确拒绝此参数时，在同一预算内降级到 JSON 对象，再降级为提示词约束。强制 Schema 模式不会降级。普通参数错误、认证错误不触发此降级。[vLLM 结构化输出](https://docs.vllm.ai/en/stable/features/structured_outputs/)
- 接收完整 `<think>...</think>` 后的最终 JSON、Markdown 代码块，以及说明文字包围的唯一完整 JSON。不会从未结束的思考或截断数组中猜测答案。TODO 同时兼容原数组与 `{"todos": [...]}`，并规范化 high/medium/low 等已知优先级。
- “应用本地轻量任务参数”可设置 180 秒、1024 输出 Token、并发 1、关闭思考、自动 JSON、温度 0.7 和重试 1 次；需点击保存后生效。该按钮不会改变模型、地址、密钥或任务分配。
- 模型大小、量化、vLLM 模板和网关透传能力会影响速度。27B 在 GB10 上的实际延迟仍需实测，可单独设置较长超时与较低输出上限；应用重试无法消除上游 503 或硬件性能限制。
- RAG 查询向量化异步执行并设置 16 秒总等待上限，失败后改用知识库关键词检索。聊天没有检索到资料时明确提示，不再用通用知识猜测内部产品信息。向量检索使用独立保存点，失败不会使后续工单写回事务失效。

## 管理后台应用日志

管理后台 → **应用日志**，按级别、关键词、时间、请求编号筛选，支持分页和每 10 秒刷新。AI 调用记录的“详情”展示实际预算、输出/思考字符数、结束原因、重试次数、结构化降级等诊断，可点击“查看该请求的应用日志”关联整个请求。

后端响应携带 `X-Request-ID`；前端显示后端错误时附带该编号。日志包括 HTTP 方法/路径/状态/耗时、AI 成功或失败、重试/备用切换、TODO 降级、向量化失败和异常类型/代码位置。未捕获异常返回脱敏的 500 响应。默认不记录查询参数、请求正文、完整模型回答/思考、工单或邮件正文、异常中的 SQL 参数。

日志使用 JSONL 文件自动轮转：单文件约 5 MiB，共 5 份，查询最多扫描最近 10,000 条。目录由 `LOG_DIR` 指定，默认 `/app/logs`；严禁设在公开 `/uploads` 目录下。开发容器通过现有代码目录挂载保留在 `backend/logs/`（已忽略 Git）；生产 Compose 将 `${FAE_DATA_DIR:-/opt/fae}/logs` 绑定到 `/app/logs`，该目录须允许 UID/GID 10001 写入。`LOG_LEVEL` 默认 `INFO`，可设 DEBUG/INFO/WARNING/ERROR/CRITICAL，更改后需重建容器环境。

此页面展示当前后端实例的应用日志，不读取任意主机文件、Docker 守护进程或网关服务器内部日志。多副本部署建议接入集中日志系统；当前文件轮转适用于项目默认的单 worker 部署。历史 v8 AI 记录没有请求编号和详细诊断，新增记录才支持完整关联。

## 密钥

API Key 使用 Fernet 加密，查询接口仅返回是否配置。编辑时密钥留空表示保留原值。加密从稳定的 `AI_ENCRYPTION_KEY` 派生；未配置时从 `JWT_SECRET_KEY` 派生。首次保存前建议设置独立随机值，后续更改加密来源/密钥需重新录入已有服务密钥。原环境变量 Gemini 服务只引用环境密钥，不复制其明文至数据库；填写新密钥后改为加密存储。

公网 HTTP 会明文传输认证和业务数据，正式使用建议 HTTPS。API 地址仅 developer 可设置，应只配置可信服务。删除或禁用被引用服务前需先修改任务分配；历史调用记录保留服务名称。

## 验证

```sh
cd backend
python -m unittest tests.test_ai_routing tests.test_ai_admin tests.test_app_logs -v
```

适配器及路由测试使用模拟 HTTP，不调用付费模型。管理接口测试需要已执行 v8、v9 的本地 PostgreSQL，测试事务最终回滚。
