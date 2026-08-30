# PROGRESS — SEU Summary

> 断点续跑台账：新会话先读本文件和 docs/plans/ROADMAP.md，不重做已完成内容。

## 当前状态

- **已完成阶段**：Phase 0（工程基线）、Phase 1（数据模型与本地资料库）
- **进行中**：Phase 2（CAS 登录与学校 API 客户端）
- **下一步**：CAS 登录窗口 + DPAPI 会话存储 + API 客户端 + fixture 回放测试

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
| Phase 2 | 进行中 | — | CAS + API 客户端 |

## 失败与卡点

（无）

## 关键决定记录

- ROADMAP 按 leader 方法论写入 docs/plans/ROADMAP.md：8 阶段（0-7），每阶段含验收命令与完成判据（2026-08-30）。
- 上传超时重试上限设为 20 次（用户要求，网络不稳定环境下的长程任务保障）。
- electron 选 ^44.0.0：^37 有 2 个 high 漏洞（extract-zip 路径穿越等），npm audit 清零。
- package.json 设 `type: module`（eslint.config.js 按签名警告改为 ESM 解析）；preload 构建输出 `.cjs`（CommonJS），避免 sandbox preload 与 `type: module` 的 `.js`-当-ESM 解析冲突，main 中 preload 路径相应为 `../preload/index.cjs`。
- better-sqlite3（同步 API、Electron ABI Prebuild 可用）而非 sql.js：Node/Electron 双 ABI 实测通过，无需 rebuild。
- 迁移机制：`schema_migrations` 版本表 + 事务内应用；001_initial 建全 8 表。
