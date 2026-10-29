# 设备终端与设备控制台

设备通信由当前浏览器负责，无本机助手。通过 HTTPS（开发环境可用 localhost / 127.0.0.1）的 Chrome / Edge 访问，并授权 USB、串口和视频采集。服务器仅处理账号、快捷命令持久化和用户主动上传的日志；视频、截图及录像不上传服务器。

## 设备终端 `/terminal`

- USB ADB：启用机顶盒 USB 调试并允许设备上的授权提示；持续交互 Shell、ANSI 终端、Ctrl+C、Logcat。一次选择设备后，握手期间遇到旧会话的 WRTE / OKAY / CLSE 包或响应超时，关闭 USB 句柄以取消旧读取，再打开同一设备重新握手，最多尝试 3 次。初始响应及签名响应分别等待 10 秒，设备授权等待 60 秒；授权失败、未知包或 USB 读写失败直接报告原因，不反复弹授权。最终诊断包含握手阶段、包类型与参数，不记录令牌或私钥。手动断开会取消后续尝试；本次不包含运行中的 ADB 自动重连。
- 串口：日志串口默认 921600、8 数据位、1 停止位、无校验、无 RTS/CTS 硬件流控，与本次提供的 SecureCRT COM3 会话的波特率及帧格式对齐；遥控串口仍为 9600。支持自定义波特率、直接输入、文本快捷发送、换行符设置和 HEX 收发。接收可选择 UTF-8 或 GB18030 / GBK，发送可独立选择 UTF-8 或 GBK；GBK 无法表示的字符会报错，整次输入不发送，二进制 HEX 不受编码影响。ADB 始终使用 UTF-8。
- 乱码排查：先退出 SecureCRT 释放串口，选择相同设备端口并核对波特率及帧格式。波特率不一致会同时造成收发异常，切换字符编码无法修复。仅中文乱码时再核对接收编码；HEX 可查看二进制数据。接收解码出现替代字符时会显示诊断提示。
- 读取帧错误、校验错误、缓冲区溢出或 Break 时保留端口并恢复 reader，提示部分数据可能丢失，收到正常文本后清除提示。目标设备断电而适配器仍供电时，允许启动期间短暂异常后继续打印。端口真正消失或读取流结束时显示“等待设备恢复”，保留历史、参数和所选端口，以 0.5、1、2、4、5 秒（后续保持 5 秒）间隔尝试重新打开原端口，不弹选择框，也不按相同 VID/PID 猜测另一端口。手动断开立即取消等待，进行中的打开操作会在结束后清理。恢复期间禁止发送，离线前排队但尚未发送的命令会拒绝，不在恢复后补发；恢复后清除旧连接错误。刷新或关闭页面后不继续恢复。
- 串口读写缓冲区为 64 KiB。浏览器 Web Serial 仅提供 none / hardware 流控选项，当前未实现 SecureCRT 导出中开启的 XON/XOFF 软件流控，不能声称完整复刻该会话。若波特率对齐后仍有输出暂停，应继续核对软件流控要求。
- `.sh`：通过 USB ADB 上传 UTF-8 脚本（最大 1 MiB），统一 LF 换行，在 `/data/local/tmp` 生成唯一文件，再由持续 Shell 执行 `sh`。正常结束后删除临时文件；设备掉线或脚本执行 `exit` 时可能需要手动清理。
- 快捷命令：搜索名称、内容与分组，编辑、多行内容、置顶、执行前确认。终端通过“我的空间 / 公共空间”切换读取固定路径的默认 JSON；个人命令可自行编辑，公共命令仅 developer 可在终端编辑，所有成员仍可在文件空间管理原文件。点击刷新重新载入。置顶顺序按账号和连接方式保存在当前浏览器。
- 不包含网络 ADB、VBS 或 SecureCRT API 兼容层。
- 上传日志与历史日志：与设备控制台复用统一上传按钮、全局上传任务、进度 Toast 和 Data Table 浮动历史窗口。点击上传时读取当前输出快照，立即上传；ADB 与串口分别归类、独立进度和取消，终端与控制台的串口共用同一上传任务。上传期间重复点击仅重新显示进度，切页不重复上传。历史列表混合展示当前用户个人空间 `DeviceLogs` 内的全部文件，按服务端上传时间倒序分页、搜索，支持独立原文预览、复制和下载；离开页面会关闭历史窗口并取消过期查询。

## 设备控制台 `/device-console`

- HDMI 转 USB 采集卡：连接后选择具体视频输入，可截图 PNG、录制带时间水印的 WebM，不采集音频。停止录像时下载；录像暂存在浏览器内存中。
- 遥控器：独立串口，默认 9600 波特率。保留原工具的 `FA F1 08 F7` 指令前缀及十个已知按键码。使用 CSS 外壳和布局、原生 HTML 按钮、Lucide 内联 SVG 简单图标；保留原 SVG 的按键轮廓与坐标以及 326×1080 完整外壳，上下预留 16px、两侧各 24px 的阴影空间，减弱外壳投影；完整保留上下圆角，移除所有底部波浪遮罩，移除重复方向外圈及音量／频道／TV 辅助外圈。顶部两键统一为 50×50，其余普通圆键统一为 64×64，并校准左右对称与间距；方向键保留独立命中区域。音量和频道分别为一体长椭圆，上下半区独立响应，不再包含中间的扬声器或 P 图标。外壳取消硬描边，以渐变和柔和阴影塑形，按键保留悬停反馈。桌面布局使用 shadcn Base Resizable 分栏，可拖动分隔条或使用方向键调整宽度。遥控器优先适应工具栏下的屏幕可用高度，分栏过窄时等比缩小，图标和文字随宽度同步缩放；桌面本体最小宽度为 160px，含阴影留白的分栏最小宽度为 216px；手机本体宽度限制为 140–200px，图标和文字同比缩放，可用普通按键的透明命中区域至少为 40px。音量上下半键仅扩展横向命中范围，避免纵向重叠。空间充足时完整显示外壳并上下居中；高度不足时仅在遥控器内部使用 shadcn Base ScrollArea 滚动，由视口自然裁切。滚动到顶时电源键完整可见，滚动到底时完整显示下轮廓。整个控制台页面恢复浏览器默认滚动条；左侧视频保持 16:9，在可用区域内居中完整显示。窄屏改为上下分栏。底部红、蓝、黄、绿四色键使用原图两行两列胶囊形状和间距，灰化禁用。已实现按键支持鼠标、触屏、Tab 聚焦及 Enter／空格操作，未连接时仍可点按已实现按键，闪黄灯提醒且不写入串口；其余按键保持禁用、不生成串口指令。旧 GTV SVG 素材已移除。
- 指示灯与按键：鼠标、触屏、Enter／空格在按下时发送，松开不额外发送；仅方向与音量键支持长按，首条完成后延迟 450ms 开始重复，后续每条写入完成后间隔 180ms。红灯在串口写入队列实际开始写入时闪亮 110ms，每条指令单独反馈；未连接或发送失败时黄灯每 160ms 闪一次，共三次。慢串口不积压重复指令；松开、移出按键、失焦、切页、取消指针或断开均停止重复。
- 工具栏：只保留一个“串口设置”Popover 入口，内部使用遥控／日志两个 Tabs 标签页。状态、参数、选择串口及连接／断开均收纳在内；保持内容挂载，切换标签页或关闭重开弹窗不会丢失尚未连接的参数。
- 视频占位：未连接采集卡时居中显示跳舞 GIF；宽度随视频区域缩放，最大 180px，且不超过视频高度的 55%。
- 布局：宽屏外层为左右 Resizable，右侧遥控器独占完整高度；左侧视频与日志使用同宽的上下分栏，默认约 70% / 30%。手机改为一个平铺的纵向分栏组，依次为视频、遥控器、日志，两个分隔条各自调整相邻区域；视频区域最大高度按当前内容宽度的 16:9 高度加上下各 8px 内边距计算，窄屏缩放时动态更新。分隔条采用官方 1px 实线结构，交点贴合，保留 12px 的透明拖动命中范围；移除工作区外围边框，视频与日志区域均预留 8px 内容边距，遥控器内部上下 16px、左右 24px 以容纳阴影。保留各区域最小尺寸，终端按实际内容区域重新计算行列；切换响应式结构时重新绑定现有视频流，无需再次授权采集。日志区不显示标题横条，清空、保存、上传与管理按钮直接悬浮覆盖在打印区域右上角，使用主题内不透明底色和实色边框，避免透明叠加发虚；布局变化时按物理像素对齐按钮位置，文本可从下方穿过。遥控器无内部溢出或到达边缘时按浏览器默认行为滚动页面。
- 日志串口：与设备终端的串口是同一会话、同一读取循环；输入发给同一设备，输出广播给两处终端。
- 日志上传：点击上传图标立即上传当时的日志快照，不再展开备注表单。Toast 显示真实传输进度与取消按钮，传输完成后等待服务器保存；关闭 Toast 不会取消上传。提示仍可见时，成功、失败或取消结果更新同一条提示；已关闭时则新增结果提示。上传中再次点击图标仅重新显示进度，避免重复提交；切换页面仍继续上传。
- 历史日志：工具栏入口打开可拖动、缩放和最大化的浮动窗口，使用 Data Table，固定按上传时间倒序，提供文件名搜索与分页，不提供排序切换。每行最右侧可预览、下载；预览另开窗口，使用 shadcn Code Block 显示原始文本，支持复制和下载。日志只允许本人查看，developer 也无跨用户读取权限。
- 继电器地址可设置，默认 `192.168.111.211`，保存在当前浏览器。沿用 `/ecmd?pin+set+kN+on/off`：k1 电源、k2 Link（Reset 外挂触点）、k3 Recovery。显式接通、断开，避免用本地状态猜测继电器状态。
- 旧继电器接口缺少跨域响应支持，使用浏览器 `no-cors` 请求；请求返回也不代表硬件确认成功。HTTPS 混合内容、局域网权限或设备协议限制可能阻止访问，页面显示失败提示。无需也不应关闭浏览器安全保护；纯浏览器方案不能保证所有旧 HTTP 继电器均可连接。

## 终端显示、搜索与持续日志

- 设备终端与控制台日志区共用显示偏好：字号 10–28px、Consolas / Courier New / 系统等宽字体（均带中文字体回退）、行间距、深浅主题和各自的 ANSI 配色、光标样式。设置保存在当前浏览器，立即作用于两处终端，不会断开设备。终端内部 Ctrl/⌘ 加减号调整字号，Ctrl/⌘+0 恢复默认字号。输入法组合期间不拦截这些快捷键。
- 可选 ERROR / FATAL / WARN / WARNING 关键词下划线标记，不覆盖设备的 ANSI 前景色。仅扫描当前可见行并限制标记数；不修改原始输出或文件日志。
- 搜索当前终端回滚内容（最多 10,000 行），支持大小写、正则、前后匹配定位，最多装饰 1,000 个匹配。Ctrl/⌘+F 打开，Enter 下一个，Shift+Enter 上一个，Esc 关闭。上翻历史或点击暂停后不跟随打印；接收与记录保持进行，点击“回到底部”恢复跟随。
- 输出合并后每次最多向 xterm 写入 32 Ki 字符，等待解析完成再继续，避免无界渲染队列；显示积压超过约 500,000 字符时重绘最近输出并提示，独立记录队列仍接收完整的新输出。窗口尺寸变化合并到动画帧，设置变化不重建连接。
- 持续记录只能由用户手动点击“选择文件夹并开始记录”，连接、刷新或恢复缓存均不会自动开始下一次记录。只记录开始之后的设备输出，清屏只影响显示；没有新输出时停止不会创建空日志文件。两处页面共享同一串口记录器，切页继续，串口短暂恢复期间继续同一记录，手动断开时停止并完成保存。
- 本地日志统一 UTF-8，默认去掉 ANSI 控制序列，可选保留；纯文本可选逐行 UTC 接收时间戳，按逻辑换行添加，设备自带时间戳保留。文件以连接方式、开始时间、随机会话 ID 和序号命名，按 4 / 16 / 64 MiB 在批次之间分文件（单批次可使大小略超阈值）。不自动上传服务器。
- 浏览器约每 250ms 将未提交数据写入 IndexedDB 缓存，每 2 秒将批次追加到本地文件并关闭写入流提交，界面分别显示已接收和已提交字节数、时长、文件名。正常停止会提交尾部并删除该记录的缓存。突然关页、崩溃、系统故障或缓存被浏览器清理仍可能丢失最近数据，不能保证零丢失，也不能关闭页面后继续采集设备。
- 文件或缓存写入失败会停止记录并显示失败状态；可更换目录保存未提交数据，或下载内存中未提交的数据。保存队列设置上限，超限明确停止，之后输出仍可看终端，但不会假装继续记录。下一次打开持续记录菜单可手动恢复上次缓存。恢复到原目录会先比较已提交字节，避免文件提交成功但缓存进度未更新导致的重复；恢复到其他目录生成独立 recovered 文件。使用浏览器锁避免恢复另一标签页仍在记录的缓存。
- 真实硬件验收仍需覆盖中文输入法候选、退格、中英文混排、设备 ANSI 色彩、长时间高速输出、重复断电重启、后台标签页及休眠恢复。后台定时器可能被节流，缓存和文件提交间隔不是硬实时保证。

## 命名配置、粘贴、PTY 与诊断

- “会话配置”按 ADB / 串口分别保存最多 50 份命名配置，存放在当前浏览器。包含串口参数、接收与发送编码、换行、粘贴间隔、显示偏好和持续日志规则。可新增、更新、载入及确认删除；载入须先断开连接并选择对应连接方式，不保存 USB / 串口授权对象、认证凭据或自动记录开关，仍由用户手动选择设备、手动开始记录。ADB 配置只接受 UTF-8。刷新后配置列表保留，但不会自动连接、载入或开始记录。
- 多行、含控制字符或超过 128 字符的终端粘贴会被拦截为预览，也可从终端内“粘贴预览”按钮手动输入。确认前不发送；最多 65,536 个 UTF-16 字符、2,000 行，可选择 CR / LF / CRLF 和 0–5,000ms 的行／长行分段间隔（默认 50ms）。每段最多 256 字符，不拆开代理对或 CRLF，始终等待上一段完成后再发送。发送前验证完整文本的编码；控制字符只允许 Tab、CR、LF。默认不补末尾 Enter。
- 支持应用启用的括号粘贴模式；只有用户明确勾选时，才在括号粘贴结束后发送 Enter。发送期间阻止其他普通输入交叉，支持取消未发送内容及 Ctrl+C；已发送内容无法撤回。断开、重新连接、读取恢复等会使旧预览失效并取消未完成粘贴，恢复后不重放；取消时若仍是同一连接，会结束已开始的括号粘贴。粘贴预览只在内存中保留，不进入命名配置或诊断导出。
- ADB 握手声明 Shell v2 支持并读取设备 CNXN 的功能列表。支持的设备使用 `shell,v2,pty,TERM=xterm-256color:`，解析可跨 ADB 数据包的 stdout / stderr / exit 帧，标准输入与窗口控制使用不同帧类型。初次连接及终端尺寸变化后发送行列数，变化合并 100ms，用户调整字号、分栏或打开搜索也会同步。实现依据 [Android Shell 服务](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/services.md) 和 [窗口尺寸控制消息](https://android.googlesource.com/platform/system/core/+/9e9efca/adb/shell_service.cpp)。
- 未声明 Shell v2 的设备使用旧 `shell:`；明确拒绝 PTY 服务时仅回退一次，超时或其他错误不盲目回退。旧 Shell 在诊断中标明不支持窗口尺寸同步，不向标准输入注入 `stty` 命令。ADB 写入失败或 ACK 超时后关闭该交互流，防止迟到 ACK 确认后续写入。`top`、`vi` 的可用性仍取决于设备自身工具及终端支持，需硬件复测。
- “诊断与备注”显示当前会话时长、接收／完成发送的载荷字节数、读取恢复、重新连接、握手重试、行列与协议。自动恢复沿用计数，手动新连接重新计数；手动断开或错误后时长停止。导出 JSON 只包含参数、计数和最近 100 条状态事件，不包含命令、设备输出、备注正文或认证密钥；计数不包含 USB/ADB 帧开销和独立 Logcat 通道，写入中断时不代表物理线上已传输的全部字节。
- 可手动添加 1–200 字符的日志备注，附 UTC 时间，单独展示最近 100 条。备注不插入终端画面、不写入设备，也不影响命令行光标；持续记录中会写入日志的独立 `[FAE NOTE ...]` 行。未记录时只保留在当前页面会话，不创建文件。

## 生命周期与数据库

应用布局持有终端与控制台组件，内部导航不会断开设备或停止录像。刷新、关闭标签页、退出登录后不保证恢复；不同标签页不共享会话。内存输出保留最近约 500,000 字符，终端回滚保留 10,000 行。设备终端与控制台上传均以点击上传时的当前输出快照为准，与本地持续记录文件独立。服务端历史日志只允许本人访问；统一历史列表监听 ADB 与串口两种上传任务，任一上传完成后刷新。

快捷命令使用当前选中空间的 `Commands/ADB/adb_cmd_default.json`、`Commands/Serial/serial_cmd_default.json`，不再使用独立命令表。个人空间仅本人可读取；其他文件名均不读取。文件空间升级为 `uploaded_logs` 新增文件关联，并使用统一存储表；本版本统一使用 `db/init.sql` 初始化空库，不再提供历史升级脚本。设备日志只允许本人查看，developer 不再具有跨用户读取权限。详情见 [文件空间](file-storage.md)。旧 `/adb`、`/serial` 地址重定向至 `/terminal`。

## 验证

前端运行 `pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build`。模拟测试覆盖 ADB 校验和、快速响应竞争、写入 ACK、共享串口读取与断开、UTF-8 分块及脚本上传。真实硬件需验证首次/再次 USB 授权、拔插、串口共享、HEX、Ctrl+C、采集卡断流、录像下载及三路继电器。

## Command files

System paths use English: `Commands/ADB`, `Commands/Serial`, and `Commands/Scripts` (reserved for stored shell scripts; no new execution engine).
The terminal switches between My space (the current user only) and Public space, reading only the exact default filenames in the selected space. Missing files show an empty list; invalid JSON shows an error and cannot be overwritten from the terminal. Updates are loaded only on opening the panel or clicking Refresh. Terminal saves use content revisions to reject stale overwrites.

```json
{
  "version": 1,
  "transport": "adb",
  "commands": [
    {
      "id": "a49f2f54-ff7c-44de-a65e-f3b1f9edd9e5",
      "name": "Device model",
      "command": "getprop ro.product.model",
      "group": "General",
      "confirmBeforeRun": false
    }
  ]
}
```

IDs must be unique UUIDs; names and command text may repeat. Serial catalogs use `"transport": "serial"`. Files must be UTF-8 and at most 2 MB. Form editing maintains this format. Pinning uses IDs stored in the current browser.

Command editing locks other edit/delete/new actions, space switching, and transport switching until save/cancel. A browser-close warning protects active drafts. On a save conflict, reload explicitly while retaining the draft; if the same command changed or was deleted, review the latest version and choose the draft, the latest version, or save a deleted command as new. Other users' unrelated commands remain intact. Saving a new file cleans up published content if its database commit fails.

Command parsers reject unknown fields and non-boolean confirmation flags. Invalid files report their path and field location (or JSON line/column). The form enforces name/group/content limits and distinguishes missing files, empty catalogs and empty search results. Successful saves/deletes provide status feedback.

New-command drafts receive a stable ID on creation. If a save response is lost, explicitly reload to reconcile that ID with the latest file before retrying. Command fields are shared directly between the form and JSON, and file paths come from the backend.

Fresh deployments initialize an empty database with `db/init.sql`; no legacy command migration tools are provided. Default command JSON files are created when the first command is saved in each space.

日志上传路径统一为个人空间 `DeviceLogs/adb` 与 `DeviceLogs/serial`。上传和手动保存采用 `adb_20261029_143508_a1b2.log` / `serial_20261029_143508_c3d4.log` 格式，时间取浏览器本地日期与时分秒，随机四位十六进制后缀用于区分同秒操作。上传接口校验并保留客户端文件名，旧客户端按其时区偏移（默认 UTC+8）兼容命名；服务端上传时间仍以 UTC 存储并用于历史排序。持续记录以开始记录时的本地时间命名，分卷依次为 `_001.log`、`_002.log`；恢复文件保留原始开始时间并生成新随机后缀，遇到同名文件不会覆盖。仅手动开始持续记录，不自动生成日志文件；不迁移已删除的旧日志。
