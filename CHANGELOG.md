# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的精神，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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
