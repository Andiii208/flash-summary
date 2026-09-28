# 全项目体检报告与优化计划（2026-09-28，待 Andiii 审阅）

> 体检范围：全仓（src/ 29,675 行、tests/ 26,346 行 1467 用例、scripts/ 13 文件、packaging/docs）。
> 方法：四路并行只读审计（main 进程 / renderer / shared+tests / 构建依赖文档）+ 全量门禁实测 + 关键发现逐条人工复核。
> **本文件只做诊断与计划，未动任何代码。**

## 0. 体检基线（实测）

| 门禁 | 结果 |
|---|---|
| `npm run lint` | ✅ 0 警告 0 错误 |
| `npm run typecheck` | ✅ 双工程通过 |
| `npm test` | ⚠️ 1466/1467，1 条失败；**单文件重跑 42/42 全过 → 判定为 flaky**（`app-shell.test.tsx`「批1 (P13) 全屏浏览器点导图」在满负载全量跑下 3s 默认超时不够，同文件多条 3.6s 用例通过）。见 H23 |
| `npm run smoke` | 未本轮跑（改动 IPC 契约前必跑，见批7） |

**编译卫生全零**：`: any` / `as any` / `@ts-ignore` / `dangerouslySetInnerHTML` / `console.*`（src 内）/ 事件监听泄漏 / skip·todo 测试 / 快照依赖 —— 全部为 0。契约链 bridge↔preload↔ipc **66/66 闭合**（preload 单次类型标注，形状漂移会直接 TS 报错）。

## 1. 总体结论

项目没有"屎山"级别的结构性腐烂，工程纪律（编译卫生、契约闭合、监听清理、DPAPI/脱敏/sender 校验）是扎实的。但离"完成开发任务 + 宣发"还差三类问题：

- **2 个真安全问题**（B 站 SSRF 凭据外带、main 侧代理割裂）——宣发前必须修；
- **30+ 处用户可见缺陷**（模型文本 28 处印字面星号、切课残留笔记、暗色荧光笔错色、登录假成功、PDF 按钮可卡死）；
- **一批声明层不实与数字漂移**（Tailwind 许可残留、README IPC 计数过时）——直接违反 AGENTS"只写能核对的事实"。

## 2. 问题总账

### P0 — 安全 / 真实风险（宣发前必须闭环）

| ID | 问题 | 证据 | 触发场景 |
|---|---|---|---|
| H1 | **B 站凭据可被带往响应体指定的任意主机（SSRF + 会话外带）**。`fetchSubtitleBody(subtitleUrl)` → `requestEnvelope(url, /*withCookie*/true)` 直接写 `headers.Cookie = SESSDATA`，URL 来自 `x/player/wbi/v2` 响应体的 `subtitle_url`，无主机白名单。同族：`fetchImageAsDataUrl`（盲 SSRF，不带 cookie）、`resolveShortLink` 仅 `/b23.tv/` 子串匹配 | `src/main/bilibili/client.ts:120-123, 182-186`；短链 `client.ts:254-263` + `ipc.ts:391-403` | 导入一个字幕轨指向外部主机的视频 → 应用带登录态请求该主机 → 会话失窃 |
| H2 | **main 侧 fetch 绕过 Electron 代理配置**。`index.ts:199` 只给 Chromium session 设 system 代理，而所有主进程 HTTP 走 `globalThis.fetch`（Node/undici，不读 Chromium 代理） | `src/main/app-context.ts:228, 244`、`main-window-login.ts:145`、`cas-login.ts:80,189` | Clash 混合端口（非 TUN）用户：窗口内网页正常，main 侧 B站/provider 请求全直连失败，表现为"界面能开网页但任务全挂" |

### P1 — 用户可见缺陷 / 架构债（本阶段修复）

| ID | 问题 | 证据 |
|---|---|---|
| H3 | **28 处模型文本未过 MdLite/InlineText，`**加粗**` 印字面星号**。屏幕端 16 处（NoteBlocks 时间线条目/金句/树节点/章节摘要、NoteViewer 章节 chip 与目录、MindMap 边标签/弹出层、ProviderPanel 测试回显）+ PDF 端 12 处（PrintHandout）。违反 AGENTS 硬规定 | `NoteBlocks.tsx:60,186,236,242,300,301,334,341,536,537`；`NoteViewer.tsx:452,455,536`；`MindMap.tsx:490,499,528,564,649,663`；`PrintHandout.tsx:43,79,80,97,242,284,303`；`ProviderPanel.tsx:218` |
| H4 | **切课残留笔记**。`loadNote` 只在有值时 setNote 从不清空；任务成功分支直接调 `loadNote(doneLesson)` 不先清数据 | `use-notes-domain.tsx:205-208`；`App.tsx:1441-1443` |
| H5 | **暗色主题荧光笔错色**。`--mark-bg` 只在 `:root` 与 `prefers-color-scheme` 暗色定义，`:root[data-theme='dark']` 整块 36 个 token 里没有它 → 浅色系统上手动选深色时，笔记 `==高亮==` 用亮黄底（0.45）铺暗色正文 | `style.css:39,138` vs `:159-194` 缺定义；`style.css:2074` 消费点 |
| H6 | **CAS 登录假成功**。`void finish('ok')` 吞掉 cookies.get/saveSession/DPAPI 异常，finally 照常 resolve → 调用方记 success 并写「session encrypted at rest」日志，实际什么都没落盘 | `auth/cas-login.ts:416, 343-365` |
| H7 | **registerIpc 二次注册造成状态分裂**。activate 时再注册，而队列/abortControllers/pendingPdfExports 全是 registerIpc 闭包状态 → 旧任务的新 `isTaskRunning()` 返回 false（关窗确认失灵）、`cancelRunning()` 遍历空队列、`settings:setCacheDir` 守卫误判"无任务在跑"允许半途换缓存根 | `index.ts:263-273`；`ipc.ts:247-261` |
| H8 | **模型调用不可取消**。`requestEnvelope` 不接受 signal（取消后仍等满 30s）；`notes:regenerate`/`repair`/`polish`/`qa:ask` 四条 IPC 不传 AbortSignal，只能等 600s 硬顶，UI 无取消手段 | `bilibili/client.ts:111-152`；`ipc.ts:1822,1855,1898,2025`（对照 `orchestrator.ts:829` summarizing 是传 signal 的） |
| H9 | **regenerate/polish/repair 无 lessonRef 守卫**。await 后 `loadNote(lessonId)` 不校验当前课时，生成途中切课旧课结果覆盖新课面板 | `use-notes-domain.tsx:514,573,613`（对照 `:190,205,250` 都有守卫） |
| H10 | **PDF 导出可永久卡死**。`waitForImages` 无超时——极端 `<img>` 不触发 load/error 时 Promise 永不 settle → `pdfBusy` 永真，PDF 按钮永久"生成 PDF 中…"+disabled，只能重启 | `use-notes-domain.tsx:21-33` |
| H11 | **PDF 与其它导出可并发弹两个原生保存框**。`withExportBusy` 串行化 markdown/obsidian/anki/svg/png 五个导出，但 `runExportNotePdf` 用自己的 `pdfBusy` 不看 `exportBusy`，与注释写的不变式冲突 | `use-notes-domain.tsx:321-329` vs `:733-795`；`NoteViewer.tsx:388` |
| H12 | **未转义模型文本拼进 querySelector**。概念名含 `"`/`\` → SyntaxError → sticky 目录滚动高亮静默失效。44 行前已有 `escapeSelectorValue` 没用上 | `NoteViewer.tsx:245` |

### P1 — 测试 / 契约债（防漂移机制被拆）

| ID | 问题 | 证据 |
|---|---|---|
| H13 | **共享假桥被 `as unknown as` 废掉防漂移保证**：5 个活方法缺失（school.removeCourse / notes.exportPng / lessons 整组 / settings.chooseCacheDir / settings.exportLibraryBackup）+ 1 个幽灵方法（tasks.run）——测试侧看不到桥面形状，正是 2026-09-18 批C1 的同类残留 | `tests/helpers/fake-app-bridge.ts:203` |
| H14 | **两个 handler 双通道零验证**：`providers:test` 与 `settings:chooseCacheDir` 单测 smoke 皆空；`providerTestOverride` 专为测试留的缝从未被用过 | `ipc.ts:835-852, 903-913` |
| H15 | **smoke workflow paths 过滤漏掉桥面形状真实源头**：schema.ts / attachments.ts / qa.ts / evidence.ts / summarize.ts 改了不触发 smoke | `.github/workflows/smoke.yml:11-21` |
| H16 | **preload 的 regenerate/polish 返回类型是手抄窄版**（少 7/1 个字段，纯装饰可腐烂）；`refStats` 是 IPC 信封里未声明字段但被测了 7 处 | `preload/index.ts:111-114` vs `bridge.ts:278-312`；`summarize.ts:493,600` |
| H17 | **app-shell 慢测试 3s 超时在全量负载下 flaky**（本轮实测 1 红、重跑全过） | `tests/components/app-shell.test.tsx`（该文件多条 3.6s 用例贴着默认超时） |

### P2 — 卫生 / 质量 / 一致性（随批处理）

| ID | 问题 | 证据 |
|---|---|---|
| H18 | **THIRD-PARTY 残留 Tailwind 不实陈述**：Tailwind 已在 b80654d 全删（代码/lock/配置零残留），但声明表仍列 + `LICENSES/tailwindcss-MIT.txt` 仍随包 | `THIRD-PARTY-NOTICES.md:76`；`LICENSES/tailwindcss-MIT.txt` |
| H19 | **ffprobe 许可标注口径矛盾**：同表 ffmpeg.exe 标 GPL-3.0，ffprobe.exe 标"MIT via ffprobe-static"；ffprobe 是 ffmpeg 同源构建产物，许可需核实后订正 | `THIRD-PARTY-NOTICES.md:12-14,66` |
| H20 | **文档数字漂移**：README "62 channels" 实际 66；release.md "SMOKE PASSED: 32/32" 实际 40/40；SKILL.md「存量野值 73 处/46 个值」实测 71/44 | `README:67`；`scripts/release.md`；`docs/skills/ui-layout/SKILL.md:38-39` |
| H21 | **9 处 busy 纪律违反**（按钮无 disabled/省略号）：TaskPanel 取消×2+显示更多、SettingsPanel B站退出+重试+浏览、NoteViewer 复制Markdown、CourseTree/CourseBrowser 抓取目录（卸载按钮当第三种 busy 形态）、收藏×2 | 各文件行号见批6 |
| H22 | **7 个死 CSS 选择器** + 连带失效物：`.seg-tabs`/`.card-lg`/`.row-sm` 基元基类从未被输出、`.timeline-images`、`.mindmap-zoom-label`（ui-probe 仍在探测、mindmap 测试仍断言 null）、`.provider-hint`、`.qa-dock-title` | `style.css:213,222,240,250,2160,2328,1087,1752` |
| H23 | **测试缝隙无打包门**：`SEU_ANKI_PATH/PNG_PATH/SVG_PATH/PDF_PATH` 注释写 dev-only 但无 `app.isPackaged` 门，打包后依然生效 | `ipc.ts:1560,1613,1657,1932` |
| H24 | **zod `z.coerce.number()` 静默降级**：`at:""` → 0 秒合法入笔记；`diffNormalization` 统计口径比归一层窄（concepts/formulasAndSteps/examCues/questionsAndGaps 被丢弃不计数 → UI 少报） | `schema.ts:10,27,127,140,483-495` |
| H25 | **测试前导重复 12 份**（FakeIpc ×12、makeCtx ×10、electron 桩 ×14，约 350-400 行拷贝）；schema 双路径 shim（`src/main/notes/schema.ts` 全文 1 行 re-export，5 个测试走旧路径） | 全 tests/；`src/main/notes/schema.ts` |
| H26 | **主进程同步解码峰值**：缩略图缺失时回落全分辨率 `jpeg.decode`/`PNG.sync.read`，一次装配最多 ~222 帧串行阻塞主进程数秒；叠加 summarize 一次读 20 张图 base64 进单 JSON body | `media/grid.ts:27,34`；`summarize.ts:225` |
| H27 | **日志/数据细节**：logger 每行跑一次 rotate（readdirSync+sort，O(行数) 次目录扫描）；PPT 页 MIME 一律标 image/jpeg（靠浏览器 sniff）；`school platformTotal` 合成值失真；3 处静默降级无日志（providers()/courseHealth/丢图） | `logger.ts:22-24`；`notes/attachments.ts:63`；`school/client.ts:157`；`app-context.ts:247-254` |
| H28 | **工程卫生**：`png-to-ico@3.0.2` 零引用孤儿依赖；`release/` 本地堆积 1.4G（6 个安装包）；vitest/@vitest/mocker 2 moderate（dev-only，修复需 vitest 5 大版本）；vitest 无覆盖率阈值；`allowScripts` 非 npm 标准字段无强制 | package 实测 |
| H29 | **大文件巨石**：App.tsx 1984 行（useAppState 963 行承载 5 域、281 次 state 读取、挂载 effect 依赖 14 项）；MindMap.tsx 709 行（7 关注点）；use-notes-domain.tsx 877 行（7 关注点） | 见批10（决策项 D2） |
| H30 | **分层倒置与正则过宽**：play-harvest 反向 import auth 域路径常量；`/cas|login|sso` 正则把正常跳转误报 session_expired；BiliImportDialog setBusy 无 try/finally（IPC reject  busy 永真）+ overlay 背衬无 busy 守卫 | `play-harvest.ts:19`；`api-parse.ts:9`；`BiliImportDialog.tsx:121-147,252-258` |

## 3. 优化计划（十批）

顺序原则：安全红线 → 用户可见缺陷 → 纪律收尾 → 防漂移机制 → 文档声明 → 大拆分为可选项。每批独立可门禁、可回滚。

### 批1 — B 站 URL 白名单（H1，安全）
- `client.ts` 建 `BILIBILI_HOSTS` 白名单（`*.bilibili.com`、`*.hdslb.com`、`*.akamaized.net`、`b23.tv`、`i0.hdslb.com` 等实际用到的），`requestEnvelope` / `fetchImageAsDataUrl` / `resolveShortLink` 入口统一过 `assertAllowedUrl()`（scheme 限 https + host 后缀匹配）；短链先规范化再 fetch。
- `withCookie=true` 仅对白名单主机开放（非白名单一律剥 cookie）。
- 新增单测：外部主机 subtitle_url 带 cookie 请求被拒（本地 fake server 取证）。
- 门禁：四门禁全绿 + 新测试。

### 批2 — main 侧代理一致性（H2）
- 把 `SchoolClient`/`BilibiliClient` 的默认 fetch 换成 Electron `net.fetch`（走 session 代理），或启动时解析系统代理注入 undici `ProxyAgent`——选前者（更简单，D4）。
- 验收：`net-diagnostics` 已有预检可复用；补一条单测钉住"B 站 client 默认 fetch 是 session 感知的"。
- 注意：e2e 测试注入的 localhost fake server 必须仍在白名单外放行（测试缝）。

### 批3 — 假成功与状态分裂（H6、H7）
- `cas-login finish` 改「先持久化、后 resolve」，失败走 `fail(...)`；统一两条路径行为。
- 把 `SerialTaskQueue` / `abortControllers` / `pendingPdfExports` / idleListeners 提到 `createContext` 或模块级单例，`registerIpc` 只做 handler 绑定（`removeHandler` 已兜重复注册）。
- 补测试：activate 二次注册后旧任务仍可取消、`isTaskRunning` 仍 true、缓存根切换守卫生效。

### 批4 — 文本渲染纪律 28 处（H3，AGENTS 硬规定）
- HTML 路径统一包 `<InlineText>`（NoteBlocks 10 + NoteViewer 2 + MindMap HTML 3 + ProviderPanel 1）。
- SVG `<tspan>`（MindMap 4 处 + PrintHandout StaticMindMap）：解析 inline token 后按 tspan 分段输出（`<strong>`→font-weight、`<mark>`→底色 tspan），复用 md-lite 的 inline 解析器产物。
- PDF 路径 PrintHandout 同方案。
- 验收：每条路径补一个「模型输出 `**xxx**`/`==xxx==` 不印字面符号」的用例。

### 批5 — 交互缺陷收口（H4、H9、H10、H11、H12）
- `loadNote` 开头无条件 `setNote(null)`（配 lessonRef 守卫防闪）+ App.tsx 成功分支先 `clearLessonData()`。
- regenerate/polish/repair 补 lessonRef 守卫（同 refreshCover 范本）。
- `waitForImages` 加 `Promise.race` 8s 超时兜底继续打印。
- PDF 按钮 `disabled={pdfBusy || exportBusy != null}`；`runExportNotePdf` 入口走 `withExportBusy('pdf')`。
- `escapeSelectorValue()` 抽到 `shared/notes/dom.ts`，NoteViewer 245 行复用。
- 每项补回归测试（切课残留 = 造一个"成功但无笔记"的任务完成事件）。

### 批6 — busy 纪律 + CSS 清理 + 主题洞（H5、H21、H22）
- 9 处按钮套 `disabled` + 省略号（范本：`withRowBusy`/`withExportBusy`）；抓取目录按钮改回 disabled 形态（不卸载）；BiliImportDialog `setBusy` 补 try/finally、overlay 背衬加 busy 守卫。
- `--mark-bg` 补进 `:root[data-theme='dark']`；把 style-scale 测试从"恰好 2 个定义"改成按三机制分组比对。
- 删 7 个死选择器；连带修 `ui-probe.mjs:752`（不再探测已删控件）与 `mindmap.test.tsx:148`（反断言改注销原因或删除）。
- `.seg-tabs` 三选一：删基类只留成员组（推荐，SKILL"同一角色一处定义"）或组件真挂基类。

### 批7 — 测试侧防漂移机制复位（H13、H14、H15、H17）
- `fake-app-bridge.ts`：`as unknown as` 降级为单次标注 `const bridge: SeuSummaryBridge = {…}`，补 5 个缺失方法、删幽灵 `run`；加静态测试把 `makeBridge()` 方法键集合与 `EXPECTED_BRIDGE` 钉成一份。
- `providers:test` 走 `providerTestOverride` 补错误路径单测；`settings:chooseCacheDir` 补单测。
- smoke.yml paths 增加 `src/shared/notes/**`、`src/main/notes/**`。
- app-shell 慢用例显式 `{ timeout: 8000 }`（消除 flaky，H17）。

### 批8 — 契约/类型/schema 卫生（H16、H24、H25）
- `RegenerateResult`/`PolishResult`/`RepairResult` 提成命名 interface，preload 只 import 名字；`refStats` 补进 bridge 声明或从 handler 剥离。
- `diffNormalization` 补 concepts/formulasAndSteps/examCues/questionsAndGaps 四项（谓词复用现成 normalizer）；补一条 `at:"" → 报错` 的针对性测试。
- 抽 `tests/helpers/fake-ipc.ts` + `electron-mock.ts`（12 文件各减 ~25 行）；5 个测试改 shared 路径后删 schema shim。

### 批9 — 声明层与文档收尾（H18、H19、H20、H27、H28，发版前置）
- 删 THIRD-PARTY Tailwind 行 + `LICENSES/tailwindcss-MIT.txt`；核实 ffprobe-static 内置二进制来源后订正许可（若确为 ffmpeg 同源则随 GPL-3.0 口径并说明）。
- README 62→66、release.md 32→40 与步骤编号重复、SKILL.md 73→71。
- `SEU_*PATH` 缝隙加 `app.isPackaged` 门（H23）；logger rotate 改按日期缓存每分钟最多一次；attachments MIME 按魔数推断；providers()/courseHealth/丢图补 warn 日志。
- 删 `png-to-ico` 孤儿声明；release/ 只留最新包。
- `allowScripts` 字段要么接 allow-scripts 工具要么删（D5）。

### 批10 —（可选）大文件拆分（H29，决策项 D2）
- App.tsx：useAppState 按域拆 5 个域 hook（course-tree/session/consent/qa-dock/bootstrap），目标 App.tsx ≤300 行；挂载块搬 `useBootstrap()`（effect 只依赖 `[bridge]`）。
- MindMap 拆 toolbar/relation-layer/popover/use-mindmap-layout。
- use-notes-domain 按 7 关注点拆 2-3 个域 hook。
- ⚠️ 这是纯内部重构、零行为变化，但 1467 用例回归成本高——**建议发版后单独一个计划做**，或只做 useAppState 拆域（ROI 最高）。

## 4. 决策项（请 Andiii 裁）

| # | 决策 | 推荐 |
|---|---|---|
| D1 | 批1 白名单 host 集合：是否含 `*.akamaized.net`/`*.bilivideo.com`（B站 CDN，实际可能出现在 cover/subtitle 重定向链）？ | 含——以 `client.ts` 现有常量 + 一次真实导入日志取证后钉死 |
| D2 | 批10 大拆分：本轮做 / 发版后单独做 / 只做 useAppState 拆域？ | **发版后单独计划**；本轮若时间富余只做 useAppState 拆域 |
| D3 | vitest 5 升级（2 moderate、dev-only）：排期还是接受风险？ | 接受风险并在 THIRD-PARTY 注明 dev-only；发版后单独排 |
| D4 | H2 修法：net.fetch 换默认 fetch / undici ProxyAgent 注入？ | net.fetch（更简单，与既有 session 代理面一致） |
| D5 | `allowScripts` 字段：接 allow-scripts 工具真强制 / 删除声明？ | 删除——npm 直接忽略，留着是假护栏 |
| D6 | release/ 历史包清理（1.4G，仅本地不入 git）：现在清 / 保留？ | 保留最新 0.7.11，其余清 |

## 5. 明确不做（防范围蔓延）

- 不改 appId/包名/userData 署名（红线）。
- 不动 zoom/640 阅读轴/P47 承诺/两个断点（排版钉子）。
- 不给应用加任何自动上报（产品边界）。
- 不引新运行时依赖（全部计划用现有依赖实现）。
- 不动 spec §9 之外的用户可见承诺；新增承诺先进 spec。

## 6. 验收口径（每批通用）

四门禁全绿（改 IPC 契约的批 1/2/3/7 另跑 `npm run smoke`）；测试数只增不减；`git status` 只含本批目标文件；每批结束一次 neat-freak 一致性快检（README/AGENTS/docs 数字与代码对齐）。全部完成后：重跑全量门禁 + smoke + `npm run dist` 装机走查一轮，再进入宣发物料收尾。
