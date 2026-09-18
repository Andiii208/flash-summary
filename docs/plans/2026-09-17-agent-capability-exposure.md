# 能力外露：把 Flash Summary 的「视频源 → 总结文档」能力接给外部 Agent

> 状态：**方案待审**（未动任何代码）。日期：2026-09-17。
> 触发：Andiii 提出「后续想把本产品能力与 agent 结合，以 MCP 或其他形式让 WorkBuddy / ZCode / Codex 也能用上，去获取哔哩哔哩等信息源的视频，最终产出总结性文档」。

## 0. 结论先说

**技术上可行，而且比预期便宜**——因为本仓库的核心管线**本来就没有绑在 Electron 上**，`tests/pipeline-e2e.test.ts` 已经在纯 Node 里用真 ffmpeg 跑完整六阶段流水线（这条测试每天都在 CI 绿）。

**但真正要裁决的不是技术，是三条产品边界**：批量入口、凭据外露、成本失控。这三条都直接撞现有 `DISCLAIMER.md` 的承诺（§2 禁止批量抓取、§3 提示风控风险、§6 明示「不提供批量抓取入口」）。所以本方案的第一步不是写代码，是把这三条边界先定下来并写进 spec §9（AGENTS.md 声明层纪律：新增用户可见承诺，先进 spec，再落实现）。

## 1. 现状盘点（代码证据）

### 1.1 已经具备的（不需要重做）

| 能力 | 位置 | 对 Agent 外露的价值 |
|---|---|---|
| 六阶段流水线，全依赖注入 | `src/main/tasks/orchestrator.ts:28` `OrchestratorDeps`（db / libraryRoot / cacheDir / ffmpeg / school / chat / gridDecoder / fetchStream / harvestLesson） | 换一套 deps 就能换个宿主运行，无需改流水线 |
| 上下文装配可覆写 | `src/main/app-context.ts:38` `createContext({libraryRoot, userDataDir, cryptor, bilibiliFetch})` | 已有注入缝，可直接复用到非 Electron 宿主 |
| **headless 实证** | `tests/pipeline-e2e.test.ts`（430 行：真 ffmpeg 造素材 + 本地 HTTP 服务假学校/假 Provider + 真 sqlite，六阶段全跑） | 「脱离 Electron 能否跑通」不是假设，是 CI 里跑着的结论 |
| B 站链路纯 HTTP | `src/main/bilibili/client.ts`、`pipeline.ts`、`qr-login.ts`（fetch 可注入） | 字幕优先/ASR 兜底/付费拒绝全部可无窗口运行 |
| 笔记投影纯函数 | `src/shared/notes/*`（markdown / obsidian / anki / mindmap-svg / views / health） | 产出「总结性文档」不需要渲染层 |
| Provider 客户端泛化 | `src/main/providers/openai-client.ts`（含 ASR 端点探测 + 多模态回退） | Agent 只需在设置里配一次，MCP 侧不必再管 Key |
| 已有 argv / env 缝 | `src/main/index.ts:124` `directNetRequested(process.argv, ...)`、`:140` `SEU_SMOKE_USER_DATA` | 加 `--serve` 之类开关有现成范式 |
| 托盘 + 单实例 | `src/main/index.ts:184` `requestSingleInstanceLock()`、`:49` `Tray` | 应用本来就常驻后台，适合当本地服务宿主 |
| IPC 层 61 个 handler | `src/main/ipc.ts`（`school:* bilibili:* tasks:* notes:* qa:* providers:* settings:*`） | 现成的能力清单，MCP 工具直接从中裁剪 |

### 1.2 硬约束（真正要绕的东西）

全仓 138 个 TS 文件里，**只有 9 个 import electron**：
`main/index.ts`、`main/ipc.ts`、`main/app-context.ts`、`main/auth/cas-login.ts`、`main/auth/electron-cryptor.ts`、`main/notes/obsidian-export.ts`、`main/notes/pdf-export.ts`、`preload/index.ts`，加两个脚本。

它们对应的五处耦合，逐条给出绕法：

1. **凭据解密（唯一的真障碍）** `auth/electron-cryptor.ts` 用的是 `safeStorage` = Chromium os_crypt v10：AES key 存在 `userData/Local State` 里、由 DPAPI 包裹。**外部 Node 进程读不了**这些密文，除非重实现 os_crypt（原生 DPAPI 绑定 + 解析 Local State）。接口本身很小（`Cryptor` 三个方法，`auth/session-crypto.ts:9`），所以「换一个 cryptor」容易，「让外部进程解开应用写的密文」才是成本所在。
2. **用户数据目录** `app.getPath('userData')` → 可以参数化（`createContext` 已支持 `userDataDir` 覆写）。
3. **学校播放页收割必须真浏览器** `school/play-harvest.ts:306` 需要一个能执行页面 JS、能完成 SSO 跳转的窗口（接口已收窄成 `BrowserWindowLike`，`play-harvest.ts:209`，但替代实现等于自带一个浏览器）。→ SEU 源**无法纯 headless**，B 站源可以。
4. **PDF 导出必须渲染层** `notes/pdf-export.ts` 用主窗口 `printToPDF`（注释里写明本机第二渲染器有已知故障，所以走主窗口）。
5. **原生对话框** Markdown/Anki/PDF/Obsidian 导出都走 `dialog.showSaveDialog`（`ipc.ts:1179`、`:1434`、`:1214`）。Agent 场景不能弹框，需要「直写 exports 目录并返回路径」的无对话框变体（已有 `SEU_PDF_PATH` / `SEU_ANKI_PATH` 这类测试缝可参考）。

## 2. 三条候选架构

### 方案 A：应用内宿主（推荐）

应用（已在托盘常驻）在主进程里起一个**仅回环**的能力服务，Agent 通过它调用。

```
Codex / ZCode / WorkBuddy
        │  (stdio MCP)                    (HTTP MCP, 可选)
        ▼                                        │
  fs-bridge（~60 行 Node 薄壳）                   │
        │  HTTP 127.0.0.1 + Bearer token          │
        └──────────────► Flash Summary 主进程 ─────┘
                            └ 复用 AppContext / orchestrator / db / DPAPI
```

- **优点**：单一运行时 → 资料库、登录态、Provider Key 只有一份，用户不重复配置；凭据**永不出应用**（agent 拿到的是任务与文档，不是 cookie/key）；CAS 登录、播放页收割、PDF 导出、托盘常驻全都现成可用；导出文件天然落在资料库 `exports/` 里，agent 拿到绝对路径即可。
- **为什么不用 Electron 直接讲 stdio**：Windows 上 Electron 是 GUI 子系统进程，stdout 不是可靠管道的两端；且 `requestSingleInstanceLock` 会让 CLI 拉起的第二个实例直接退出并聚焦已有窗口。→ 用薄 stdio 桥接回环 HTTP，既回避这两点，又对所有客户端通吃。
- **代价**：用户必须先装并开着应用（可接受：它本来就是托盘常驻的桌面应用）。

### 方案 B：独立 headless 二进制

打包一个不含 Electron 的 Node 程序，直接复用无 Electron 依赖的那些模块。

- **优点**：不要求应用在跑；CI 可测；适合纯 B 站批处理。
- **致命点**：它**解不开应用写的密文**（见 1.2 第 1 条）。要么让用户把 API Key、B 站登录再配一遍（两套状态、两个真相源），要么引入原生 DPAPI 依赖重实现 os_crypt（新依赖 → 必须同步 `THIRD-PARTY-NOTICES.md` + `LICENSES/`，且脆弱）。
- 且 SEU 源直接残废（没有浏览器 → 只能退到旧 `lessonDetail` API），PDF 也没了。
- **结论**：不作为主线；只在「B 站 → Markdown」这个子集上是个便宜的备选（方案 C）。

### 方案 C：最小可用子集

只把 **B 站源**做成独立 MCP（B 站全程纯 HTTP：扫码登录、字幕、DASH 流、ffmpeg 抽帧、Provider 转写/总结）。SEU 校内源不动。

- 便宜、风险小、可独立发布；但拿不到「校内课程」这个本产品的立身之本。

### 对比

| | A 应用内宿主 | B 独立二进制 | C 只做 B 站子集 |
|---|---|---|---|
| 复用现有代码 | 几乎 100% | ~80%（须自建 cryptor/会话） | ~80%（同 B，但只 B 站链路） |
| 凭据安全 | 最好（不出应用） | 差（重新存一份） | 中 |
| SEU 源 | ✅ 完整 | ❌ 基本不可用 | ❌ 不做 |
| PDF 导出 | ✅ 复用主窗口 | ❌ 需自建 | ❌ |
| 用户配置成本 | 一次（设置里开开关） | 两套（Key/登录要重配） | 一套 |
| 工作量（估） | 中 | 中高（且结果更差） | 低 |
| 建议 | **主线** | 不做 | 若要先出成果，可当 A 的先导 |

## 3. 接口设计

### 3.1 工具面（从现有 61 个 IPC handler 里裁 7-8 个，宁少勿多）

| MCP 工具 | 映射现有能力 | 说明 |
|---|---|---|
| `source_preview(input)` | `bilibili:resolve` / 平台解析 | 只解析不下载：标题、时长、分P、有无字幕、付费即拒 |
| `media_import(input, options)` | `bilibili:import` / `tasks:create` | 入队，返回 `taskId`；**保持单任务串行** |
| `task_status(taskId)` | `tasks:*` | 阶段 + 进度 + 失败原因 |
| `note_get(lessonId, format)` | `notes:latest` + `shared/notes/*` | markdown / JSON / 复盘卡 |
| `document_export(lessonId, format)` | 导出族（**需无对话框变体**） | `md / pdf / obsidian / anki / svg`，返回绝对路径 |
| `library_search(query)` | `shared/course-search.ts` + db | 让 Agent 先落回既有笔记，避免重复烧钱 |
| `course_list()` | `school:courseTree` | 定位课程/课时 id |
| `note_ask(lessonId, question)` | `qa:ask` | 课时边界内的追问 |

设计要点：
- **任务式而非阻塞式**。一节 45 分钟课 = 下载 + 转写 + 多模态，分钟到几十分钟量级，远超多数客户端的工具调用超时。必须 `import → 轮询/等待`（MCP 的 progress 通知客户端支持参差，不能只靠它）。
- **只返回文档与状态，绝不返回凭据**。cookie / JWT / API Key 不出主进程（这条可以写成负向红线测试）。
- 一期不做 MCP `resources`/`prompts` 原语，只做 tools；resources 留到「让 Agent 直接 `@` 某份笔记」时再上。

### 3.2 开启与安全

- 设置页一个显式开关（默认**关**）+ 首次开启时一次性说明（这是新承诺，文本进 spec §9 + `DISCLAIMER.md` 升版本号）。
- 只绑 `127.0.0.1`；令牌随机生成、DPAPI 落盘、进日志前必须脱敏；请求带 Origin 校验。
- 每次工具调用写一行脱敏审计日志（复用 `main/logger.ts`）。
- 设置页直接给出可复制的客户端配置 JSON（安装路径不在 PATH 上，用户手写必错）。

### 3.3 护栏（必须与工具同时落地）

- **单次一件**：一次调用只处理一个视频/课时，与 `DISCLAIMER.md` §6「不提供批量抓取入口」一致。要不要放开成「N 个排队」是产品边界决策（见 §6 D2）。
- **付费即拒**：复用 `BilibiliPaidError`（`bilibili/pipeline.ts:30`），出口在工具层再拦一次。
- **预算护栏**：单次时长上限 + 每日任务数上限（设置项，给默认值），避免 Agent 无人值守烧 API 费用（ASR 按分钟计费 + 多模态按图计费）。
- **录音/画面外发前提示**：数据只发用户自配 Provider——与 `DISCLAIMER.md` §4 一致，不需新增承诺，但要在开启说明里复述一次。

## 4. 分阶段落地

**批 0（决策与声明，无代码）**：定 §6 的 D1-D6；更新 spec §9 与 `DISCLAIMER.md`（升文本版本号 + 钉住测试）、`CHANGELOG.md`。验收：`npm run lint && npm run typecheck && npm test` 全绿 + 版本号一致断言通过。

**批 1（内核抽离，零行为变更）**：新增 `createKernel({libraryRoot, userDataDir, cryptor, ffmpeg, ffprobe, fetch})` —— 把 `AppContext` 里那套装配逻辑收成可复用门面，Electron 侧改为调用它。不新增能力、不改 UI。验收：新增「内核在无 Electron 环境装配并跑通六阶段」测试（大部分已被 `pipeline-e2e.test.ts` 覆盖，补齐门面入口）。

**批 2（应用内能力服务）**：回环 HTTP + 令牌 + 8 个工具 + 无对话框导出变体（写 `exports/`，返回路径）+ 审计日志 + 设置页开关与配置复制。验收：契约测试（工具 schema / 令牌校验 / 越权路径 / 付费拒绝 / 票据与 Key 不出现在任何返回值与日志）。

**批 3（stdio 桥 + 文档）**：`fs-bridge` 薄壳（stdio ↔ 回环 HTTP），README / AGENTS / spec / `THIRD-PARTY-NOTICES.md`（MCP SDK 许可）同步。验收：三个客户端各跑通一次「给链接 → 拿 Markdown/PDF」全流程，记录到 `docs/acceptance/`。

**批 4（可选）**：headless CLI（`flash-summary summarize <url> -o out.md`）——对 ZCode/Codex 这类能执行 shell 的 Agent，CLI 往往比 MCP 更省事；以及 MCP `resources` 暴露笔记全文。

## 5. 风险清单

| 风险 | 说明 | 处置 |
|---|---|---|
| 凭据边界 | Agent 生态里「把 Key 交给 MCP」很常见，本产品不能这么做 | 方案 A 天然规避；写成测试断言 |
| Agent 越界（批量/高频） | 撞 §2、§3、§6 | 工具层单件限制 + 预算护栏 + 默认关闭 |
| 成本失控 | 无人值守跑 ASR/多模态 | 每日上限 + 返回预估 + 审计日志 |
| 长任务超时 | 客户端工具超时远短于任务时长 | 任务式接口 + 轮询；`task_wait` 带上限 |
| 单实例与托盘语义 | 桥接进程拉起应用的行为要明确（已在跑/未启动/首启未同意须知） | 未同意须知时拒绝服务，不复刻「headless 首启绕闸门」 |
| 本地监听面 | 回环端口任何本机进程可访问 | 令牌 + Origin 校验 + 默认关闭 + 可随时关 |
| 合规新承诺 | 声明层不先行的老毛病 | 批 0 强制先行 |

## 6. 待 Andiii 裁决（D1-D6）

- **D1 架构**：选 A（应用内宿主，推荐）/ B（独立二进制）/ C（先做 B 站子集）。
- **D2 批量边界**：维持「一次一件」（推荐，与 `DISCLAIMER.md` §6 一致）/ 允许 Agent 一次提交 N 个排队（需改声明）。
- **D3 接口形态**：MCP stdio 桥 + 回环服务（推荐，覆盖面最广）/ 只做 CLI（最省事，但客户端要求能执行 shell）/ 只做 HTTP MCP。
- **D4 开启方式**：设置页显式开关 + 一次性说明（推荐）/ 其他。
- **D5 预算护栏默认值**：单次上限（建议 1 课时）、每日任务上限（建议 5 次）。
- **D6 读取面**：是否允许 Agent 读**已有笔记全文**（`library_search` / `note_get`）——注意这些内容可能含课堂画面与教师肖像（§5），只在用户本机读取不涉及外发，但语义上比「生成新文档」更宽。

## 7. 明确不做

- 不做云端服务、不做开发者中转（`DISCLAIMER.md` §4、§7 与 AGENTS.md「反馈通道只给入口、不上报」）。
- 不把凭据（cookie / JWT / API Key）以任何形式交给客户端。
- 不做批量抓取入口（除非 D2 另行裁决并同步改声明）。
- 不在 MCP 侧新增 Provider 配置入口（Provider 只在应用设置里配，保持单一真相源）。
- 不为了 MCP 去重实现一套流水线（方案 B 的诱惑点，代价是两套状态）。
