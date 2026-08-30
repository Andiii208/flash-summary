# SEU Summary

把东南大学科达录播课程录像变成结构化学习笔记的 Windows 桌面应用（Electron + TypeScript MVP）。

本地优先：每名用户使用自己的 SEU CAS 账号与自己的模型 Provider（OpenAI 兼容接口），没有开发者自有服务器。音频/文字/图片仅发送给用户自己配置的 Provider。

## 当前状态

MVP 开发中，阶段计划见 `docs/plans/ROADMAP.md`，进度台账见 `PROGRESS.md`。当前处于 Phase 0（工程基线）。

## 开发

```bash
npm install
npm run lint        # ESLint
npm run typecheck   # TypeScript strict（node + web 两个工程）
npm test            # vitest
npm run build       # electron-vite 构建产物到 out/
npm run dev         # 启动开发模式
```

CI（GitHub Actions, windows-latest）在每次 push 时运行 lint + typecheck + test。

## 设计规格与约定

- 唯一设计规格：`docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md`
- 目标平台：Windows only；B 站、云端同步、多用户、本地 ASR、PDF、macOS 均不在 MVP 范围。
- 默认资料库：`Documents\SEU Summary\Library`；临时文件在任务成功后删除。
- 凭据红线：CAS 会话与 API Key 用 Windows DPAPI 加密；严禁提交 .env、Cookie、TGT、API Key、auth_key、完整视频直链到 Git/日志/文档。
- 录播流策略：教师流 `1170193-1` 仅取音频；屏幕/PPT 流 `1170195-5` 取关键帧；全景流 `1170194-3` 不下载。
- Playwright 探索脚本不随应用分发，不迁移为产品代码。

## License

MIT
