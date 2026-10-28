# 文件存储与工单附件

## 业务空间与目录

业务文件保存在持久化 STORAGE_DIR（默认 /app/data），不作为公开静态目录挂载。

```text
knowledge/                       # Markdown 知识库，允许子目录
storage/public/                  # 公共文件
storage/personal/<user-id>/       # 个人文件，含 `DeviceLogs` 目录
storage/tickets/<ticket-id>/      # 已提交的工单附件
storage/attachment-drafts/<user-id>/ # 尚未关联工单的附件草稿
recycle/<delete-id>/              # 公共空间回收站
upload-parts/<task-id>/           # 分片上传和发布恢复记录
attachment-transfers/            # 附件关联移动的恢复记录
temporary/                       # 兼容上传的暂存文件
thumbnails/                      # 按文件 ID 保存的鉴权缩略图
```

系统运行日志使用独立 LOG_DIR，只有 developer 可查看，不计入文件总池。普通存储文件不会触发 AI 索引；知识库仅接受 UTF-8 Markdown，所有已登录成员可浏览和管理，全部知识内容可供 AI 检索。索引失败仍保留正文，可扫描重试。

## 容量与文件空间权限

- 总池默认 100 GiB，包含公共文件、个人文件、工单附件、附件草稿、缩略图和公共回收站；知识库独立统计。
- 每人默认最多 5 GiB，只统计个人空间及其缩略图、待清理文件和个人上传预留。工单附件及附件上传预留不占个人容量。
- 上限不代表预分配物理磁盘；空闲个人配额可以被公共内容使用。总池或实际磁盘容量不足时阻止新增占用。默认保留 256 MiB 磁盘余量。
- developer 可以调整总池、默认个人上限、单人覆盖值及各类上传限制，不能借此读取或管理他人个人空间。
- 公共文件所有成员可重命名、移动、复制、删除。公共文件不能移动到个人空间，只能复制。
- 仅公共空间设回收站。删除后仍计入总池；仅 developer 可恢复或永久清除。个人文件删除为永久删除。
- 恢复重建原父目录；被同名文件阻挡时提示处理。文件重名采用括号数字保留两者，不覆盖现有文件。
- 个人文件可向系统成员共享浏览和下载权限，文件夹授权向下继承。共享不重复计费；复制副本重新计费。
- 配额预留和文件变更通过 PostgreSQL 事务级 advisory lock 跨进程协调，避免并发超配。

## 不可修改的工单附件

附件只能在新建或编辑工单时上传、从个人空间复制和删除。上传、删除权限复用现有工单编辑规则：developer、leader、最后编辑者、当前被分配者。评论接口不接受附件参数。

保存工单时，upload_ids 与 delete_attachment_ids 在同一次版本检查和数据库事务中处理。编辑时先标记待删除，保存后才永久清理文件；取消编辑保留原附件。附件不提供内容编辑、重命名、移动、共享或复制到个人空间等操作。删除后需要重新上传新文件。

附件关联工单，保留创建人和上传时间。预览、下载、缩略图统一检查工单查看权限，不额外设置评论级附件权限。当前所有有效登录成员可查看工单；工单页面和附件接口共用查看策略。

工单转交、关闭、重新打开，或上传者账号停用，不改变附件归属和占用，不自动清理。未关联的附件草稿仅上传者可访问，取消或 48 小时过期后清理。草稿及其上传预留同样仅占总池。

从个人空间添加到工单会生成独立副本：原文件占个人配额和总池，工单副本只占总池。原文件删除、改名、移动不影响工单附件。

“我的附件”是本人上传的正式工单附件查询视图，列出文件名、所属工单、大小、创建人和上传时间。支持按文件名或工单搜索、按上传时间倒序分页，只提供浏览、下载和打开所属工单，不产生第二份物理文件，不授予额外访问权限。附件删除后同步从视图消失。

附件永久删除不进回收站，原文件、缩略图和引用一起清理。删除工单时连同全部附件、相关上传任务和草稿一起处理。删除评论不影响工单附件。

复用 file_operations 保留最少审计：正式上传、单个附件删除、删除工单时一次批量附件清理事件。记录操作人及姓名快照、时间、工单 ID、文件名和大小。上传草稿和临时数据不产生业务附件审计；文件删除后仅保留操作元数据，不保留文件内容、缩略图或版本历史。

## 统一上传、图片与下载

文件中心、知识库、设备日志和工单附件共用上传任务与全局队列。切换应用内页面继续上传；关闭任务面板不会取消。刷新或关闭浏览器会中断传输，重新选择原文件并校验通过后续传。

默认普通文件、视频上限 2048 MiB，Markdown 10 MiB，设备日志和图片 20 MiB，普通工单附件 200 MiB。图片与视频分别套用对应类型上限；developer 可调整为 1–2048 MiB。旧 multipart 接口单次请求最多 50 MiB。

50 MiB 以内使用单个原始请求，大文件按 8 MiB 分片上传。任务在连续 48 小时无有效分片活动后过期。每片使用 SHA-256 校验，续传验证指纹和已上传前缀，合并时再次检查。完成请求幂等，响应丢失不会另建重复文件。

任务创建时预占配额，正式保存时转为实际占用；图片额外预留 512 KiB 缩略图预算。物理磁盘预算考虑分片和合并副本。取消、过期或清理完成后释放相应预留。

PNG、JPEG、GIF、WebP 校验真实格式与扩展名、尺寸及解码生成缩略图：单帧最多 4000 万像素，最长边 16384，动画累计最多 1.6 亿像素。列表使用最长边 480 的 WebP 缩略图，动画取首帧；原文件不变。SVG 不作为可信内联图片执行。

预览支持文本、Markdown、上述图片、PDF 和浏览器原生支持的视频；不做视频转码。文本预览最多 2 MB。原生下载通过 NextAuth 会话代理至后端鉴权接口，流式响应并支持 HEAD、单段 Range，不在前端 JavaScript 中缓存完整大文件。

## 设备日志

只有点击上传时才保存到本人空间下的 `DeviceLogs`，ADB 与串口通过文件名区分，计入本人配额和总池。历史日志仅本人可查看，developer 无跨用户特权。存储中的日志可正常移动、复制和共享，历史入口通过 storage_entry_id 跟随当前文件路径。

## 清理与异常恢复

后台每 60 秒处理过期上传、未关联附件、已提交删除任务及附件移动恢复记录，每小时核对磁盘和登记，启动时也核对。文件删除失败会保留 file_garbage 账本及容量占用，成功后才释放。孤儿临时文件、分片和无引用缩略图至少保留 48 小时再清理；普通上传任务历史约 7 天后清除，审计独立保留。

文件发布前保存恢复记录；附件关联前记录移动意图。进程中断后补齐已发布文件，或撤回未提交的附件移动。校验不一致时保留文件和恢复记录等待核查，不盲删。发现磁盘缺失只报告，不静默删除登记。目录访问时批量发现直接子项，查询、筛选和分页由数据库完成。

## 数据库初始化与部署

本版本按允许重置数据库的前提重新基线化。唯一初始化入口是 db/init.sql，当前表、外键、索引、约束和种子配置在一个事务中创建。历史 storage_upgrade.sql、uploads_upgrade.sql 和 migrate_storage 命令已移除，不提供旧评论附件与个人计费数据迁移。

部署前备份数据库、持久化文件、配置和密钥。准备空数据库后执行初始化脚本；不得直接对旧业务库运行。重置数据库时，同时归档或清理旧托管附件、分片、暂存与恢复记录目录，避免新库重新使用已失去归属的旧文件。普通资料应通过文件界面重新导入，不应将旧托管附件直接丢入新目录。

后端持久化挂载 STORAGE_DIR，确保生产 UID 10001 可写。数据库、storage 和运行日志应共同备份；只恢复数据库不能找回正文。

## 当前范围

存储空间桌面端使用可调整宽度的导航分栏；窄屏通过底部面板切换五个空间。容量使用 Item 与 Progress，收窄后以 Context 的百分比与浮层形式展示，触屏使用可点击的 Popover。路径栏始终显示根目录并预留固定高度，列表加载使用 Skeleton。

文件表格默认按名称升序、文件夹优先，名称、大小与时间标题可切换升降序。普通目录与附件在服务端排序后分页；共享入口和回收站在完整结果中排序后分页。附件时间列表示上传时间，回收站时间列表示删除时间。拖动列边界或聚焦后使用左右方向键调整相邻列宽，双击边界恢复默认比例；普通文件与附件分别保存本次页面会话的列宽。

采用单服务器和单持久化文件系统，不引入对象存储或内容去重。应用配额无法约束有服务器文件系统写权限的运维人员。上传和附件关联具有恢复记录；其他文件操作不保证跨数据库、文件系统的断电级原子事务，仍需备份。暂不支持外部分享、文件内容版本恢复、视频转码、文件夹压缩下载和自动清空公共回收站。

## Terminal command files

Terminal catalogs are ordinary JSON files. Copying a file to an existing filename offers Replace, Keep both, or Skip. Replace retains the destination file ID and sharing permissions; Keep both uses the existing numbered-name rule. Folder conflicts support Keep both or Skip. JSON and shell files can be edited as text in the file preview. Only the exact default catalog paths in the selected personal/public space are loaded by the terminal; see [device tools](device-tools.md#command-files).

Text content reads return a SHA-256 revision. Content edits require that revision and return 409 on stale saves, including edits made from the terminal. The file editor retains the draft on conflict and allows explicit loading/comparison of the latest content before saving again. This applies to ordinary editable files rather than adding special command-file permissions.
