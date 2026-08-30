# PROGRESS — SEU Summary

> 断点续跑台账：新会话先读本文件和 docs/plans/ROADMAP.md，不重做已完成内容。

## 当前状态

- **已完成阶段**：Phase 0-7 全部完成（工程基线 → 数据库 → CAS/API → 队列 → 媒体 → Provider → 笔记/追问 → 打包验收）
- **进行中**：无
- **下一步**：MVP.md 中 5 项人工验证（需真实 CAS 账号与 Provider Key，用户可解锁）；UI 主界面组装（课程列表/任务面板/笔记视图接线）未实装，见「遗留」

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

## 遗留（诚实清单）

- **UI 主界面组装未实装**：课程列表页、任务进度面板、笔记视图接线是独立模块但未在主窗口组装（renderer 仍是脚手架占位页）。模块层测试全部通过，缺的是 Electron IPC 接线与布局。
- **需人工验证的 5 项**：见 docs/acceptance/MVP.md（干净机器安装、真实 CAS 登录、真实课程拉取、45 分钟端到端、过期重登恢复）。
- **待确认删除项**：无（构建产物 release/ 已 ignore，未入库）。

## 失败与卡点

（无）

## 关键决定记录

- ROADMAP 按 leader 方法论写入 docs/plans/ROADMAP.md：8 阶段（0-7），每阶段含验收命令与完成判据（2026-08-30）。
- 上传超时重试上限设为 20 次（用户要求，网络不稳定环境下的长程任务保障）。
- electron 选 ^44.0.0：^37 有 2 个 high 漏洞（extract-zip 路径穿越等），npm audit 清零。
- package.json 设 `type: module`（eslint.config.js 按签名警告改为 ESM 解析）；preload 构建输出 `.cjs`（CommonJS），避免 sandbox preload 与 `type: module` 的 `.js`-当-ESM 解析冲突，main 中 preload 路径相应为 `../preload/index.cjs`。
- better-sqlite3（同步 API、Electron ABI Prebuild 可用）而非 sql.js：Node/Electron 双 ABI 实测通过，无需 rebuild。
- 迁移机制：`schema_migrations` 版本表 + 事务内应用；001_initial 建全 8 表，002 加 task_stage_outputs 证据表，003 加 providers/capability_bindings。
- ffmpeg 分发：ffmpeg-static/ffprobe-static（6.1.1）随 npm 安装，electron-builder extraResources 打入安装包 resources/ffmpeg/，用户无需自装 ffmpeg。
- 下载重试上限 20 次（与用户要求的会话重试上限一致），指数退避封顶 30s。
- schema/views/markdown 纯逻辑放 src/shared/notes/，main 与 renderer 共用单一事实源。
