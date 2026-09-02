# PROGRESS — SEU Summary

> 断点续跑台账：新会话先读本文件和 docs/plans/ROADMAP.md，不重做已完成内容。

## 当前状态

- **已完成阶段**：Phase 0-7 全部完成；U1-U5 全部完成；**v0.2.0 已发布**（tag + GitHub Release 资产在线）
- **进行中**：登录窗口因本机第二渲染器环境故障不可用（见失败与卡点），**但已用「主窗口登录 + 会话收割注入」完整绕过（2026-09-02 晚实测全链打通）**：用户在主窗口内完成 SSO 登录 → CDP 收割 cookie+JWT → safeStorage 重封写入 session.bin → 应用 logged_in → 刷新课程拉回 500 门真实课程 → parser 字段精修（c80d82f：subjName/teacNames/acye*，此前 name 候选全未命中致课程名空白）→ 课程树正确渲染课程名+学期。**当前应用可用**（会话有效期内）；过期后需重走主窗口登录流程（尚未产品化，见下一步②）
- **下一步**：**执行 `docs/plans/2026-09-02-v021-stabilization.md`（v0.2.1 稳定化与发布计划）**——V1 课时详情换源（video.src 直链方案，侦察已完毕）→ V2 登录流程产品化（主窗口内嵌）→ V3 环境故障根因（用户配合：重启/Defender 排除/退输入法）→ V4 MVP 验收与发布。按计划内任务清单逐项勾销，每阶段更新本台账

## 环境实测（2026-08-30）

- node v24.15.0 / npm 11.12.1 / git 2.53.0.windows.1 / gh 2.89.0（已登录 Andiii208，scopes 含 repo+workflow）
- 本会话 bash 是 cygwin 风格且 PATH 无 Unix 工具：需要时用 `export PATH="/cygdrive/e/Git/usr/bin:$PATH"`，或 `cmd //c`、node 单行脚本替代
- 本会话里 `npm`/`npx` 裸命令会报 "cannot execute"，必须用 `npm.cmd`/`npx.cmd`
- git 仓库级身份已配置：Andiii208 / Andiii208@users.noreply.github.com（全局未配置）

## 阶段记录

| 阶段 | 状态 | 验收结果 | 备注 |
|---|---|---|---|
| Phase 0 | ✅ 完成 | 四门禁 0 退出；CI success（run 33324490350）；私密仓库已建并推送 | 提交 96cbe56、a18f2c6 |
| Phase 1 | ✅ 完成 | 15/15 测试过（迁移/幂等/外键/CHECK）；better-sqlite3 在 Node+Electron 双 ABI 验证可用 | 提交 082b9eb |
| Phase 2 | ✅ 完成 | 37/37 测试过；会话 DPAPI 加密存储、API 客户端错误分类、过期检测三通道 | 提交 2c12993 |
| Phase 3 | ✅ 完成 | 46/46 测试过；失败注入→重试不重复已完成阶段；24h 清理反向验证 | 提交 373ee52 |
| Phase 4 | ✅ 完成 | 62/62 测试过；真实 ffmpeg 音频/关键帧验证；全景流禁下守卫；下载重试 20 次 | 提交 e73a777 |
| Phase 5 | ✅ 完成 | 80/80 测试过；DPAPI 加密 key 字节级验证；能力独立绑定；三类错误分类 | 提交 c5da012 |
| Phase 6 | ✅ 完成 | 96/96 测试过；四视图同源 JSON；追问课时边界；Markdown 导出 | 提交 7d3947e |
| Phase 7 | ✅ 完成 | NSIS 安装包 257.6MB 构建成功（含 ffmpeg）；MVP.md 逐条验收（6 项✅自动化，5 项⚠️待人工） | 提交 7d220af |
| UI 组装 | ✅ 完成 | IPC 16 通道+AppContext+三栏主界面+真实 Electron 烟测通过；修复 gitignore 吞掉 src/main/library 的 CI 失败（7204093 CI success） | 提交 72be62f、7837368、7204093 |
| 增强 | ✅ 完成 | 手动课程/课时 ID 后备入口（spec §2，幂等落库）+ Provider 设置界面（保存并绑定三能力，Key 仅存内存后加密落库）；114/114 测试 | 提交 bf952de |
| 发布事故修复 | ✅ 完成 | v0.1.1 重发：asar 含完整 UI（旧脚手架残留=0）、6 层尺寸图标、桌面/开始菜单快捷方式；release 已上线 | 提交 dfb0af9、tag v0.1.1 |
| U1 主流程修复 | ✅ 完成 | 四门禁绿（128/128 测试，新增 14 个）；真实 Electron 启动烟测通过（页面渲染无错误、toast 区存在）；U1 验收判据「登录→课程树→点课时→创建并运行→实时进度」已接线，真实 CAS/45 分钟端到端仍属人工验证 5 项 | 提交 318d49d（后端）、3356b06（前端） |
| U2 UI 重做 | ✅ 完成 | Preact 引入（preact/hooks、@preact/preset-vite、happy-dom）；组件化（App/Sidebar/TaskPanel/NoteViewer/QaPanel/Toast/EmptyState/ProviderPanel/WelcomeGuide/ManualAdd/TopBar/ProgressBar）；CSS 变量设计系统明暗双主题；CSP 收紧 connect-src 'none'；组件测试 25 个（≥10 达标）；四门禁绿 153/153；真实 Electron 烟测：4 页签+侧栏+引导卡+空态渲染正常无错误 | 提交 afc03a2 |
| U3 设置与下载位置 | ✅ 完成 | 004_settings 迁移（key-value）；IPC settings:get/setCacheDir/setTheme/chooseLibrary/openPath；资料库迁移（SQLite backup API 复制 db+attachments，迁移前备份+失败回滚+重启生效）；notes:exportMarkdown 走系统保存对话框；缓存目录可改即时生效（orchestrator/cache-clean 读设置）；设置页 UI（账号/Provider/位置/主题，主题覆盖明暗）；四门禁绿 169/169（新增 16 测试）；真实 Electron 烟测设置页渲染正常 | 提交 96e7b80 |
| U4 管线质量 | ✅ 完成 | ASR 按 10 分钟分片转写（ffmpeg -ss/-t 切片，拼接保留片偏移，分片进度事件）；多模态真发图（PPT/关键帧 base64 data URL，上限 20 张，unsupported_visual 回退纯文本）；ffmpeg 超时 30min+停滞检测 60s（输出无增长即 kill）+AbortSignal；downloadToFile Range 续传（206 续传/200 重来）；SerialTaskQueue 串行队列+runAsync 入队；单实例锁（二开聚焦主窗口）；tasks:cancel（AbortController+阶段边界 cancelled）；005 error_kind 迁移；缓存清理跳过运行中任务；UI 取消按钮；四门禁绿 187/187（U4 共 +18 测试）；启动烟测通过 | 提交 425a1ae、5c9f5e7、49d8423 |
| U5 基建与文档 | ✅ 完成 | logger（userData/logs 每日轮转 7 份、redact 脱敏 cookie/key/URL、渲染错误经 log:rendererError 入同一日志、设置页打开日志目录）；scripts/release.md 发布清单 + scripts/verify-asar.mjs sha256 抽验 + npm run verify:asar；版本号 0.2.0；README/CHANGELOG 与代码事实同步（28 IPC 通道、32 测试文件、187 用例）；+4 测试 191/191 | 提交 9fbeda5 |
| v0.2.0 发布 | ✅ 完成 | 四门禁绿 191/191；npm run dist 产出「SEU Summary Setup 0.2.0.exe」；asar 抽验通过（out/ 7 文件 sha256 与当前构建一致，tag 同提交构建）；verify-asar 脚本修复 @electron/asar 4.x Windows 路径解析问题（改按 header offset 直读）；tag v0.2.0 + GitHub Release 资产已上传 | 提交 e8ec4de、c22add0、tag v0.2.0 |
| CAS 登录白屏修复 | ✅ 完成 | 用户实测反馈：登录窗口白屏长时间无响应。根因=应用打开的 ids.seu.edu.cn 在用户网段 TCP 不可达（实测 80/443 全超时，而公网/cvs/auth 均可达）；叠加缺陷：失败不关窗/无日志/零反馈。修复：10s 预检 fail-fast、本地 loading 页、25s 首屏超时、ERR_ABORTED 不误判、失败关窗+日志。实测校园网内**登录链路全自动静默完成**（cvs→auth.seu.edu.cn OAuth2 prompt=NONE→跳回 cvs→收割会话→session=logged_in 落盘）。**修正认知：平台登录走 auth.seu.edu.cn 的 OAuth2/RBAC，不经过 ids**；ids 老入口保留为可选 casUrl 覆盖。+4 测试 195/195 | 提交 cas-fix |
| 课程接口校准 | ✅ 主体完成 | 已落地（提交 8dec927）：①SchoolClient 换真实 API base `https://cvs.seu.edu.cn/jy-application-resourcemanage`（API 前缀无 -ui，UI 静态资源才有）；②请求带 `jwt-token` 头（getJwt 注入）；③登录窗口收割 JWT（sessionStorage 键 `jy-application-resourcemanage-ui_STORAGE_KEY_JWT_TOKEN`，appName=pathname 首段），SessionRecord 加 jwt 字段加密落盘；④listCourses 切真实端点 `/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=500`；⑤parser 容错 {code,result:{records|list|rows|data}} 包装 + courId/courName 字段候选。**待真实样本精修：t-1 课程字段名（用户 F12 提供）与课时/视频流接口（播放页 getList/lastPlayInfoById/m3u8）**。接口全景（自前端 bundle 逆向）记于上一次会话台账：/v1/course/verify?courId、/v1/vod/addVodWatchRecord、/v1/list/recentWatchRecord、/v1/config/vodNmediaConfigInfo、/v1/app/info、/resource/resources_tree_me(RBAC 菜单树) | 提交 8dec927 |
| 登录挂起诊断与探测修复 | ⏳ 进行中 | 提交 64a6fce/6f1b3eb/79cca90/e0f2d2a/47a9a46：①登录后探测器探真实端点并带 jwt-token，字段结构记录升级为深度受限递归；②`--seu-trace-keep-window` 保留登录窗；③`--seu-direct-net`（no-proxy-server+disable-quic+disable-async-dns，SEU_DIRECT_NET=1 后备）A/B 开关；④会话探测旧 404 端点 → 真实 t-1 + jwt-token 头；⑤**首帧兜底**：22:49 现场复现三次登录全隐形挂死——本地 data: loading 页未完成、ready-to-show 未触发、25s 平台页预算从未建立（它在 loading 页 resolve 后才启动）、零错误零日志；预算改为建窗即启动覆盖 loading→平台首帧全程，net-trace 增 LOADING page ready/PLATFORM page loaded/FAIL 钉子；⑥渲染层：挂载只读本地树（原来挂载时 listCourses 过期会经 withSessionRetry 自动弹登录窗，用户视角=点了没反应，还叠出 3 个隐形窗）、session_expired 翻徽标为未登录、login() 防重入 + WelcomeGuide busy 禁用。四门禁绿 207/207 | 提交 64a6fce、6f1b3eb、79cca90、e0f2d2a、47a9a46 |
| 组合层体检与质量清理（2026-09-02） | ✅ 完成 | 用户判据「测试全绿 ≠ 组装可用」驱动的全面体检：**L1 CDP 进程级烟测 19/19**（`npm run smoke`：桥面完整性对齐 bridge.ts、IPC 无副作用通道全探活含 3 条错误路径、隔离 userData/资料库下启动组装、首渲染、日志落盘；seam=SEU_SMOKE_USER_DATA+SEU_SUMMARY_DOCS_OVERRIDE）；**L2 SchoolClient 真实 fetch 集成 6/6**（本地 http 服务器全错误分类；证伪 opaqueredirect 疑虑——undici manual 返回可读 302）；**L3 六阶段端到端 1/1**（真实 ffmpeg 合成媒体 + 三合一 mock 服务器，进度序列/产物落库/音频清理/全景零请求全断言）；**发现即修**：probeSaysLoggedIn 收紧到平台信封字段、死 StageOutputStore 层删除（恒假 fast-path + no-op 桩）、死桥 3 通道与死导出 9 处清理、qa.history 接线（追问历史跨会话回显）、gridDecoder 提取补测、@types/mocha 与 vitest 弃用告警清除、migrate 冗余备份删除；**现场取证**：系统代理翻案（见当前状态）。文档对齐 README/MVP/spec。测试 207→221（38 文件） | 提交 408ad93…20df514；报告 docs/health/2026-09-02-combined-audit.md |

## 遗留（诚实清单）

- **UI 主界面组装 ✅ 已完成**（提交 72be62f/7837368，2026-08-30）：AppContext（资料库+会话+Provider+媒体路径组装）、IPC API surface（school/providers/tasks/notes/qa 共 16 通道）、preload 桥接（SeuSummaryBridge 类型化）、renderer 三栏主界面（课程列表/任务面板/四视图笔记+追问）。真实 Electron 启动烟测通过：7 秒运行日志干净、资料库三目录+app.db 正常建立、renderer 标题正确。112/112 测试绿。
- **需人工验证的 5 项**：见 docs/acceptance/MVP.md（干净机器安装、真实 CAS 登录、真实课程拉取、45 分钟端到端、过期重登恢复）。
- **待确认删除项**：无（构建产物 release/ 已 ignore，未入库）。

## 失败与卡点

- **Chromium 第二渲染器环境级故障（2026-09-02 晚定论，与代理无关）**：与用户实时联测定论——**本机 Electron 的第二个渲染器永远不加载**：登录窗无论 data:/http(s)/file:// 的 loadURL 都只 NAV start 不 commit；`window.open` 返回窗口对象但 target title 永空；CDP `Target.createTarget` 调用本身挂死；而主窗口（第一个渲染器）的 file:// 加载完美（烟测 19/19 全绿即单窗口验证）。已排除：代理（用户退出 Clash Mi 且 ProxyEnable=0）、session 分区（defaultSession 同挂）、沙箱（--no-sandbox 同挂）、scheme（file:// 同挂）、GPU/遮挡计算（--disable-gpu + CalculateNativeWinOcclusion 关闭同挂）。同期环境异常：better-sqlite3 从 node_modules 无声消失（疑似安全组件隔离，重装恢复）。**应用侧已做防御**（001e6c4）：loading 页改 file:// 临时文档 + renderer 侧跳平台、首帧预算/探针移入 did-navigate——环境修好后登录链路即用最可靠路径。**根因三嫌疑**（按可能性）：①安全组件注入（Windows Defender 实时防护开着；试加排除目录）；②Windows build 26200（Insider 级超新 build）× Electron 44/Chromium 152 兼容 bug；③虚拟显示驱动/输入法 hook（百度输入法在跑、用户用远程工具）。**下一步（用户操作）**：①重启电脑后直接点登录重试（清 hook 态，零成本分界实验）；②无效则 Windows 安全中心→病毒和威胁防护→排除项加 `E:\SEU summary` 与安装目录，再试；③再无效则临时退出百度输入法/远程工具逐个排查；④修复版体验：loading 页有 spinner + 25s 必有超时报错（不再无声白屏）

- **v0.1.0 发布事故（已修复，2026-08-31）**：tag 打在最新提交但发布资产是 Phase 7 时点的旧构建（asar 含脚手架页，无 UI/Provider 代码），且无应用图标、oneClick 静默安装无桌面快捷方式。根因：打包（7d220af）之后又提交了 UI 组装/Provider 等功能但从未重新 `npm run dist`，而发布时未校验资产与 tag 一致。教训已记入 CHANGELOG 0.1.1：**发布资产必须在打 tag 的同一提交上构建，发布前用 @electron/asar 抽验包内产物**。

## 关键决定记录

- **U1 重试统一走 runAsync（2026-08-31）**：后端 `tasks:runAsync` 的 `firstStageFor(state, failed_stage)` 对 failed 任务自动从失败阶段恢复，语义等同 retryTask；前端「重试」不再调阻塞式 `tasks:retry`，统一非阻塞路径，避免 UI 冻结。更简单方案，符合计划「选更简单方案」约定。
- **U2 组件测试环境分治（2026-08-31）**：vitest 默认环境保留 `node`（main 层测试用真实 fetch/better-sqlite3），仅 `tests/components/**` 用 `happy-dom`——否则 happy-dom 的 CORS fetch 会弄挂 downloadToFile 测试。交互用 `preact/test-utils` 的 act 包裹以 flush 异步批处理。
- **U2 Provider 管理暂留「设置」页签（2026-08-31）**：计划 U2 主区页签为 任务/笔记/追问，但 Provider 表单必须保留且 U3 才做完整设置页，故先以第四个页签「设置」承载 ProviderPanel，U3 增量扩展资料库/缓存/主题。
- **U3 资料库迁移后重启生效（2026-09-01）**：计划任务 2「设置变更后即时生效」针对 cacheDir（orchestrator 每次读设置，已即时生效）；资料库迁移涉及重开 db 与 stageOutputs 等运行时单例，热切换复杂易错，选「迁移完成写 settings.libraryRoot + 提示重启」更简单可靠（计划未强制迁移即时生效）。
- **U3 缓存目录用文本输入而非对话框（2026-09-01）**：cacheDir 变更走输入框+保存（后端校验可写），比多一个 chooseCacheDir 对话框通道更简单；资料库位置必须走目录选择对话框（用户选空目录），两者分工与计划一致。
- **U4 ASR 分片取固定 10 分钟边界而非静音对齐（2026-09-01）**：计划允许二选一；静音对齐需额外 ffmpeg silencedetect 解析+切点回退逻辑，固定边界更简单可靠，截断只影响段边界一句话（记录取舍）。分片拼接以片起始时间为段 at（provider 不返回时间戳），整段音频转写成功后删除。
- **U4 重试统一走 runAsync + 串行队列（2026-09-01）**：runAsync 在 main 侧 SerialTaskQueue 排队，同一时刻至多 1 个任务；tasks:cancel 对未运行任务直接标记 failed(cancelled)，运行中经 AbortController 在阶段边界取消并 kill ffmpeg。
- **session_expired 重登重试（2026-08-31）**：`school.login` 会打开 CAS 登录窗口（用户交互），故不做静默自动重登；invoke 通道用 `withSessionRetry`（shared/session-retry.ts，纯函数可测），任务运行中会话过期则在 toast 提示 + 登录按钮高亮，用户重登成功后手动重试历史任务。
- **挂载（mount）只读本地课程树，不自动刷新网络（2026-09-01）**：原实现挂载即 listCourses，过期会话会经 withSessionRetry 自动拉起登录窗，叠加首帧挂起后用户视角是「点了没反应」；改为挂载只调本地 courseTree，网络刷新留在显式「刷新课程」按钮后（spec §2 的自动重登语义仅保留给用户主动动作）。
- ROADMAP 按 leader 方法论写入 docs/plans/ROADMAP.md：8 阶段（0-7），每阶段含验收命令与完成判据（2026-08-30）。
- 上传超时重试上限设为 20 次（用户要求，网络不稳定环境下的长程任务保障）。
- electron 选 ^44.0.0：^37 有 2 个 high 漏洞（extract-zip 路径穿越等），npm audit 清零。
- package.json 设 `type: module`（eslint.config.js 按签名警告改为 ESM 解析）；preload 构建输出 `.cjs`（CommonJS），避免 sandbox preload 与 `type: module` 的 `.js`-当-ESM 解析冲突，main 中 preload 路径相应为 `../preload/index.cjs`。
- better-sqlite3（同步 API、Electron ABI Prebuild 可用）而非 sql.js：Node/Electron 双 ABI 实测通过，无需 rebuild。
- 迁移机制：`schema_migrations` 版本表 + 事务内应用；001_initial 建全 8 表，002 加 task_stage_outputs 证据表，003 加 providers/capability_bindings。
- ffmpeg 分发：ffmpeg-static/ffprobe-static（6.1.1）随 npm 安装，electron-builder extraResources 打入安装包 resources/ffmpeg/，用户无需自装 ffmpeg。
- 下载重试上限 20 次（与用户要求的会话重试上限一致），指数退避封顶 30s。
- schema/views/markdown 纯逻辑放 src/shared/notes/，main 与 renderer 共用单一事实源。
