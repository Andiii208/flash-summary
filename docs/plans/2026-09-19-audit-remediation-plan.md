# 方案：全面审查整改（2026-09-19）

> 状态：**待审（未动任何代码）**。
> 触发：Andiii「看看这个项目有没有一些存在的问题和值得改进的地方……多角度多方面」→ 2026-09-19 五线只读审查（主进程健壮性 / 安全 / 数据层 / 测试体系 / 渲染层与组织）+ 汇报面谈。
> 取证方式：五路 Explore 代理只读调查 + 高危条目全部亲自读码复核（`assertAppSender`、`isAppOrSchoolUrl`、`addManualCourse`、`tasks:create`、orchestrator 路径拼接、搜索分块、CI 工作流、npm audit、db pragma、`unhandledRejection` 缺失、测试计数均已逐条打开源文件确认）。
> 与前序方案的关系：`2026-09-18-non-lecture-and-long-video.md`（待裁）的「批4 长视频工程治理」含**关键帧缩略图哈希**一项，与本方案批3 重叠——若先裁那份，批3 合并去重后只做一次（见 D9）。

---

## 0. 结论先说

这次审查的结论不是「项目烂」——1068 测试零 skip、SQL 全参数化、DPAPI 封装干净、md-lite 零 innerHTML、`openExternal` 红线遵守、迁移原子性扎实，底子在 Electron 个人项目里属于少见的一档。问题集中在**四类系统性盲区**，每一类都有明确的最小修复：

1. **安全的「通配符缺口」**：调用方校验与导航守卫都写了，但各有一个 `file://` 通配符把守门变成漏门（`ipc.ts:128`、`index.ts:90`）。这是审查中唯一「链条完整、可利用」的发现，**优先级最高**。
2. **主进程的分钟级冻结**：每个任务的抽帧去重、每次 summarize 的 PPT/关键帧哈希，都在主线程上全分辨率同步解码（jpeg-js/pngjs 纯 JS）。90 分钟课的估计冻结 20–60 秒（外推值，路径已核实）。这是用户可感知的头号性能问题。
3. **「绿灯折扣」**：`smoke` 不在 CI——历史上「四门禁全绿、真实使用崩」的事故（批C1 桥面漂移 30/32）全部落在 smoke 才能抓的缝上，而那道门靠人记得跑。另有 8 处固定 sleep + 37 处默认 1s 超时的 `waitFor`，在 CI 共享 runner 上是偶发红。
4. **最后一公里漂移**：README 承诺的「迁移前自动备份」实现里已不存在；`ui-layout/SKILL.md` 承诺的 padding 刻度强制测试没有对应断言（style.css 77 条野值）；`App.tsx` 2575 行、`useAppState` 一个 hook ~1650 行，下一个会话还会往里叠。

**总盘子**：8 批。批1/批2 是安全（可独立发版），批3/批4 是性能，批5 健壮性，批6 数据层，批7 CI，批8 收尾。每批一个 Conventional Commit、批批过四门禁、测试数只增不减；动契约的批按纪律加跑 smoke。

---

## 1. 现状（已核实证据）

### 1.1 安全：两个通配符 + 一条 id 纪律缺口

- `src/main/ipc.ts:124-131` `assertAppSender`：`if (url.startsWith('file://')) return`——**任意** file:// URL 放行，不校验是否应用自己的 `renderer/index.html`。
- `src/main/index.ts:85-95` `isAppOrSchoolUrl`：`if (parsed.protocol === 'file:') return true`——主窗口内任意页面发起 `location='file:///…html'` 导航**不触发 will-navigate 拦截**；该文件不带应用 CSP 却带 preload 桥，可通过全部 59 个 handler。
- `ELECTRON_RENDERER_URL`（`index.ts:164-168`）不按 `app.isPackaged` gate：本机带环境变量启动安装版即可远程接管 UI，`assertAppSender:129` 又认这个前缀。
- `school:addManualCourse`（`ipc.ts:508-529`）与 `tasks:create`（`ipc.ts:878-884`）只过 `str()`（非空即过，`ipc.ts:82`），lessonId 直达 `orchestrator.ts:633/656/679` 的 `join(attachmentsPath(root), lessonId, …)` + `mkdirSync`——`..` 可穿出库目录。同文件 `:944` `tasks:delete` 已有 `^[A-Za-z0-9][\w.-]*$` 校验并注释"never trust that implicit invariant with a filesystem delete"——**同一条纪律没有覆盖 id**。
- 纵深项（均已核实存在）：导航守卫只挂 `will-navigate`，缺 `will-redirect`/`will-frame-navigate`（`index.ts:97-111`）；CAS 登录窗（`auth/cas-login.ts:248-259`）无 `setWindowOpenHandler`/导航守卫；`redact()` 是黑名单，漏裸 `sk-` key 形态与 `buvid3`/`b_nut` 等 B 站 cookie 名；`setCacheDir` 接受 UNC；CSP 缺 `base-uri`/`form-action`/`object-src`；Anki TSV 未中和 `=`/`+`/`-`/`@` 前缀（CSV 注入）。
- **无问题项**（复查确认）：两处建窗 `sandbox+contextIsolation+nodeIntegration:false`；SQL 全参数化；唯一 `openExternal` 走 main 常量且不接参数；MdLite/KaTeX/SVG 三条渲染路径干净；`npm audit` 生产依赖 0 漏洞（devDeps 仅 `@vitest/mocker` moderate，仅开发期）。

### 1.2 性能：三处主线程/渲染层瓶颈

- **哈希解码**：`orchestrator.ts:632-666` 对每个抽帧候选 `gridDecoder(c.filePath)` → `media/grid.ts` 全分辨率 `decodeImage`；`notes/visual-hash.ts` 的 `hashOf` 对**每页 PPT + 每帧**再全量解码一次。90 分钟课 ≈ 540 帧，外推 20–60s 主进程冻结（按钮/托盘/IPC 全无响应）。
- **渲染层零 memo**：全 renderer grep 无一个 `memo()`；每解析一张附件 `App.tsx:1219` `setAttachmentVersion(v+1)` → 全树重解析（40 图课 = 40 次）。
- **搜索绕过分块**：非搜索态 `filteredTree.slice(0, state.visibleCourses)`（`App.tsx:483`），搜索态直接渲染整个 `filteredTree`（`App.tsx:415-430`）——搜通用词上千行一次性进 DOM。

### 1.3 健壮性

- 主进程**无** `unhandledRejection`/`uncaughtException`（全仓 grep 实锤；渲染层有 `App.tsx:2433-2437` 转发进日志，main 没有）；`index.ts:165/167` 两处 `void win.loadURL/loadFile` 无 `.catch`。
- **polish × regenerate 版本竞态**：`summarize.ts:335-356` `SELECT MAX(version)`→INSERT→DELETE 无事务；regenerate 守卫（`ipc.ts:1481-1500`）看不见 polish 的在飞标记（polish 不进串行队列 `ipc.ts:1506/1529-1530`）→ 同时算出同 version 撞 UNIQUE，用户看到无解释失败。
- **ASR 不接取消信号**：`openai-client.ts:176` 只有 `AbortSignal.timeout`；orchestrator 调 `client.transcribe(...)` 传不进 signal；backoff sleep（5/10/15s）期间不响应 abort——取消卡死的 ASR 最坏等 5 分钟。
- `queue.ts:128-133` `onProgress` 在 executor try 之外，抛出即任务行永久卡非终态 → 被"未完成任务"守卫永久禁迁移。
- 其余：`pendingPdfExports` 永不清理（无界 Map）；`cas-login.ts` trace 监听器累积 + `closed` 不清 pollTimer；`registerIpc` 在 activate 重建队列（Windows-only 休眠路径）。

### 1.4 数据层

- **附件孤儿是唯一无界磁盘增长**：`removeCourse`（`ipc.ts:591-608`）只删库行；重跑提取帧数变少时旧文件成孤儿；全仓无 attachments GC。
- **备份承诺漂移**：README:29 / CHANGELOG:662 写「资料库迁移（备份 + 失败回滚）」，`library/migrate.ts:58-103` 刻意不做快照且有测试钉住「不产生 .bak」（`tests/library-migrate.test.ts:34-36`）。库损坏无自愈路径。
- **误加课程跑挂一次任务后永久删不掉**：removeCourse 保护计数把 failed 历史行也算（`ipc.ts:591-601`），全仓无软删除。
- `qa` 表无上限无清理；`courseTree` 一次性全量 + O(C×L) JS 配对（当前量级可用，观察项）。
- pragma：WAL + foreign_keys 有；`busy_timeout`/`synchronous` 未显式（继承默认，够用）；无 VACUUM/ANALYZE/integrity_check（千行级无影响）。

### 1.5 测试与 CI

- **`smoke` 不在 CI**：`.github/workflows/ci.yml` 只有 lint/typecheck/test/build 五步（自 scaffold 起只改过一次）。AGENTS.md 自己记着「批C1 四门禁全绿而 smoke 30/32」。
- 8 处固定 sleep（`tests/ipc.test.ts:544/582/626/631/968/971` 等）；最紧 1050ms 对 `app-context.ts:393` 的 1000ms 轮询缓存窗口，余量 50ms。37 处 `vi.waitFor` 全默认 1s 超时。
- 247 处中文 exact-string 断言（合规面钉机制是正确的，通用 UI 文案同力度钉是成本）；prompt 条款钉到句子级。
- 健康面（复核确认）：0 skip/todo/only；无 tautology；4 处 `vi.mock` 只 mock electron 平台层；27 文件 mkdtemp 隔离；三核心模块错误路径覆盖充分。**最大盲区**：磁盘写满（ENOSPC）无实写失败测试；真实网络/代理/打包覆盖安装零自动化。

### 1.6 组织与文档

- `App.tsx` 2575 行（`useAppState` ~1650 行 / ~60 个 useState / 200 字段 AppState 接口）；`ipc.ts` 1713 行单函数 registerIpc；orchestrator 745、app-context 570。
- **Tailwind 是死基建**：`app.css:11-12` import + `tailwindcss`/`@tailwindcss/vite` 两个 devDeps，31 个组件零工具类。
- padding token 纪律测试落空：SKILL.md:37-38 声称 style-scale.test.ts 强制 padding，实际只钉 gap/line-height/letter-spacing；style.css 77 条不走 token。
- README「IPC 58 通道」实际 59；文档标题旧产品名已在 PROGRESS 遗留清单（本方案不重开）。

---

## 2. 方案

### 批1 — 安全 · 调用方与导航边界（P0）

**做什么**：把「任意 file:// 放行」改成「只认应用自己的 renderer 入口」；导航守卫补两个事件；登录窗挂守卫。

**落点**：
- `src/main/ipc.ts:124-131`：`assertAppSender` 改为精确比对——模块级缓存启动时算出的应用 renderer URL（`pathToFileURL(join(__dirname, '../renderer/index.html'))`）；dev 分支（`!app.isPackaged && process.env.ELECTRON_RENDERER_URL`）保留前缀放行。导出 `setAppRendererOrigin()` 供 index.ts 注入（测试可直接调）。
- `src/main/index.ts:85-95`：删 `if (parsed.protocol === 'file:') return true`（恢复 UI 走主进程 `loadFile` 编程式导航，不触发 will-navigate，无正当页面发起 file: 导航的场景）；`ELECTRON_RENDERER_URL` 分支加 `!app.isPackaged`。
- `src/main/index.ts:97-111`：`attachNavigationGuards` 补 `will-redirect` 与 `will-frame-navigate`，复用同一 `isAppOrSchoolUrl` 判定（学校主机的服务端 302 仍放行——登录/收割依赖它）。
- `src/main/auth/cas-login.ts:248-259` 建窗处：挂 `setWindowOpenHandler`（全拒）+ `will-navigate`（只放行 `NAV_ALLOWED_HOST_SUFFIXES`，复用 index.ts 的判定，抽到 shared 或复制一份小谓词）。
- `src/main/auth/cas-login.ts:122-132`：`traceSession(ses)` 改为「挂一次或保存引用、关闭时 removeListener」——现每次 `openCasLoginWindow` 都往 `persist:seu-cas` 加一个 `onBeforeRequest` 从不移除（旧登录窗路径 `SEU_LOGIN_WINDOW=1` 下逐次累积、trace 行倍增）；`closed`（`:380-389`）补清 `pollTimer`。

**测试**（新增，`tests/ipc.test.ts` 与 `tests/index-nav.test.ts` 新文件）：
- `assertAppSender` 拒绝 `file:///C:/temp/evil.html`、接受应用 renderer URL、接受 dev 前缀（仅未打包）、拒绝 `https://evil.example`。
- `isAppOrSchoolUrl`：`file:///x` → false；`https://auth.seu.edu.cn/x` → true；`https://evil.example` → false；`https://cvs.seu.edu.cn.evil.com` → false（后缀匹配钉住）。
- `will-redirect`/`will-frame-navigate` 接线测试（fake webContents 事件表）。

**提交**：`fix(security): IPC 调用方收窄为应用自身 renderer + 导航守卫补 redirect/frame 事件 + 登录窗清理 trace/pollTimer`

**验收**：四门禁 + smoke（本批不涉桥面，smoke 应保持 32/32；若断言过不了说明首启装配被误伤）。

### 批2 — 安全 · 入盘路径与脱敏（P1）

**做什么**：id 字符校验补到所有入盘路径；redact 补 key 形态；provider 错误体白名单；UNC 拒绝；Anki TSV 中和；CSP 补三个指令。

**落点**：
- `src/main/ipc.ts`：新增 `assertSafeId(v, name)`（`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`，注释引用 `:944` tasks:delete 的既有纪律），应用于 `school:addManualCourse:508`、`tasks:create:878`、`school:harvestLessons:451` 的 courseId、`notes:regenerate`/`qa:ask`/导出族的 lessonId（凡直达 fs 或 DB 行键的入口；纯 DB 查询参数一并校验，统一纪律）。
- `src/main/logger.ts` `redact()`：补 `\bsk-[A-Za-z0-9_-]{12,}`、`AKIA[0-9A-Z]{16}`、`\bgsk_[A-Za-z0-9]{12,}` 与 cookie 名 `buvid3|b_nut|x-bili-ticket`。`tests/logger.test.ts` 补形态断言（已有钉住测试同文件扩）。
- `src/main/providers/openai-client.ts:139/192`：错误信息从「响应体前 200 字符」改为白名单（HTTP status + 错误 kind，不留 body——provider 回显 key 的形态挡不住）。
- `src/main/ipc.ts:751-760` `settings:setCacheDir`：拒绝 UNC（`\\` 开头）与非本机绝对路径。
- `src/shared/notes/anki.ts:22-23`：单元格以 `=`/`+`/`-`/`@` 开头时前置 `'`。
- `src/renderer/index.html` CSP 补 `base-uri 'none'; form-action 'none'; object-src 'none'`（`style-src 'unsafe-inline'` 保持——Preact 内联样式的刻意选择，备案在 `docs/plans/2026-08-31-usability-upgrade.md:115`）。

**测试**：`assertSafeId` 单测（`..`、绝对路径、超长、合法 id 各一例）；redact 形态测试；anki 中和测试（既有 `tests/anki*.test.ts` 扩）；setCacheDir UNC 拒绝（`tests/ipc-settings.test.ts`）。

**提交**：`fix(security): id 入盘校验 + redact key 形态 + 缓存目录拒 UNC + Anki 公式中和`

**验收**：四门禁；`npm test` 里 ipc/logger/settings/anki 相关文件全绿。

### 批3 — 性能 · 哈希走缩略图（P0 性能）

**做什么**：解码全分辨率 → 解码小缩略图，一次 ffmpeg 同出，哈希后删缩略图。零新依赖、零质量损失（pHash 的 8x8 网格本来就是对原图的块均值的二次近似）。

**落点**：
- `src/main/media/ffmpeg.ts:135` `extractKeyframes`：单次调用改双输出——`-filter_complex "[0:v]fps=1/N,split[a][b];[b]scale=64:-2[t]"`，`-map "[a]" -q:v 2 frame-%04d.jpg -map "[t]" thumb-%04d.jpg`（一次 spawn，两个 pattern）。
- `src/main/tasks/orchestrator.ts:679-687` PPT 落盘后：对该 lesson 的 pptDir 跑一次 `ffmpeg -start_number 0 -i page-%03d.png -vf scale=64:-2 thumb-%03d.png`（一次 spawn 覆盖全部页）。
- `src/main/media/grid.ts`：新增 `thumbPathFor(originalPath)` 约定（同目录 `thumb-` 前缀名），`decodeGrid8x8` 不变；`src/main/notes/visual-hash.ts` `hashOf` 与 orchestrator 的 `gridDecoder` 注入点改为「有缩略图解缩略图、没有解原图」（兜底：缩略图生成失败不丢候选，既有 `hash=null` 降级路径保留）。
- 哈希用完即删：`loadSummarizeInputs`（`notes/summarize.ts`）装配完成后 `rmSync` 两个目录的 `thumb-*`（崩溃残留 ≤2KB/张，附件 GC 批兜底）。
- 顺手：`orchestrator.ts:640/663` 循环体内的 `await import('fs')`（`renameSync`）提到文件顶部静态 import。

**测试**：
- `tests/media-grid*.test.ts`（或既有 grid 测试文件）：**保真门**——对真实 fixture 图，`averageHash(decodeGrid8x8(thumb))` 与原图 grid 的汉明距离 ≤2/64（不许拿「差不多」糊弄；同时钉住重复帧仍判重、不同帧仍判轻）。
- orchestrator 测试（deps 注入 `gridDecoder` 已有缝）：抽帧去重在只有缩略图时行为不变。
- `extractKeyframes` 双输出测试（真实 ffmpeg，既有 media 测试已有此模式）：frame 与 thumb 数量一致、命名配对。

**提交**：`perf(media): 关键帧/PPT 哈希走 64px 缩略图，主进程不再全分辨率解码`

**验收**：四门禁；真实库副本跑一次 `note-regen-e2e` 或只读探针量 summarize 阶段耗时（批3 前后对比，写进 PROGRESS）。

### 批4 — 性能 · 渲染层 memo 与搜索分块（P1 性能）

**做什么**：memo 化笔记渲染树；附件解析完成一次性 bump；搜索态也分块。

**落点**：
- `src/renderer/components/MdLite.tsx`：`MdLite`、`InlineText` 包 `memo`（props 是纯字符串/基本类型时天然稳定）。
- `src/renderer/components/NoteBlocks.tsx`：`TimelineCards` 等重 mapper 包 `memo`；`bindTimelineImagesLazy`（`NoteBlocks.tsx:236`）结果 `useMemo([entries, attachments])`。
- `src/renderer/components/NoteViewer.tsx:405`：`projectNoteBlocks` 结果 `useMemo`。
- `src/renderer/App.tsx:1219`：附件逐张 `setAttachmentVersion(v+1)` 改为「全部解析完成后一次 bump」（或按附件 key 精确失效——取前者，简单）。
- `src/renderer/App.tsx:415-430`：搜索态 `tree={state.filteredTree}` 改 `tree={state.filteredTree.slice(0, state.visibleCourses)}`；顺带确认 1718-1720 的 `setVisibleCourses(150)` effect 对搜索态同样生效（否则「显示更多」在搜索态失灵——补 app-shell 测试钉住）。
- 重复拉取清理：任务成功事件一次触发两次全量 `tasks.list`（`App.tsx:1456+1463`）合并为一次；启动双拉（`:1415+1432`）口径统一（limit 与全表混用的问题一并解决）；`runNoteUpgrade` 每升一课刷一次全库（`:2305`）改批量后刷一次。
- busy 约定合规（AGENTS.md 2026-09-08 收口的「文案加省略号 + disabled + in-flight 守卫」）：`BiliImportDialog.tsx:186-189` 扫码登录补 `busyKind` 与「登录中…」标签；`TaskPanel.tsx:374-400` 行级「取消/删除」加 in-flight 期间 disabled。
- a11y 补齐：主 tab 与笔记五视图的内容面板补 `role="tabpanel"` + `aria-controls`/`aria-labelledby`（`App.tsx:510-538`、`NoteViewer.tsx:189-217`）；三个搜索框补 `aria-label`（`App.tsx:396`、`CourseBrowser.tsx:186`、`NoteLibrary.tsx:73`，与 MindMap 搜索框同款）。

**测试**（`tests/components/note-viewer.test.tsx`、`app-shell.test.tsx`）：
- memo 有效性：spy `parseInline` 计数器，一次无关 state 变更（如切换 tab 再回来）后解析次数不增长。
- 搜索分块：fake bridge 注入 ≥200 门课，搜索态 DOM 行数 ≤150 + 「显示更多」可用。

**提交**：`perf(renderer): 笔记渲染 memo 化 + 附件版本批量 bump + 搜索态分块` → `fix(renderer): busy 约定合规（B站登录标签/任务行守卫）+ tabpanel/aria-label`（两个提交，前者纯性能、后者约定与 a11y，分开 review）

**验收**：四门禁 + `npm run smoke`；`ui-probe` 量笔记页重渲染（可选）。

### 批5 — 健壮性收口（P1）

**做什么**：主进程全局兜底；修复四处「状态永久卡死/无解释失败」级竞态。

**落点**：
- `src/main/index.ts` ready 后：注册 `process.on('unhandledRejection')` 与 `('uncaughtException')` → `ctx.logger`（uncaughtException 记录后**不退出**——应用无 crashReporter，退出即丢现场；注释写明取舍）；`index.ts:165/167` 两处 `void win.loadURL/loadFile` 补 `.catch(e => log)`。
- **polish × regenerate 竞态**：`src/main/notes/summarize.ts:335-356` `saveNoteVersion` 的 MAX→INSERT→DELETE 包进 `db.transaction`；`ipc.ts:1481-1500` regenerate 守卫复用 polish 的进程内 in-flight registry（抽成 `src/main/notes/inflight.ts` 模块级 Map，两处共用；polish 现有 `polishInFlight` 改用它）。
- **ASR 取消**：`openai-client.ts` `transcribe` 增 signal 形参，用 `AbortSignal.any([signal, AbortSignal.timeout(ASR_TIMEOUT_MS)])`；`orchestrator.ts:122/327` 重试 backoff 换 abortable sleep（signal 触发即 reject）。
- `src/main/tasks/queue.ts:128-133`：`onProgress` 调用包 try/catch（或 launchTask catch 里对非终态行补 `markFailed`——取后者，收口更彻底，`ipc.ts:1012-1014` 一并改）。
- `src/main/ipc.ts` `pendingPdfExports`：`notes:exportPdfDialog` 发起时先清扫过期项。
- `src/main/ipc.ts:486-492` `school:harvestLessons` 二次调用：单飞被拒后的 catch 不再无条件 `finish(courseId, {ok:false})`（那会清掉第一次仍在途的 harvest 标识、并覆盖其 outcome）——finish 前校验该 course 是否仍由本次调用持有。
- `orchestrator.ts:103` `stageOutput` 的 `JSON.parse` 补 try/catch 降级 null，与 `tasks/resume.ts:62-68` 的 readOutput 同口径（同源两份实现收敛为一个带兜底的 reader）。

**测试**：
- 新 `tests/main-process-guards.test.ts`（或并入 index 相关测试）：unhandledRejection 落日志不崩（`process.emit` 注入 + logger spy）。
- `tests/ipc.test.ts`：polish 在飞时 regenerate 被拒（信封错误且不插版本）；`saveNoteVersion` 事务测试（并发两插 version 不撞 UNIQUE——用两个同步调用验证串行化）。
- `tests/orchestrator*.test.ts`：ASR 进行中 signal abort → 下一次阶段边界即 cancelled（不等 5 分钟，用假计时器验证）。
- queue 测试：onProgress 抛异常 → 行落 failed 而非滞留非终态。
- harvestRuntime 测试：第二个 harvest 被单飞拒绝后，第一次的在途标识保留、outcome 不被覆盖。
- **ENOSPC 盲区补齐**（§1.5 记录的测试空白）：注入写失败（stub `downloadToFile`/`writeFileSync` 抛 ENOSPC）→ 任务落 failed 且错误信息人话可读，不崩主进程、不留非终态行。

**提交**：`fix(main): 进程级异常兜底 + polish/regenerate 竞态 + ASR 可取消 + 进度回调不再卡死任务行`

**验收**：四门禁。

### 批6 — 数据层：附件 GC、备份、删除口径（P2）

**做什么**：补上唯一无界磁盘增长的回收；备份「二选一」按 D4 执行；修 removeCourse 误伤。

**落点**：
- `src/main/ipc.ts:591-608` `school:removeCourse`：库行删除事务成功后 `rmSync(attachmentsPath(root)/<course 的每个 lessonId>)`（rm 失败不阻塞——orphan 目录仍被 24h sweep 概念覆盖时补一句注释说明兜底）。
- `src/main/tasks/orchestrator.ts:633/656`：抽取 destDir 前 `rmSync(destDir, {recursive:true, force:true})` 再写（重跑帧数变少不再留孤儿——这是批3 后 destDir 内容变化的兜底，也覆盖 PPT dir）。
- `removeCourse` 保护计数（`ipc.ts:591-601`）：只挡「在跑/排队中」或「磁盘上仍有该任务缓存」的行，failed/cancelled 且无缓存的行不再阻止删除（按 D8）。
- **备份（按 D4 裁决）**：若选实现——新增 `settings:exportLibraryBackup`（`db.backup()` 到用户自选目录，复用 `library/migrate.ts` 内置 backup 原语与既有 save-dialog 模式），设置页「位置」区一个按钮；若选修文档——README:29 与 CHANGELOG:662 改成现状口径（迁移靠源库兜底，无 .bak）。**两种都改 `tests/library-migrate.test.ts:34-36` 的注释**，把「迁移不产 .bak」与「备份是独立入口」写清。

**测试**：removeCourse 后 attachments 目录不存在（集成，temp library）；重跑抽取帧数减少后无孤儿文件；backup 落盘可开（若实现）；failed 任务不再阻止删课。

**提交**：`fix(library): 删课清附件 + 重跑抽取防孤儿 + 删除保护只挡活任务`（+`feat(settings): 资料库备份导出` 或 `docs: 校正迁移备份口径`，按 D4）

**验收**：四门禁；真实库副本跑一次 removeCourse 只读核验目录消失。

### 批7 — CI 与测试时序（P2，杠杆最高的一条）

**做什么**：smoke 进 CI；消灭固定 sleep 与默认超时。

**落点**：
- `.github/workflows/ci.yml`：新增 `smoke` job（`needs: build` 产物传递或独立 build；`paths` 触发条件见 D6；`npm run smoke` 已有 `--packaged` 与隔离缝，CI 无技术障碍）。windows-latest。
- `src/main/app-context.ts:393`：轮询缓存窗口 `1000` 提为导出常量 `BILIBILI_POLL_CACHE_MS`，测试引用它而非写字面量。
- `tests/ipc.test.ts` 8 处 sleep → `vi.waitFor(状态落库/事件到达)`（`:920-925` 已有正确写法可抄）。
- `tests/helpers/` 新增 `waitFor(fn, timeoutMs = 5000)` 薄封装（内部 `vi.waitFor`），37 处调用点机械替换。

**测试**：本批即测试基建——替换后 CI 连跑两次全绿（本地 `npm test` 两遍）。

**提交**：`ci: smoke 进工作流` + `test: sleep 换 waitFor + 统一 5s 超时助手`

**验收**：push 后 GitHub Actions smoke job 实跑 success（本地先跑通再 push）。

### 批8 — 收尾：拆域、token 断言、死基建、文档（P2）

**做什么**：把最大维护债分批还掉；文档漂移一次清完。

**落点**：
- `useAppState` 拆分（按 D5 节奏）：先抽 `src/renderer/hooks/use-notes-domain.ts`（noteIndex/loadNote/upgrade/导出族）与 `use-tasks-domain.ts`（create/run/cancel/history），纯搬移 + 既有测试当回归，App.tsx 只留组合。`use-config-domain.ts` 是现成范式。
- `tests/style-scale.test.ts` 补 padding 断言——**先建 allowlist 基线**（把现存 77 条野值逐条列为 known-violations 并注明责任人/批号），断言「allowlist 只减不增」，之后随 UI 整改批收编（这是把 SKILL.md:37-38 的承诺变成真的且不制造大片红的唯一务实路径）。
- Tailwind 去留按 D7：删除则删 `app.css:11-12` import + 两个 devDeps + vite 插件一行（`electron.vite.config.ts:58`）；保留则在 AGENTS.md 记「M2 引入、未采用、待决」。
- 杂项：`taskLabelOf`（`App.tsx:906`）与 `TaskPanel.tsx:62` 的字节级重复收敛为 shared 一处；`src/main/ipc.ts` 与 `notes/summarize.ts` 的混合行尾（CRLF/LF 混存）统一为 CRLF（仓库现状主流），清掉 diff 噪音。
- 文档：README「58 通道」→ 59（或顺手改成不写死数字）；README/CHANGELOG 备份口径与批6 对齐；PROGRESS 记账；CHANGELOG [未发布]。
- 版本：收尾统一 bump `0.7.7` 测试构建（不打 tag——与 0.7.6 走查节奏一致，tag 等 Andiii；若 D2 选「安全批先发」，则批2 后即 bump 0.7.7 并发，批3-8 进 0.7.8 口径，PROGRESS 写清）。

**测试**：拆域批批跑既有组件测试（fake-app-bridge 契约不变应零改）；style-scale 新断言先用当前 style.css 验「基线通过」。

**提交**：`refactor(renderer): 抽出 notes/tasks 域 hook` → `test(style): padding 刻度基线断言` → `chore: 清理 Tailwind 死基建` → `docs: 全面审查整改收编`（4 个提交）

**验收**：四门禁 + smoke；拆域后 App.tsx 行数目标 ≤1200（notes/tasks 两域抽走后）。

---

## 3. 决策点（每条给推荐）

| # | 决策 | 推荐 | 理由 / 备选 |
|---|---|---|---|
| **D1** | `assertAppSender` 放行口径 | **精确 URL 比对**（启动时算出的 renderer index.html URL） | 前缀比对仍留「同目录任意文件」面；精确比对后学校平台页（导航后 frame URL 变学校域）自然被拒，正是威胁模型要的。备选：origin 级（file:// 无 origin 概念，退化为精确比对） |
| **D2** | 安全两批的发布节奏 | **批1/批2 落 master 后单独 bump 0.7.7 并发 tag，不等其余批** | 安全修复价值随时间衰减；0.7.6 走查并行不冲突。备选：全部批次攒完一次发 0.7.7（省一次打包，但安全修复晚数天） |
| **D3** | 哈希性能路线 | **缩略图方案**（批3） | 零新依赖、一次 ffmpeg spawn 双输出、pHash 语义不变。备选：`worker_threads`/`utilityProcess`（不改管线但加构建复杂度，且 PPT 页 PNG 解码在 worker 里一样烧 CPU，只是不卡 UI） |
| **D4** | 备份：实现 vs 修文档 | **实现导出入口** | `db.backup` 原语已在 `library/migrate.ts` 内置，UI 复用既有 save-dialog 模式，成本约半小时；库损坏是用户数据事故，值得一个按钮。备选：只改文档（零代码，但用户仍无自救路径） |
| **D5** | `useAppState` 拆分范围 | **先拆 notes/tasks 两域**，bili/tree 留观 | 两域最大（升级/导出/历史），拆完 App.tsx ≈1200 行；一次全拆风险与 review 成本不成比例。备选：暂不拆（批8 只做 token/死基建/文档） |
| **D6** | smoke CI 触发范围 | **push 到 master 全量 + PR 按 paths 过滤**（`src/shared/bridge.ts`、`src/preload/**`、`src/main/ipc.ts`、`src/main/index.ts`） | smoke 要 build + 起 Electron，全 PR 跑会拖慢反馈；契约路径是历史上事故的全部落点。备选：所有 push/PR 全跑（最安全，CI 时长 +2-4 分钟） |
| **D7** | Tailwind 去留 | **删** | 31 个组件零使用、零 `@apply`，devDep 不进安装包，删除零风险；死基建会持续误导下一个会话。保留的唯一理由是「将来可能用」——YAGNI |
| **D8** | removeCourse 保护口径 | **只挡在跑/排队中/磁盘有缓存的任务** | failed 行无缓存时阻止删除是误伤（当前行为）。备选：现状不动（保守，但用户永久删不掉误加课程） |
| **D9** | 与 `2026-09-18-non-lecture-and-long-video.md` 的关系 | **批3 与该方案批4 合并** | 若那份方案获批准，其「关键帧缩略图哈希」直接引用本方案批3，不重复实施；其余（素材分窗/体检自适应/10min 硬超时治理）仍归那份 |

---

## 4. 批次与提交计划

| 批 | 内容 | 规模 | 测试增量预估 | 行为/观感变化 |
|---|---|---|---|---|
| 1 | 安全·调用方与导航边界 | 中 | +6~8 | 无（负向防线） |
| 2 | 安全·入盘路径与脱敏 | 中 | +8~10 | 无（provider 错误信息变简洁；Anki TSV 公式列前置 `'`） |
| 3 | 性能·哈希缩略图 | 中 | +4~6 | 无（生成阶段主进程不再冻结） |
| 4 | 性能·渲染 memo/搜索分块 + busy 约定 + a11y | 中 | +5~7 | 搜索态列表变短 + 「显示更多」；B站登录中标签；任务行防连点 |
| 5 | 健壮性收口（含 ENOSPC/harvest/stageOutput） | 中 | +8~10 | 无（消除无解释失败） |
| 6 | 数据层 GC/备份/删除口径 | 中 | +4~6 | 删课后磁盘同步干净；删除保护放宽；备份按钮（按 D4） |
| 7 | CI/测试时序 | 小 | 0（基建） | CI 多一个 smoke job |
| 8 | 拆域/token/死基建/文档 | 大 | +2~3 | 无（内部结构 + 文档） |

依赖：批1/批2 可并行（互不触碰）；批3 与批4 独立；批6 的 removeCourse 附件清理依赖批3 的 thumb 命名（无强依赖，顺序执行即可）；批8 最后。门禁：批批四绿（lint/typecheck/test/build）；**批1 改动 `ipc.ts` handler 包装与 `index.ts` 启动路径 → 加跑 `npm run smoke`；批2 不改桥面但改 handler 入参校验 → smoke 一并跑**（AGENTS.md 纪律：拿不准就跑）。

---

## 5. 验收（整体）

1. **安全红线自动化**：`assertAppSender` 拒绝 `file:///…/evil.html` 的钉住测试存在且红过一遍（先写测试看它失败，再修）。
2. **性能实测**：批3 后真实库副本 summarize 阶段主进程无 >2s 同步冻结（复现方式：批3 前后各跑一次 `note-regen-e2e` 计时，写进 PROGRESS）。
3. **数据自愈**：删课 → attachments 目录消失；重跑抽取帧数减少 → 无孤儿；D4 若选实现 → 备份文件可开。
4. **CI**：push 后 Actions 出现 smoke job 且 success；连续两次 `npm test` 无偶发红（sleep 清零的验证）。
5. **不回归**：四门禁测试数只增不减（1068 起）；smoke 32/32 保持。
6. **诚实性**：PROGRESS 记账每批实测数字；README/CHANGELOG 与代码一致（备份口径、通道数、Tailwind 去留）。

---

## 6. 明确不做

- **FTS5 笔记全文检索**、**虚拟滚动**、**版本切换 UI**、**自动更新**：既有结论不变（2026-09-18 §6 / 2026-09-13 §7 / 2026-09-04 / 2026-09-14 裁决）。
- **`courseTree` 重写（JOIN/分页）**：当前量级毫秒级，观察项不动。
- **迁移 down/回滚机制**：SQLite 历史包袱，回归靠新迁移（写进 AGENTS 即可，不建机制）。
- **qa 表上限/清理**：按课时 50 条够用，记候选。
- **文档标题旧产品名**：PROGRESS 遗留清单已有，等 Andiii 对「全改 vs 连 spec 标题一起动」的裁决，不搭车。
- **`registerIpc` activate 队列交接**：Windows-only 休眠路径（`window-all-closed` 即 quit），记候选不修。

---

## 7. 待你裁决

1. **D2**：安全批（1/2）是否不等其余批、落地即发 0.7.7？（推荐：是）
2. **D4**：备份是实现按钮还是只修文档？（推荐：实现）
3. **D5**：`useAppState` 现在拆两域，还是本方案只做安全/性能/CI、拆域另开方案？（推荐：拆两域）
4. **D6**：smoke 进 CI 的触发范围（master 全量 + 契约 paths vs 全 PR）？
5. **D7**：Tailwind 删除（推荐）还是记录待决？
6. **D9**：若 `2026-09-18-non-lecture-and-long-video.md` 你打算批准，批3 是否按合并口径写进那份方案、本方案去掉批3？

裁决后我按 `docs/plans/` 既有节奏逐批执行（每批一个提交、门禁留痕、PROGRESS 记账）。
