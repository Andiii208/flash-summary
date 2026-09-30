# 2026-09-30 发布前体检 + 仓库公开 + GitHub Release 自动更新

> Andiii：「现在很想准备发布了……再做一版体检；如果没问题，把仓库变成公开；
> 最后在软件里加一个指向 GitHub Release 的自动更新功能……再 push，确保整个没问题。」

## 0. 体检结论（先于一切改动，全部实跑）

| 项 | 结果 | 说明 |
| --- | --- | --- |
| lint | 0 错 | `npm run lint` |
| typecheck | 0 错 | 双 tsc（node + web） |
| 测试 | **1571 / 1572** | 唯一失败是 `app-shell.test.tsx` P13 用例（Esc 关导图弹层），单跑该文件 44/44 全绿 → 全量负载下偶发，**非产品回归** |
| flaky 真因 | 已实锤 | 上次修复 `202e754` 提交信息声称「helper 一并抬到 8000」，实际只抬了 `waitForSelector`；**`waitForGone` 仍写死 3000**（`tests/components/app-shell.test.tsx:31-36`），P13 用例正好死在第 685 行的 `waitForGone`。修复=把上次没做完的补完（3000→8000）+ 两条 P13 用例 `it` 级 8000→15000（每个用例 5+ 次串行轮询，8s 总预算不够分） |
| git 历史敏感内容 | 干净 | 全历史 444 个文件逐一过名：无 `.env`/cookie/session/`.pem`/TGT/`Library/`/`release/` 入库；JWT pickaxe 唯一命中是测试假值（`eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE5MDB9.sig`）；内联"密钥"命中全是 `secret123` 类夹具 |
| npm audit | 4 条，**全部 dev-only** | 2 high = `electron-builder→node-gyp→undici`、`app-builder-lib→ajv→fast-uri`（构建工具链）；2 moderate = `vitest/@vitest/mocker`（上次 D3 已记账，修需 vitest 5 大版本）。生产依赖只有 `better-sqlite3`、`jpeg-js`，**安装包里进不去这四个包**，按 D3 口径延后，不碰构建工具链 |
| 仓库/CI 状态 | 同步 | master = origin/master；v0.7.12 已发布（tag 在 bfdef01，Release + CI/Smoke 双绿）；ci.yml/smoke.yml 无密钥依赖 |

**结论**：体检只有 1 条红灯且是测试基建尾巴（批1 修），无产品问题、无敏感内容、无生产依赖漏洞 → 满足「没问题」条件，执行公开。

## 1. 仓库转公开

`gh repo edit Andiii208/flash-summary --visibility public --accept-visibility-change-consequences`（token 已带 `repo` scope）。公开后 CI 对 push 照常运行（公开仓库 Actions 免费额度，两条工作流均无密钥）。

## 2. 指向 GitHub Release 的自动更新

### 2.1 形态：**用户手动触发的「检查更新」**，不是后台静默检查

- 既往可行性结论（2026-09-13 审计）：仓库 private + 包未签名，后台自动检查属产品边界变更须用户裁决。本次用户已明确要做自动更新，**形态按推荐取「用户点击检查更新」**：不背着你联网、与「不上报任何数据」红线一致（请求只发往 GitHub releases，读版本信息，无使用数据）。
- 落点：设置 → 关于与声明 新增「更新」区块（版本行下方）：检查更新按钮 → 发现新版本弹层（版本号 + 下载并安装 / 稍后）→ 下载进度 → 下载完成弹层（立即重启安装 / 稍后——`autoInstallOnAppQuit` 在下次退出时自动装）→ `quitAndInstall`。

### 2.2 技术选型：electron-updater + github provider

- 新运行时依赖 `electron-updater`（MIT）——electron-builder 官方配套，唯一事实源 `app-update.yml`，由 `build.publish`（provider github / owner Andiii208 / repo flash-summary / releaseType release）在 `npm run dist` 时生成；`dist` 不带 `--publish`，**构建不自动发布**，发布动作仍在用户手里（scripts/release.md 不变）。
- main 侧新模块 `src/main/update.ts`：**纯逻辑 + 依赖注入**（`app`/`autoUpdater` 都是注入面，测试给假的），不 import electron-updater；真实装配只发生在 `src/main/index.ts`（`autoUpdater.autoDownload=false; autoInstallOnAppQuit=true`）。
- 红线遵守：feed 常量钉死（owner/repo 在模块常量），`check()` 不接参数——渲染层传什么都不能改变更新源（同 `settings:openAuthor` 纪律，有钉住用例）。

### 2.3 契约（动桥面 → smoke 必跑）

`src/shared/bridge.ts` 新增顶层 `update` 组：`check()`（返回 available/up-to-date/unsupported/error）、`download()`、`install()`、`onEvent(cb)`（progress/downloaded/error 事件）。同步 preload、`scripts/smoke-cdp.mjs` 的 `EXPECTED_BRIDGE.update`、`tests/helpers/fake-app-bridge.ts`。

### 2.4 声明层（纪律：先 spec 后代码，批2）

- spec §9「User-facing disclosure layer」加一条：更新只从 GitHub 项目发布页读版本与安装包信息；安装包未签名，Windows 可能提示 SmartScreen；不上报使用数据。
- `DISCLAIMER.md` §8「可用性与环境」加更新事实两条；**文本版本 2→3**，`src/shared/disclaimer.ts` 同步（有钉住测试比对；版本递增会让存量用户在下次启动时重过知情闸门——这是机制本意）。
- `THIRD-PARTY-NOTICES.md` + `LICENSES/`：electron-updater（MIT）一行 + 许可文本。

### 2.5 批次

- **批1**（本方案前）：flaky 修复（测试基建，零行为改动）。
- **批2**：spec §9 + DISCLAIMER + disclaimer.ts（docs 先行）。
- **批3**：update.ts + 桥面 + preload + ipc 装配 + UpdatePanel/AboutPanel + use-config-domain 状态；测试（控制器 / ipc 层 / 组件）+ smoke EXPECTED_BRIDGE。
- **批4**：THIRD-PARTY-NOTICES + LICENSES + CHANGELOG [未发布] + PROGRESS 台账 + README 计数/特性。

## 3. 门禁与交付

每批后三门禁；批3 动桥面另跑 `npm run smoke`（40/40 预期不变、EXPECTED_BRIDGE 增组）；收尾五门禁（lint/typecheck/test/build/smoke）全绿后按 Conventional Commits 小聚焦提交并 push。版本号不 bump（CHANGELOG `[未发布]`，发布时按 scripts/release.md 走）。

**留给用户的**：装机走查（设置页更新区块真机点击一次「检查更新」）；SmartScreen 观感；安装器许可页目视（上版遗留项）。
