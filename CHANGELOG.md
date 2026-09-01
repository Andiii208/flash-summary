# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的精神，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-09-01

可用性与管线质量大版本（升级计划 U1-U5）：修复「按钮没反应无法使用」的主流程缺陷，UI 整体重做，补齐设置能力，兑现 45 分钟真实课程的核心承诺。

### 新增

- **Preact UI 重做**：组件化三区布局（课程树 / 任务·笔记·追问·设置页签 / 引导卡），CSS 变量设计系统 + 明暗主题（跟随系统或手动指定），toast 反馈与按钮加载态，首次启动三步引导；CSP 收紧 `connect-src 'none'`。
- **设置页**：任务缓存目录可改（写入探针校验，即时生效，可指到其他盘）、资料库迁移（SQLite backup API 复制 db + attachments，迁移前自动备份、失败回滚、重启生效）、主题切换、打开日志/缓存/导出目录。
- **Markdown 导出**：笔记页一键导出，走系统「另存为」对话框写入选定路径。
- **任务队列化**：main 侧串行执行器，同一时刻至多 1 个任务，连点不会并发写同一课时；`tasks:runAsync` 入队即返回 + `tasks:progress` 实时阶段/分片进度推送。
- **任务取消**：`tasks:cancel` 经 AbortController 在阶段边界终止，ffmpeg 随之 kill；取消任务标记 `failed(cancelled)`。
- **单实例锁**：二次启动聚焦已有主窗口，不再双开同一 app.db。
- **ASR 分片转写**：音频按 10 分钟边界切片（ffmpeg `-ss/-t`），逐片上传转写并按片偏移拼接——解除 Whisper 25MB 上限，45 分钟以上课程不再失败；进度按片推进。
- **多模态总结真实发图**：PPT 页与去重后关键帧以 base64 data URL 随消息发出（上限 20 张保护 token）；Provider 报 `unsupported_visual` 时自动回退纯文本提示。
- **ffmpeg 超时与停滞检测**：流拷贝下载 30 分钟墙钟超时 + 60 秒输出无增长即终止进程，stderr 尾部进入错误信息。
- **HTTP 下载 Range 续传**：部分文件在重试间保留，服务器支持 206 时从断点续传（PPT/HTTP 文件路径）。
- **日志落盘**：`userData/logs/` 每日一个文件、保留 7 份；Cookie/Key/带鉴权参数的 URL 落盘前一律脱敏；渲染进程错误经 IPC 进入同一日志；设置页可打开日志目录。
- **错误诊断**：迁移 005 给任务记录 `error_kind`（session_expired / cancelled 等），任务卡片与历史显示失败阶段与错误文案。
- **发布流程固化**：`scripts/release.md` 发布清单 + `scripts/verify-asar.mjs` asar 抽验（sha256 对比包内产物与 `out/`），防止再次出现资产过期事故。

### 修复

- **按钮无反应**（v0.1.1 用户反馈）：`tasks:run` 同步阻塞导致 UI 冻结 → 改异步队列 + 进度推送；课程列表不可点击 → 课程树可展开、点课时即选中；操作零反馈 → toast + 加载态 + 持久错误提示。
- **providers:list 泄露明文 Key**：列表通道只返回 `{id,name,baseUrl,hasKey}` 形状，明文 Key 永不离开 main 进程。
- **缓存清理误删运行中任务**：清理跳过与运行中/排队任务同名的缓存目录。
- **会话过期不处理**：invoke 失败统一识别 `session_expired` 并引导重登；任务失败在登录后可从失败阶段重试。

### 测试

- 114 → **187** 个用例（新增 ASR 分片、多模态消息组装与回退、串行队列、取消、ffmpeg 超时/停滞、Range 续传、缓存跳过运行中、settings CRUD、资料库迁移回滚、导出写文件、日志脱敏与轮转、25 个 Preact 组件测试）。

## [0.1.1] - 2026-08-31

修复 v0.1.0 发布事故的紧急重发。

### 修复

- **安装包内容过期**：v0.1.0 安装包内的 `app.asar` 是 UI 主界面与 Provider 设置实装之前的旧构建，导致用户看到的是 Phase 0 脚手架页而非完整应用。v0.1.1 从当前代码完整重新构建。
- **无应用图标**：补充 `build/icon.ico`（6 层尺寸 256/128/64/48/32/16，AI 生成「笔记起飞」方案），接入 electron-builder `win.icon`，安装器与桌面快捷方式不再显示默认 Electron 图标。
- **无快捷方式**：NSIS 配置补充 `createDesktopShortcut` / `createStartMenuShortcut`，安装后自动创建桌面与开始菜单快捷方式。

### 说明

- v0.1.0 的 Git tag 虽指向最新提交，但发布资产构建于更早时点，tag 与资产不一致。今后发布资产必须在打 tag 的同一提交上构建。

## [0.1.0] - 2026-08-30

首个可安装版本（MVP）。

### 新增

- 应用内 SEU CAS 登录，会话 DPAPI 加密持久化（重启免登录），过期检测与重登
- 课程/课时列表拉取 + 手动课程/课时 ID 后备入口
- 任务队列：6 阶段流水线（fetching_course → downloading_video → extracting_audio → transcribing → extracting_visuals → summarizing），失败重试从失败阶段恢复、复用已完成产物
- 媒体管线：教师流音频提取（16kHz mono WAV）、屏幕流关键帧 + 感知哈希去重、平台 PPT 下载、全景流禁下守卫、下载重试（上限 20 次、指数退避）
- Provider：多 Provider 配置、ASR/多模态/文本能力独立绑定、API Key DPAPI 加密
- 多模态结构化笔记（zod schema 校验）+ 四种阅读视图（详细/标准/要点/方法论，同一 JSON 投影）
- 当前课时追问（上下文 = 转写 + 笔记 + PPT + 关键帧 + 历史问答）
- 成功后删除临时视频/音频；>24h 缓存启动时清理
- 三栏桌面 UI（课程/任务/笔记+追问）+ Provider 设置界面
- NSIS 安装包（内置 ffmpeg/ffprobe），GitHub Releases 分发

### 质量

- 114 个自动化测试（19 文件），lint / typecheck / test / build / CI 全绿
- 真实 Electron 启动烟测通过

### 已知待人工验证

- 干净 Windows 机器安装、真实 CAS 登录、真实课程拉取、≥45 分钟端到端、会话过期重登恢复（详见 docs/acceptance/MVP.md）
