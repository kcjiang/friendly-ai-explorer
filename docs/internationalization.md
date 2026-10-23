# 国际化约定

## 当前行为

- 基础语言是英文 `en`，首期另支持简体中文 `zh-CN`。繁体中文是独立语言，目前不支持，回退英文。
- 首屏由服务端读取 `Accept-Language`，按质量权重选择浏览器首选语言。`zh-CN`、`zh-SG`、`zh-Hans` 匹配简体中文；繁体中文、无字形信息的 `zh` 和其他不支持语言回退英文。
- 手动切换写入 `FAE_LOCALE` 会话 Cookie（Path=/、SameSite=Lax，HTTPS 下加 Secure），不设置 Expires/Max-Age，不写账号或 localStorage。刷新保持选择。不同浏览器独立判断；浏览器恢复会话时可能恢复会话 Cookie。
- URL 始终保持原有英文路径。登录页和应用页面共用语言按钮，位于主题按钮左侧。切换刷新服务端组件，不整页跳转。

## 前端

`next-intl` 的请求配置位于 `frontend/src/i18n/request.ts`，根布局同时提供当前语言和消息资源，并设置 HTML lang。英文与中文资源位于 `frontend/messages/`，键保持一致：

- `ui`：应用界面和静态标签。
- `dynamic`：含参数、数量或复数的完整句子，使用 ICU MessageFormat。
- `errors`：后端错误码对应的界面消息。

组件通过 `useUiTranslations()` 使用稳定语义键。新增文案同时维护中英文；避免拼接句子，使用命名参数和 ICU plural。英语技术缩写、命令、型号、协议和用户输入不作为翻译键。

`translateLabels()` 仅适用于源码定义的静态标签配置，使用 `label-keys.json` 找到资源键。它保留 value、id、key、href、模式代码等机器值。禁止将接口业务记录、邮件、用户自定义选项、AI 输出传入此函数。

日期显示随界面语言使用 Intl，并保留浏览器显示时区；定时任务使用单独配置的 IANA 时区。语言切换不修改时区或时间值。国家显示使用国家代码和 Intl.DisplayNames，数据库中的国家名及记录标识保持稳定。日期输入/接口仍使用 ISO 格式，日历跟随界面语言。

## 后端与任务

前端请求携带 `X-FAE-Locale`。纯 ASGI `LanguageMiddleware` 用 ContextVar 隔离每个请求的输出语言，覆盖 SSE 生命周期；无有效语言时使用英文。它不影响身份验证和权限。

系统异常使用 `system_message("errors.someCode", **params)`。HTTP 响应统一包含 `error: {code, params}` 和 request_id。表单错误额外返回带 loc、type 和 error 的 detail 数组。未知异常不直接向普通提示暴露第三方响应。

持久化系统消息在现有文本列中保存 `@i18n:` 加 JSON 信封，内容为 code 和 params，避免把某种语言的提示永久写入业务状态。界面在明确的系统消息展示点调用 `systemMessage()`。原始调试输出属于诊断内容，不自动翻译。

AI 生成语言在中央调用层追加约束；JSON 属性、枚举、技术标识和引用保持稳定。TODO 缓存按语言隔离。业务原文、已保存的分析和总结不随界面切换改写。没有配置模型时，兜底 TODO 同样跟随语言。

- 手动自动化任务：提交时将 output_locale 写入任务 snapshot，执行和重试沿用该快照。
- 定时配置：启用或更新计划时保存当时的界面语言到 schedule.output_locale；普通页面切换不会改写它。
- 后台检查：入队时把当次语言快照保存到 workbench_checks.output_locale，后台执行不依赖仍然打开的浏览器。

当前定时调度执行的是收取检查；自动化 AI 任务由用户提交入队。以后若增加定时自动创建 AI 任务，必须把检查任务的 output_locale 继续复制到新任务 snapshot。

## 数据库与重新部署

不向 users 增加语言字段。不创建业务翻译表，不复制中文/英文业务列。

`db/init.sql` 已更新为最终结构：工作台检查增加 output_locale；内置预设命令、分组和默认值使用英文，清除日志命令不再附加中文 echo。系统默认自动化名称和说明也采用英文。

已有数据库不执行自动迁移。新版本需要按 `docs/database-reset.md` 重新初始化后部署；重建前停止应用和工作进程。更新初始化脚本本身不会清空正在运行的数据库。AI 服务和托管凭据需要重新配置。

## 新增越南语、西班牙语等

1. 在 locale.ts 登记语言标识并明确浏览器匹配规则，在菜单添加语言自己的名称。
2. 从 en.json 创建完整语言资源，保持键和 ICU 参数一致；更新请求资源加载及 system-messages.ts 的资源选择。
3. 更新后端支持语言集合和 AI 输出语言名称映射，不改变业务代码、数据库状态值或 URL。
4. 添加日期控件 locale，检查国家显示、字体、长文案和无障碍标签。
5. 将新语言加入国际化测试的语言列表，完成母语审校和交互验收后开放。

## 验证

在 frontend 目录运行 `pnpm check:i18n`：检查语言匹配、消息键一致性、ICU 格式、前端引用和后端错误码。运行 `node --test tests/*.test.cjs`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm build` 完成前端回归。

后端运行 `python -m unittest discover -s tests`，必须连接一次性测试数据库；覆盖请求语言隔离、缓存隔离、任务快照和初始化结构。模型调用测试使用模拟服务，不代表已验证每种真实模型的指令遵循能力。
