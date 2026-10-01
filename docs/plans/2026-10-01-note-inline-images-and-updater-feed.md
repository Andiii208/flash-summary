# 2026-10-01 笔记穿插截图回归 + 自动更新 feed 缺失 修复方案

> Andiii：「我刚刚用软件的新版本重新拉取 b 站视频生成了一次笔记……笔记里面没有做课程截图的嵌入了？而是直接把课程截图统一放到笔记的最后面去了，但是之前的笔记在前面都是穿插了课程截图的呀。而且……点击检查更新的时候，弹出来了 cannot find latest.yml……404，这肯定不行啊。你把这两个问题都去看看，到底是什么原因，然后做出一份详细的优化与升级方案供我审阅。」

两个问题均已实锤到代码行与发布流程行。一个是 v0.7.10 引入的**渲染层 memo 漏依赖**（正文时间线卡片永久零配图），一个是 v0.7.13 发布时 **latest.yml 资产没上传**（electron-updater 的 feed 硬失败）。本方案只做缺陷修复与流程修正，不动产品边界，不新增任何用户可见承诺（无需 spec §9 变更，DISCLAIMER 文本版本不动）。

## 0. 结论速览

| # | 现象 | 一句话根因 |
| --- | --- | --- |
| 1 | 截图全堆笔记末尾、正文时间线卡片无图 | `src/renderer/components/NoteBlocks.tsx:288-291` 把跨条目贪心配图 `useMemo` 化时漏了 `attachmentVersion` 依赖；附件懒解析完成后的 bump 无法触发重算，分配结果永久停留在「首渲染全 undefined」的空态。图集（无 memo）照常重算，于是图全落在文末图集。由 `91b8e31`（2026-09-21，**v0.7.10+** 才有）引入，旧版本逐渲染重算所以是穿插的 |
| 2 | 检查更新 404 cannot find latest.yml | electron-builder 在打包机生成了 `release/latest.yml`，但 `scripts/release.md` 的发布命令只上传 Setup exe——GitHub Release v0.7.13（及历史上全部 13 个 release）没有 `latest.yml` 资产，而 electron-updater 的 GitHub provider 必须先抓到它才能比版本 |

两个问题的共同背景 clue：都是「最后一公里断链」——功能做完了（穿插配图 0.7.8 已有、更新 UI 0.7.13 已有），但收尾环节（memo 依赖、资产上传清单）漏了，且都被各自的「绿灯」掩盖（单元测试传同步附件、smoke 把 `error` 当合法状态）。

## 1. 问题一根因：正文穿插图为什么没了

### 1.1 笔记里插图的完整机制（事实基线）

笔记的 markdown 里**没有图片占位符**（prompt / schema / 渲染器都不存在 `![](...)` 这类语法）。图片位置由两层决定：

- **生成侧**：模型输出结构化 `timeline[i].evidence[{kind, ref}]`（ref = `ppt:<page>` / `kf:<id>`），随 `note_json` 落库（`src/main/notes/summarize.ts:48-84` prompt、`:560-566` 落库前清洗）。
- **渲染侧**：`src/shared/notes/evidence.ts` 的 `planAllocation`（`:131-174`）做两遍分配——
  - Pass 1：`entry.evidence[].ref` 逐条精确绑定，但**必须 `usable(ref)` 为真才绑**（`:144`）；
  - Pass 2：无图条目 × 未引用帧按 `|Δat|` 全局升序贪心一对一配对，同样要求 `usable(frame.ref)`（`:160`）。
  - 渲染层包装器 `allocateTimelineImagesLazy`（`:212-225`）的 `usable` 谓词 = `get(ref) != null`。契约注释写明：`undefined = 还在加载，本轮不参与分配`。

渲染层附件是**逐张懒加载**的（`src/renderer/hooks/use-notes-domain.tsx:283-327`）：`getAttachment(ref)` 未命中缓存时返回 `undefined` 并触发异步 IPC `notes:attachmentData`，**一批全部解析完成后才 `setAttachmentVersion(v+1)` 一次**（`:309-311`），注释说明这是「避免每张关键帧都触发整棵笔记树重渲染」。

### 1.2 断链点：memo 漏了附件版本依赖

`src/renderer/components/NoteBlocks.tsx:271-291`：

```tsx
function TimelineCards({ entries, chapters, getAttachment, manifest, version: versionForRerender, onOpenSource }: { ... }) {
  void versionForRerender   // ← :272 版本号被显式丢弃
  ...
  // P32 (plan 2026-09-21): 贪心分配 memo 化——本地态（展开组/放大图）变化不再重跑
  const allocated = useMemo(
    () => allocateTimelineImagesLazy(entries, getAttachment ?? (() => null), manifest),
    [entries, getAttachment, manifest]   // ← 没有 versionForRerender
  )
```

关键事实链：

1. `getAttachment` 是 `useCallback(..., [resolveAttachment])` 的**稳定引用**（`use-notes-domain.tsx:317-327`，`resolveAttachment` 依赖仅 `[bridge]`）——所以 memo 在附件解析完成、版本 bump 后**不会**因为函数引用变化而重算。
2. `resolveAttachment` 逐张异步解析（`use-notes-domain.tsx:295-316`）。TimelineCards 首渲染发生在「note 刚到、附件 cache 全空」的时刻（选课/打开笔记时 `loadAttachments` 与 `loadNote` 并行发起，note 到达即渲染时间线）——此时 `get(ref)` 全部返回 `undefined`。
3. `planAllocation` 的 `usable` 全 false → Pass 1 一条不绑、Pass 2 一对不配 → **`allocated` 全空数组**。
4. 附件解析完成后 `setAttachmentVersion(v+1)` → NoteViewer/NoteBlocks 重渲染 → 但 memo 依赖三项都没变 → `allocated` **永久停留在空态**。时间线卡片全部纯文字（`:366` 的 `side=false` 分支不渲染 `timeline-side`）。
5. 文末「课堂画面」图集 `EvidenceGallery`（`:443-448`）用的是**每次渲染重算**的 `resolveEvidenceGalleryLazy`（无 memo，直接函数调用）→ attachments 到位后图全部出现在图集。

⇒ 用户看到的就是：**正文时间线卡片零截图 + 文末图集满载截图**，与描述逐字吻合。

### 1.3 引入提交与「为什么以前的笔记是穿插的」

- `91b8e31`（2026-09-21，P32）把 `allocateTimelineImagesLazy` 从逐渲染计算改为 `useMemo`。提交信息原文：「P32 memo 收尾……**订正**：附件版本批量 bump 其实早已落地（69dd7fd audit 批4，2026-09-21 的 sweep 报告看错了），本批只做剩余的一半。」——作者据此认为附件 bump 信号已足够，**没有把 `attachmentVersion` 补进依赖**。该提交随 v0.7.10 发布，所以 v0.7.10/0.7.11/0.7.12/0.7.13 全部中招。
- v0.7.8/v0.7.9 无此 memo，`allocated` 逐渲染重算：附件到位后的每次重渲染都会重新分配，图自然回到卡片里——这就是「以前的笔记在前面都是穿插的」。
- **同文件内的对照组证明团队知道这个坑**：`src/renderer/components/NoteViewer.tsx:229-240` 封面兜底 `coverSrc` 的 memo 依赖**明确带 `attachmentVersion`**，注释「依赖里带 attachmentVersion——首帧是懒加载的，解析到位后会重算」。TimelineCards 与下面 1.4 的 imageCoverage 是漏网的两处。

### 1.4 同型第二处：体检面板会同步误报

`src/renderer/components/NoteViewer.tsx:222-226` 的 `imageCoverage`（B6「时间线配图覆盖率」指标，喂给体检面板）是**同一段分配逻辑的第二个 memo**，依赖 `[note, getAttachment, attachmentManifest]` 同样漏 `attachmentVersion`——附件到位后 memo 不重算，体检面板会把「N 条均无配图」的 info 行显示成事实，实际卡片有图（修复后）。两处一起修。

### 1.5 为什么四门禁 + smoke 全绿却没人发现

`tests/components/note-viewer.test.tsx` 全部用例传**同步** `getAttachment`（命中即返回附件对象，如 `:170/:290/:352/:556/:838` 等）——冷缓存「先 undefined、bump 后才有数据」的时序快照对在测试里不存在，memo 依赖缺陷不可见。smoke 走打包产物只验证桥面形状，不验证这个渲染时序。

### 1.6 自愈与自判（用户现在就能验证，无需等修复发版）

- **切到其它视图 tab（要点/方法论/思维导图）再切回「详细笔记」**：TimelineCards 卸载重挂，memo 重新计算，此时附件 cache 已热 → 穿插图**立刻恢复**。
- 重新打开该课时笔记（`selectLesson` → `clearLessonData` → 重取）同样恢复，但代价是重新懒加载。
- 打开笔记后**不切视图**，正文就保持零图（复现路径）。
- 反面自判：工具栏「引用命中 N/M」徽标（`NoteViewer.tsx:219` hitRate 用 manifest 算、不走懒加载谓词，不受 bug 影响）若命中很高、图集满载、而体检面板说「时间线 N 条均无配图」→ 即本案实锤。
- PDF 讲义导出不受影响：`PrintHandout` 走 `allocateTimelineImages`（已解析附件，`evidence.ts:192-205`，无懒加载谓词）。Obsidian 导出只导被引用帧，也不受影响。
- **存量笔记无需重新生成、无需重新拉视频**：note_json 里的 evidence 引用本来就在，纯粹是渲染层绑定失败。切换视图即恢复，且本修复发版后新老笔记打开即正确。

## 2. 问题二根因：检查更新 404

### 2.1 完整链路

1. `UpdatePanel.tsx:106` 按钮 → ipc `update:check`（`src/main/ipc.ts:1147-1150`）→ `src/main/update.ts:74-83` `controller.check()` → 真实 `autoUpdater.checkForUpdates()`（`src/main/index.ts:2,226` 注入）。
2. feed 来源是**打进安装包的** `app-update.yml`（实测 `release/win-unpacked/resources/app-update.yml`，由 `package.json:24-29` 的 `build.publish` 生成）：
   ```yaml
   owner: Andiii208
   repo: flash-summary
   provider: github
   releaseType: release
   updaterCacheDirName: seu-summary-updater
   ```
3. electron-updater 的 GitHubProvider 先解析最新 tag（成功，仓库已 public，拿到 `v0.7.13`），再拼渠道文件 URL：`getBaseDownloadPath(tag, 'latest.yml')` = **`https://github.com/Andiii208/flash-summary/releases/download/v0.7.13/latest.yml`**（tag 钉进路径，"latest" 只用于选 tag 和文件名，从不进 URL——与用户报错文本逐字一致）。
4. 该 URL **404**。`gh api` 只读实测：v0.7.13 Release 资产只有一个 `Flash.Summary.Setup.0.7.13.exe`（160,022,926 B，与本地 latest.yml 记录的 size/sha512 一致），**没有 latest.yml**；历史上 13 个 release 全都没有。

### 2.2 「生成侧好、上传侧缺」

打包机上 `release/latest.yml`（358 B，与 Setup exe 同一次构建）内容完整且自洽：

```yaml
version: 0.7.13
files:
  - url: Flash-Summary-Setup-0.7.13.exe
    sha512: vep4vCkkdmK7...KA==
    size: 160022926
path: Flash-Summary-Setup-0.7.13.exe
sha512: vep4vCkkdmK7...KA==
releaseDate: '2026-09-30T03:35:39.381Z'
```

`url/path` 与 GitHub 规范化后的资产名一致，sha512/size 与实际 exe 匹配。缺的只是「上传到 Release」这一步。

### 2.3 流程缺口链

- `scripts/release.md:30` 产物清单只列 Setup exe 与 win-unpacked，**未提 latest.yml**。
- `scripts/release.md:56` 发布命令 `gh release create vX.Y.Z "release/Flash Summary Setup <version>.exe" ...` **只传一个资产**。
- `package.json:91` `dist` = `electron-vite build && electron-builder --win nsis`，**无 `--publish`**，发布纯手动。
- 2026-09-30 方案 `docs/plans/2026-09-30-public-release-autoupdate.md:33` 原话「dist 不带 --publish，构建不自动发布，发布动作仍在用户手里（scripts/release.md **不变**）」——这句「不变」就是漏洞：加了 electron-updater 却没在发布清单里补上传步骤。更早的 2026-09-05 方案（H3 决策点）把自动更新描述为「发布流改造 + latest.yml + 更新 UI」三件套，本次只做了后两件。

### 2.4 两个掩盖问题与一个体验问题

- **smoke 掩盖**：`scripts/smoke-cdp.mjs:174` 的 `update:check` 断言把 `'error'` 列为合法返回状态——坏 feed 上打包冒烟依然 41/41 全绿。
- **错误透传**：`src/main/update.ts:40-42` `messageOf` 原样返回上游 message，`UpdatePanel.tsx:50` 直接整句印在状态行——用户看到的是带 `HttpError 404` 和打包后堆栈（`at createHttpError ... index.cjs`）的原始文本，既不可读也泄露实现细节。404 是硬失败（比版本之前就拦下），当前版本用户永远走不到「已是最新」。
- 即使补上 latest.yml，用户已是最新——提示会是「已是最新版本 0.7.13」，但 404 发生在版本比较之前，所以这步必须先修。

## 3. 修复批次

每批 = 实现 + 测试（只增不减）+ 三门禁；收尾五门禁 + 装机视角验收。提交按 Conventional Commits 小聚焦。

### 批1 问题1 主修：memo 补依赖（最小改动）

- `src/renderer/components/NoteBlocks.tsx:288-291`：依赖数组补 `versionForRerender`（即 `attachmentVersion`）。保留 memo 的初衷（本地态展开/放大不再重跑整份分配），只把「附件解析完成」这个信号接回来。同步把 `:272` 的 `void versionForRerender` 改为实际使用（该行删除）。
- `src/renderer/components/NoteViewer.tsx:222-226`：`imageCoverage` memo 依赖同样补 `attachmentVersion`，防止体检面板误报「均无配图」。
- 备选方案（不推荐）：直接去掉 memo 逐渲染重算——分配是纯函数、单次开销 O( entries×frames )+排序，实测 18 帧规模可忽略；但 memo 化是 P32 的既定决定且有本地态交互收益，补依赖改动更小、语义更准。

### 批2 问题1 回归测试：懒加载时序快照对

- `tests/components/note-viewer.test.tsx` 新增用例（这是全仓第一处「冷缓存懒加载」时序测试）：
  1. 首渲染：`getAttachment` 对目标 ref 返回 `undefined` → 快照 1 断言时间线卡片 `has-images` 数为 0（复现 bug 现场）；
  2. 附件「解析完成」：同一 `getAttachment` 改为返回附件对象，`attachmentVersion` prop +1（模拟 `setAttachmentVersion`）→ 快照 2 断言卡片出现缩略图（`<img>` src 为 data URL）；
  3. 同场景断言 `imageCoverage` 口径（经体检面板 info 行文本）从「0/N」恢复为「N/N」。
- 断言点：卡片 `data-timeline-at` 定位 + `timeline-thumb` 数量 + origin 徽标（`引用画面`/`临近画面`）。
- 设计约束：测试夹具必须走「同一函数先 undefined 后数据 + version prop 推进」的形态，**禁止**把被测时序改成同步直返来造绿灯。

### 批3 问题2 主修：v0.7.13 Release 补传 latest.yml（对外动作，**待 Andiii 批准后执行**）

- 本地 `release/latest.yml` 已核对：`path/url/sha512/size` 与已上传的 `Flash.Summary.Setup.0.7.13.exe` 完全匹配、文件名就是 GitHub 规范化后的资产名，直接上传无歧义。
- 命令（批准后由我执行，或 Andiii 在 Release 页手动上传同一文件）：
  ```bash
  cd "E:\SEU summary" && gh release upload v0.7.13 release/latest.yml
  ```
- 上传后即时自验（只读）：`gh api repos/Andiii208/flash-summary/releases/tags/v0.7.13 --jq '.assets[].name'` 应列出两个资产；并可让 Andiii 装机点一次「检查更新」，预期「已是最新版本 0.7.13」。
- 风险与边界：给既有 Release 追加资产不影响已下载用户；不动 tag、不动已有 exe；此动作只读校验通过、可回滚（`gh release delete-asset` 可删）。

### 批4 问题2 流程修正：scripts/release.md

- §3 产物清单补一项：`release/latest.yml`（与 Setup exe 同次构建生成，文件名必须**正好** `latest.yml`）。
- §5 发布命令改为两个资产一起传：
  ```bash
  gh release create vX.Y.Z "release/Flash Summary Setup X.Y.Z.exe" release/latest.yml --title ... --notes ...
  ```
- §发布 checklist 增一行（发布后只读自检）：
  ```bash
  gh api repos/Andiii208/flash-summary/releases/tags/vX.Y.Z --jq '.assets[].name' | grep -x latest.yml
  ```
  没有这行输出即发布未完成，检查更新必然 404。
- 同步修正 2026-09-30 方案文档中「release.md 不变」的表述（改为「release.md 增加 latest.yml 上传步骤」），保持只有一个现役答案。

### 批5 问题2 呈现：错误分类友好化（日志保真、UI 可读）

- `src/main/update.ts`：`check()` 的 catch 分支把上游异常分类——
  - 网络/feed 类（HttpError 404/5xx、连接失败）：返回用户可读短句，如「暂时无法检查更新：发布服务器没有返回更新信息，请稍后重试或到项目发布页查看」；**不出现堆栈、不出现内部 URL 拼装细节**。
  - 原始 message（含 URL 与堆栈）写进日志（`src/main/logger.ts`，已有日志通道），保留诊断能力。
  - 未知异常仍返回短句 + 日志详文。
- `src/renderer/components/UpdatePanel.tsx:50`：文案兜底逻辑不变（`message ?? 默认`），配合批5 的短句即可读。
- 新增用户可见承诺为零：只改错误呈现措辞，不新增句式承诺；DISCLAIMER 文本版本不动。
- 测试（`tests/update.test.ts`）增补：注入抛 HttpError 404 的假 updater → 断言返回文案不含 `HttpError`/不含 `at createHttpError`；断言原始 message 被写入日志（可对 logger 打桩计数）。

### 批6 收尾：门禁、文档、账号

- 五门禁（lint / typecheck / test / build / smoke）全绿；批3/批4 是发布流程与资产动作，不涉桥面，不动 smoke EXPECTED_BRIDGE；批5 若改了 IPC 返回结构才跑 smoke（方案保持结构不变，只改文案内容）。
- `CHANGELOG.md` `[未发布]` 记两条（穿插回归修复、更新检查 404 修复与发布流程补 latest.yml）；`PROGRESS.md` 台账；README 计数同步。
- 版本号：代码改动进 `[未发布]`，不单独 bump——穿插修复随下次发布到用户手；latest.yml 补传让**当前** 0.7.13 的更新检查即刻恢复。若 Andiii 希望快点拿到穿插修复，可在本批后直接走一次 0.7.14 发布（决策点 D6）。

## 4. 影响面评估

- **不碰**：note_json 数据结构、prompt、PDF 讲义、Obsidian/Anki/SVG/PNG 导出、抽帧管线、app-update.yml 生成逻辑、IPC 契约（批5 只改文案不改结构）。
- **存量笔记**：零损失，切视图即恢复（见 §1.6）；本修复后打开即正确，无需重生成。
- **存量用户**：0.7.10–0.7.13 所有版本生成的笔记在详细视图首屏都会踩该 bug（只要不切视图）；修后发版即愈。
- **D1 决策**（memo 补依赖 vs 去 memo）不影响其它行为；补依赖方案对 0.7.9 及更早版本的渲染结果逐字节兼容（最终态分配一致）。

## 5. 测试计划汇总（只增不减）

| 测试文件 | 新增 | 要点 |
| --- | --- | --- |
| `tests/components/note-viewer.test.tsx` | +2~3 例 | 懒加载冷启动快照对：先 undefined 后数据 + version 推进 → 卡片出图；imageCoverage 口径恢复；本地态（展开引文）交互后分配不丢 |
| `tests/update.test.ts` | +1~2 例 | HttpError 404 → 友好文案（无堆栈）；原始 message 进日志 |
| 其余 | 0 | 不改 |

门禁基线（2026-10-01 实跑收口）：1599 + note-viewer 懒加载时序 3 + update 净 2（原「透传原文」断言按新契约改写为脱敏断言）= **1604 passed / 144 files**；README 三处计数已同步。

## 6. 门禁与验收

- 每批后：`npm run lint && npm run typecheck && npm test`。
- 收尾：五门禁（+ build + smoke；本方案不动桥面，smoke 维持 41/41 预期）。
- 装机验收（给 Andiii）：
  1. 打开**存量** B 站课时笔记（不切视图）→ 时间线卡片直接有穿插图（不需切 tab 自愈）；
  2. 重新生成/新导入一个 B 站视频 → 完成后直接看详细笔记 → 首屏即穿插；
  3. 设置页点「检查更新」→ 「已是最新版本 0.7.13」；断网点一次 → 友好短句而非堆栈；
  4. 体检面板不再误报「时间线均无配图」。

## 7. 决策点（请 Andiii 裁）

- **D1 memo 修法**：A 补 `attachmentVersion` 依赖（**推荐**——保留 P32 性能初衷、最小改动、与同文件 coverSrc 口径一致）｜B 去掉 memo 逐渲染重算（更简单但回退 P32）。
- **D2 latest.yml 补传执行方**：A 批准后由我执行 `gh release upload`（**推荐**——文件已本地核验匹配）｜B Andiii 在 Release 网页手动上传。
- **D3 更新失败是否给出路**：A 只友好文案、打日志（**推荐**——不加外部入口按钮，避开「外部网址只能经 main 侧固定常量 IPC」红线）｜B 增 `settings:openReleases` 固定 IPC + 「打开发布页」按钮（多一处桥面、需 smoke）。
- **D4 release.md 自动化深度**：A 改命令 + checklist 一行（**推荐**）｜B 另写 `scripts/verify-release-feed.mjs` 发布前自动校验（更重）。
- **D5 同型波及面**：A 只修已实锤的两处 + 一个回归测试（**推荐**）｜B 全仓审计所有「懒加载谓词 + useMemo」组合（时间换覆盖）。
- **D6 发版时机**：A 代码进 `[未发布]`，穿插修复随下次发布；latest.yml 补传即刻恢复当前版更新检查（**推荐**）｜B 本批后直接 bump 0.7.14 发布（穿插修复尽快到用户手，多一次发布流程）。
