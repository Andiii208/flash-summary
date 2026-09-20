# 方案：UX 问题整改（2026-09-20）

> 状态：**批1–批4 已落地（2026-09-21；批4 曾被脚本门禁的一次时序抖动误判为红，实测 HEAD 全绿 lint 0 / tsc 0 / 1362 测试）；补批（P25 模型设置两项化）已落地（2026-09-21，`1f07182` docs spec 先行 + `a6465b5` refactor，四门禁 1365/1365 + build + smoke 37/37）；批5、批6 待执行**。v2：按第 2 轮评审意见修订；v3：按第 3 轮评审补全 notes:latest 测试消费方；v4：按终审补 preload 改动点与批 6 探针扩展；v5：补入第 6 项反馈「窗口最大化右侧空白」（P24，本次会话 `ui-probe` 实测取证）；v6：按 Andiii 订正把 ASR 预设与提示文案改成只留小米 MiMo（见 §6）；v7：批 1 实现后评审补口——P20 的「不覆盖」在全仓范围内只冻结了一个 writer，任务侧 catalog refresh 是第二个（见 §6）；v8：补入 Andiii 第 3 项原话的剩余部分「三选项改两项」（P25 + 补批，见 §6）。（修订记录见 §6）。
> 触发：Andiii 第 1 轮试用反馈——25 条已确认问题，覆盖九个面：视频封面 / 笔记体检与补全 / 模型设置与新用户引导（含两项化）/ 我的学习全屏展开 / 思维导图板块排版 / 窗口最大化右侧空白 / 渲染层全站普查 / 主进程任务链路普查 / 模型设置两项化（P25，补批）。
> 取证方式：本方案每条根因都已逐条打开源文件核对（下文 `file:line` 均为本次会话实读；第 1 轮审查材料中未逐条复核的少数条目已标注来源）。第 2 轮评审给出的 7 条意见（B1–B7）亦已逐条打开源文件复核，复核结论并入 §6。
> 排序原则（按 Andiii 要求）：**先修功能不可用/失败 → 再修引导与信息架构 → 再修观感与布局**。
> 总盘子：**6 批**覆盖全部 24 条；每批拆成一个或多个小而聚焦的 Conventional Commit；批批过四门禁（`npm run lint` + `npm run typecheck` 双 tsc + `npm test` 全量）；动了桥面（`src/shared/bridge.ts` / preload / `ipc.ts` 返回结构）的批加跑 `npm run smoke`；改 renderer 样式/布局的批加跑 `npm run build` + 实拍（`scripts/ui-probe.mjs` / `scripts/ui-shots.mjs`），关键数字写进提交信息。
> 铁律遵守：唯一设计规格 `docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md`（新增用户可见行为承诺先落 spec 再写实现，见批2 第 0 步）；排版唯一事实源 `docs/skills/ui-layout/SKILL.md`（宽度断点只有 1180/1024，间距/行高/字距只取 token，padding 走基线 allowlist 只减不增，基元表随实现同步更新）；busy 一律「文案加省略号 + disabled」+ hook 侧 in-flight 守卫；模态层统一 `ui/Dialog` 或照抄既有自绘弹层三件套（`useModalScrollLock` + focus trap + Esc）；笔记字段用户可见文本经 `MdLite`/`InlineText`；测试只增不减；不改 `name`/`appId`/userData；**零新增运行时依赖**（封面补取复用现有 B 站客户端）；每阶段结束在 `PROGRESS.md` 记录。

---

## 0. 结论先说

24 条里没有「项目烂」型问题——底子（DPAPI、参数化 SQL、openExternal 红线、迁移原子性）仍在。问题集中在三类：

1. **两条「点了没反应 / 数据没了」的硬伤（本方案唯二 high）**：重新收割一门课会把「本次没收割到」的课时连同笔记/转写/关键帧永久删掉（`ipc.ts:539-545` + 六级联删）；全屏课程浏览器里点「导图」，弹层被浏览器本体遮住，用户点了没有任何可见反应（`App.tsx:292` vs `:324`，三个自绘 overlay 同为 `z-index: 40`）。这两条放批 1，先修。
2. **笔记链路「只会重新生成、不会补上」**：体检 warn 后唯一行动是全量重生成（发图重跑、存新版本）；返修能力（`repairOnce`）只对刚生成的稿内部触发一次，对已存盘笔记没有入口；批量升级把每课失败原因整段丢弃、成功后不刷新当前屏、重试会重跑已成功课时。这是 Andiii「应该是补上而不是重新生成」的正面对峙，放批 2（含 spec 先行）。
3. **观感与信息架构**：思维导图是五个视图里唯一破格正文列宽的（640 → 860），且画布元素盒不随缩放导致常驻横向滚动条；新用户引导默认只勾 ASR 且 ASR 模型被故意留空，「一键保存」后管线仍不可用；窗口一放大到宽屏，右侧就空出 1372–1592px 白屏（定宽正文列撞宽屏，解法待 D12 拍板）。分别放批 4（引导）与批 6（布局）。

**没有 schema 变更**：本方案 24 条全部落在既有表/列之上（`lessons.cover_path` 迁移 012 已存在），不需要新迁移。

### 问题 → 批次对照

| # | 问题 | 严重度 | 批次 |
|---|---|---|---|
| P20 | 重新收割 DELETE 连带删除带笔记课时 | high | 批1 |
| P13 | 课程导图弹层被全屏浏览器遮住 | high | 批1 |
| P21 | 任务运行中改缓存目录无守卫 | medium | 批1 |
| P2 | 无「按 findings 定向补全」通道 | medium | 批2 |
| P3 | 返修复检前后口径不一致（虚假 toast） | medium | 批2 |
| P4 | 批量升级失败原因被丢弃 | medium | 批2 |
| P5 | 批量升级成功不刷新当前笔记 | medium | 批2 |
| P6 | 升级重试把已成功课时再跑一遍 | medium | 批2 |
| P7 | 查看器徽标与升级列表体检结论不一致 | medium | 批2 |
| P17 | 「升级旧笔记」按钮无在途态、无守卫 | medium | 批2 |
| P22 | 超时话术把用户引向错误方向 | medium | 批3 |
| P23 | Obsidian 整课导出失败计成「跳过」且无日志 | medium | 批3 |
| P1 | B 站封面导入时静默失败、无回填入口 | low | 批3 |
| P8 | 新用户引导断点（默认只勾 ASR、模型留空） | medium | 批4 |
| P14 | 取消勾选能力不解绑 | medium | 批4 |
| P9 | 「我的学习」没有全屏展开入口 | medium | 批4 |
| P18 | paragraph 块纯文本插值、tldr 不过 markdown 判据 | low | 批5 |
| P19 | 知识结构树 a11y 残缺 | low | 批5 |
| P15 | 扫码等待期间主按钮恢复可点、重新取码废掉已扫码 | low | 批5 |
| P16 | 导图搜索零命中无反馈 | low | 批5 |
| P10 | 思维导图正文列破格 640 → 860 | low | 批6 |
| P11 | SVG 元素盒不随缩放 → 常驻约 49px 横滚 | low | 批6 |
| P12 | 导图画布在笔记页无确定高度、无内滚 | medium | 批6 |
| P24 | 窗口最大化后右侧大片空白（定宽正文列撞宽屏） | medium | 批6 |
| P25 | 模型设置仍是三个选项，Andiii 要求「只留 ASR 与多模态两项」 | medium | 补批 |

---

## 1. 背景与问题清单

### 1.1 视频封面（P1，low）

- **用户现象**：B 站导入的课时有时没有封面；更早导入的课时「永远」没有封面；失败时界面和日志都不提一个字。
- **根因**（三层全吞 + 无回填）：
  - `src/main/ipc.ts:436-445`：封面只在导入时抓一次——`fetchImageAsDataUrl(view.coverUrl).catch(() => null)`（:437），失败即静默放弃；紧邻的导入日志 `ipc.ts:446` 只有 `bilibili import: course pages=N`，不含封面成败。
  - `src/main/notes/cover.ts:40-51`：`saveLessonCover` 任何失败返回 null（不抛）——设计上正确（不能弄坏导入），但没有任何调用方知道它失败了。
  - `src/main/notes/attachments.ts:74-86`：`readLessonCover` 文件丢失/超限 catch 返回 null，退化成「最早关键帧兜底 → 随机帧」。
  - `src/main/db/migrations/012_lesson_cover.ts:13`：迁移只 `ALTER TABLE lessons ADD COLUMN cover_path`；仓库内 grep 不到任何回填脚本或独立写入 IPC（`saveLessonCover`/`cover_path` 全仓仅 `ipc.ts:26,439-442` 与 cover/attachments 两模块）——012 之前导入的 B 站课时永远没有封面。
- **影响面**：笔记首屏（`NoteViewer` masthead 封面 banner）对一部分 B 站课时退化成随机关键帧；用户无法区分「平台没给封面」和「我们抓失败了」。

### 1.2 笔记体检与补全（P2/P3/P4/P5/P6/P7/P17，medium）

- **P2 用户现象/原话**：体检报 warn 后唯一按钮是「重新生成此笔记」——Andiii：「应该是补上而不是重新生成」。
  - **根因**：`src/renderer/components/NoteViewer.tsx:391-395` 的 warn 行动按钮 → `App.tsx:595` `onRegenerate`（第 1 轮材料）→ `use-notes-domain.tsx:444` `bridge.notes.regenerate(lessonId)` → `ipc.ts:1664-1683` 全量重生成（`loadSummarizeInputs` 重新读图+转写、`generateNote` 发图、`saveNoteVersion` 存新版本）。真正的定向返修 `repairOnce` 只在 `summarize.ts:508-528` 对「刚生成的稿」调用一次；全仓 grep `repair` 只有 `summarize.ts` 内部与 `use-notes-domain.tsx:478-482` 的 toast 文案，**不存在能对已存盘笔记单独触发返修的 IPC 通道**。
- **P3 用户现象**：toast 报「体检 2 项 → 0 项」，但那条 warn 实际还在笔记里。
  - **根因**（口径不一致）：`summarize.ts:504` 返修前 `warnCountBefore = noteHealth(note, hitRate, transcriptHitRate).warnCount`（含证据/转写命中率）；`summarize.ts:352` `repairOnce` 返回 `warnCount: noteHealth(clamped).warnCount`（只按笔记形状，不带任何命中率）；`summarize.ts:520` 用 `attempt.warnCount < warnCountBefore` 判定采纳；`summarize.ts:545-551` 最终 health 直接取 attempt 的形状口径值、grade 用 `noteHealth(note).grade`。只差命中率的笔记也会触发一次返修并被判「成功」（返修不发图，见 `summarize.ts:306-308` 注释，修不掉命中率），代价是一次完整模型调用 + 笔记被整篇改写。
- **P4 用户现象**：批量升级后只看到一行「失败」——是任务占用、未绑模型、超时还是转写缺失，无从得知（Andiii 说的「试用失败」很可能就这么看不见原因地发生）。
  - **根因**：`use-notes-domain.tsx:562-569` `if (res.ok) { done.add } else { failed.add }`——`res.error` 从未被读；`NoteUpgradeDialog.tsx:89` 只渲染 `status === 'failed' ? '失败' : ''`；`use-notes-domain.tsx:576-578` toast 仅「N 个课时失败（可重试）」。而 `ipc.ts:1671/1675/1678` 的守卫是全局性的（队列占用/在途），一个 guard 失败会让整批每课都以同一隐藏原因失败。
- **P5 用户现象**：升级成功后停在被升级的那一课时，看到的还是旧版本和旧体检徽标，很容易读成「没生效」。
  - **根因**：单条路径成功后 `await loadNote(lessonId); await loadNoteIndex()`（`use-notes-domain.tsx:483-484`）；批量路径结尾只有 `await loadNoteIndex()`（`:571`），从不调 `loadNote`；`state.note` 只由 `loadNote` 更新（第 1 轮材料，`:162`），`NoteViewer` 的 note 与徽标因此停留在升级前版本。
- **P6 用户现象**：升级失败后点「重试」，已经成功的课时被再跑一遍全量多模态生成——白烧钱、多存一个新版本。
  - **根因**：`NoteUpgradeDialog.tsx:62` `onConfirm={() => onRun([...selected])}` 传整个 selected；已完成课时只是 checkbox 被禁用（`:80` `disabled={busy || status === 'done'}`），并未从 selected 中移除（toggle/全选/reseed 逻辑 `:42-52` 均不裁剪 done 项）；批量跑完 `busy=false`、confirm 重新可用（`:60`），再点一次即对 done 集合同样调用 `bridge.notes.regenerate`（`use-notes-domain.tsx:562-569`）。
- **P7 用户现象**：同一份笔记，查看器写「体检：良好」，升级列表里写「待改进 · N 项」。
  - **根因**：`NoteViewer.tsx:235` `noteHealth(note, hitRate, null, imageCoverage)`（`transcriptHitRate` 传 null）；`ipc.ts:1337-1338` `noteHealth(note, hitRate, transcriptHitRate)`。`transcriptFindings` 是 warn 级（`src/shared/notes/health.ts:235-245`），只在 main 侧算得出来（渲染层没有转写）。
- **P17 用户现象**：连点两次「升级旧笔记」会并发拉两次课程体检，晚到的覆盖先到的。
  - **根因**：`NoteLibrary.tsx:117-128` 按钮无 `disabled`、无「读取中…」文案（同排「导出 Obsidian」至少 `disabled={exportBusy != null}`，`NoteLibrary.tsx:105-116`）；`use-notes-domain.tsx:529-543` `openNoteUpgrade` 直接置 loading 后并发 `bridge.notes.courseHealth(courseId)`，无 in-flight 守卫。

### 1.3 模型设置与新用户引导（P8/P14，medium）

- **P8 用户现象/原话**：新用户保存成功后笔记管线仍不可用，错误要到建任务时才以 toast 出现——Andiii：「引导他配置模型」要对峙的核心体验断点。
  - **根因**：`ProviderPanel.tsx:215-216` 初始 `capabilities = new Set(['asr'])`、`models.asr = ''`；`:243-245` 注释自述「A freshly checked ASR starts empty on purpose」；`:233` 切预设只回填 `multimodal`/`text` 两个模型，不回填 asr；`:248-265` 的 `submit()` 与 `:285-289` 的 `canSave` 只校验非空——asr 勾着却空着时保存被**静默**拒绝（`submit()` 直接 return，按钮 disabled 但没有任何原因说明）。用户保存成功后缺 multimodal，直到 `use-tasks-domain.ts:108-119`（第 1 轮材料）才 toast「尚未绑定多模态总结模型…去设置」。
  - 与 spec 的关系：`spec §4` 已写明「The first-run experience recommends a single provider that supports both ASR and multimodal input」——当前默认勾选与 spec 推荐相反，属「声明与实现漂移」，修它是对齐而不是扩边界。
- **P14 用户现象**：编辑已存在的 Provider 时取消勾选某能力，保存后列表里仍显示该能力绑定、任务管线仍在用它——用户以为已经关掉了。
  - **根因**：`ProviderPanel.tsx:252-262` `submit()` 只把勾选的 capability 交给 `onSave`；`use-config-domain.ts:109-118` 只对 `input.capabilities` 逐个 `bridge.providers.bind(...)`，没有任何解绑动作；`src/shared/bridge.ts:123-131` 的 `ProvidersBridge` 只有 `save`/`remove`/`bind`/`test`，没有 unbind。于是 `ProviderPanel.tsx:89-102` 的 `ProviderRowView` 仍渲染全部绑定，取消勾选对界面与行为都无效果。

### 1.4 我的学习全屏展开（P9，medium）

- **用户现象**：「我的学习」没有任何可展开的入口、状态或模态挂载点——不是改造，是新增三处；但「全部课程」那条链路可以逐段照抄。
- **根因/现状**（已核对）：`courseBrowserOpen` 的完整实现 = 状态 `useState(false)`（`App.tsx:184-185`）+ close 回调（:185）→ Ctrl+K 开关 effect（`App.tsx:227-241`）→ `<CourseBrowser>` 挂载（`App.tsx:324-336`，关闭时组件整体返回 null，`CourseBrowser.tsx:143`）→ 侧栏入口按钮（`App.tsx:444-452`，`class="course-browser-open"` 在 :445、`data-testid` 在 :446）。而 `MyStudyPanel` 是纯聚合展示组件：props 只有 mine/extracted/sameCourses + CourseTree 回调（`MyStudyPanel.tsx:7-28`），渲染只有 h3 + 三个 StudyGroup（:103-130），既无 open prop 也无 entry button；`App.tsx` 里 grep 不到任何 `myStudyOpen` 状态。全屏化 = 复制「状态 / 快捷键 / 挂载」三件套，入口按钮挂在「我的学习」标题旁（`App.tsx:417-430` 的 MyStudyPanel 外侧）。

### 1.5 思维导图板块排版（P10/P11/P12）

- **P10 用户现象/原话**：点「思维导图」tab 时内容列从 640 突然撑到 860，板块瞬间宽出 220px——「没跟前面几个板块保持一致、溢出了」。
  - **根因**：`src/renderer/style.css:2161-2166` `.note-body { max-width: 640px }`（SKILL §6 的阅读列铁律）vs `style.css:2167-2168` 注释自称「导图视图破格：吃满内容区宽度」+ `.note-body[data-view='mindmap'] { max-width: none }`。五个视图（`src/renderer/labels.ts:32-38`）里导图是唯一破格。实测（第 1 轮探针）：详细视图 noteBody w=640、导图态画布 clientW=859。
- **P11 用户现象**：画布内常驻约 49px 横向滚动条，「适应窗口」把图缩到装得下也消不掉它。
  - **根因**：`MindMap.tsx:504-508` `<svg width={frame.width} height={frame.height} viewBox={…frame.width / view.scale…}>`——元素盒永远等于布局原宽（实测 892px），缩放只改 viewBox 不改元素盒；`style.css:1980` `.mindmap-scroll { overflow: auto; padding: 8px }` → 892+16=908 > 容器可视 859，常驻横滚。第三份复现（临时页复刻同套 CSS + 892×1028 尺寸，Chromium 量测 `scrollW=908 vs clientW=859`，`overflowX=49`）已实证。
- **P12 用户现象**：导图画布在笔记页没有确定高度，画布连同工具栏一起走页面级滚动，工具栏被滚出视口；「适应窗口」的竖直半边在此宿主是空转。
  - **根因**：`style.css:2038-2039` 只有课程导图弹层宿主（`.course-map-card`）有 `.mindmap-wrap .mindmap-scroll { flex:1; min-height:0 }` 的确定高度；笔记宿主（`.note-body` 内）无高度规则，容器高度被 SVG 内容撑起（实测 1052≈1028+16）。`MindMap.tsx:204-216` `fitToViewport` 用 `el.clientHeight`，在自撑高的宿主上量到的是内容高度而非视口高度。两个宿主尺寸策略不一致。

### 1.6 渲染层全站普查（P13/P15/P16/P18/P19）

- **P13（high）用户现象**：在全屏课程浏览器里点课程卡的「导图」图标，没有任何可见反应——弹层既看不见也点不着。
  - **根因**：`App.tsx:292` 先渲染 `{state.courseMap != null && <CourseMapDialog …/>}`，`App.tsx:324` 之后才渲染 `<CourseBrowser …/>`；三个自绘 overlay 同为 `position: fixed; inset: 0; z-index: 40`（`style.css:862` `.course-browser-overlay`、`style.css:2025` `.course-map-overlay`、`style.css:2412` `.bili-dialog-overlay`），层级相同则由 DOM 顺序决定，后出现的 CourseBrowser 盖住地图弹层（共享确认弹层 `.dialog-backdrop` 是另一档 `z-index: 60`，`style.css:932-939`，不参与这层竞争）。`CourseBrowser.tsx:347-357` 的导图键只调 `onCourseMap(course.id)`，不会先 `onClose()`；而 Esc 两个弹层都监听（`CourseBrowser.tsx:92-97`、`CourseMapDialog.tsx:28-33`），一次 Esc 同时关两层。
- **P15 用户现象**：扫码等待期间「扫码登录后导入」主按钮恢复可点，再点一次会重新取码覆写 qrcodeKey——手机上那张已经扫过的码就此失效，界面还停在「等待扫码…」。
  - **根因**：`BiliImportDialog.tsx:205-208` `finally { setBusy(false); setBusyKind(null) }` 之后按钮条件只剩 `disabled={busy || preview == null || preview.selected.length === 0}`（`:322`），`loginPhase === 'qr'` 未纳入；`onImportClick`（`:211-223`）在未登录时又走 `startLoginFlow()`。而 `bilibiliLoginStart` 会整体替换 `bilibiliQr = { qrcodeKey: qr.qrcodeKey }`（`src/main/app-context.ts:409-416`），轮询改盯新 key，旧码扫了也不会 confirmed。
- **P16 用户现象**：导图搜索框输入一个不存在的节点名时界面毫无变化，用户会以为搜索功能坏了。
  - **根因**：`MindMap.tsx:394` `const searching = matched.size > 0`——零命中时 `searching` 为 false，`:574-582` 的行既不点亮也不变暗，全部节点原样渲染；工具栏与画布都没有零命中提示。对照 `CourseBrowser.tsx:265-266` 与 `CourseTree.tsx:50` 的零命中空态（第 1 轮材料），导图是全站唯一没有零命中空态的搜索。
- **P18 用户现象**：笔记里会印出字面反引号或字面星号（违反「笔记字段一律经 MdLite/InlineText」约定）。
  - **根因**：`NoteBlocks.tsx:43` `case 'paragraph': return <p class="note-para">{block.text}</p>`（纯文本插值；同文件 markdown 分支走 `<MdLite>`）。`src/shared/notes/views.ts:135-139` `looksLikeMarkdown` 判据是标题/列表 + `/\*\*[^*]+\*\*/` + `hasTable`，不认行内代码（`src/shared/notes/md-lite.ts:41` 的 `parseInline` 在 `:49` 有 code 分支）；`views.ts:148` 与 `:172` 的 tldr 直接 `{ block: 'paragraph', text: note.tldr.trim() }`，从不做 markdown 判定。
- **P19 用户现象**：读屏用户听到「树」却得到一堆无结构内容。
  - **根因**：`NoteBlocks.tsx:196` `<div class="tree-view" role="tree">`；`:220` 只有 `depth === 0` 的标题是 `treeitem`，子行（`:226-230`）无任何 role/aria-level；`:218` `aria-expanded` 挂在 `<button class="tree-toggle">` 上而不是树项上。全仓 `role="treeitem"` 仅命中这一处，也无测试钉住。

### 1.7 主进程任务链路普查（P20/P21/P22/P23）

- **P20（high）用户现象**：只是点开/刷新某门课，之前辛苦生成的笔记就可能从笔记库消失——全程无提示、无确认。
  - **根因**：`ipc.ts:539-545` `DELETE FROM lessons WHERE course_id = ? AND id LIKE ? AND id NOT IN (keepIds…)`——只要本次 harvest 返回的集合比库里小，多出来的行直接删。`lessons` 是各证据表的父表且全是 `ON DELETE CASCADE`（`001_initial.ts:34` tasks、`:51` transcripts、`:60` ppt_pages、`:71` keyframes、`:82` notes、`:95` qa；`src/main/db/open.ts:10` `foreign_keys = ON` 确认级联真的生效）。触发条件并非罕见：① `play-harvest.ts:321-322` 的目录脚本只在读到视频流后跑一次、不做稳定轮询，SPA 列表晚渲染就是部分列表；② `play-harvest.ts:110` 只收 1–40 字且含「第N节」的文本；③ `ipc.ts:536-538` 注释自述「平台列表会随新课时漂移」。对照 `removeCourse` 专门立了「该课程已有笔记，为保护数据不允许删除」（`ipc.ts:673-675`），同一条纪律在这条路径上完全缺失。较轻的必然后果：序号漂移时存活行的 title/play_ref 被 upsert 覆盖（`ipc.ts:529-535`），笔记还挂在行上但行名已变成另一节课。现有测试 `tests/ipc.test.ts:333-334`（第 1 轮材料）只钉了「旧行 c1-L9 被删」，没有任何「带笔记的行必须保留」的断言。
  - **第二个 writer（2026-09-21 实现后评审补口，v6）**：同一份「课时目录」在任务侧还有一条写路径——`src/main/tasks/orchestrator.ts` 的 `fetching_course`「Catalog refresh」对本次收割到的**每个** entry 无条件 `ON CONFLICT(id) DO UPDATE SET title, play_ref, fetched_at`。它在 `courseRow.tecl_id/tecl_code` 非空时运行，即**每一次 SEU 课时的任务运行**都会把整门课的行名/ref 按平台当前索引重写一遍（该 upsert 自 e39cedfa 2026-09-02 起就在，本方案 §1.7 与 §2 1.1 初稿都没点名它）。只冻结 `school:harvestLessons` 等于没冻：收割刚冻结完，下一次任务运行就把它踩回去。后果不止「行名变成另一节课」——`play_ref` 正是 play 页用来点「第N节课」的 ref（`orchestrator.ts` 的 `selectLessonRef: lessonRow?.play_ref ?? null` → `play-harvest.ts` 的 `selectLessonRef`），被漂移覆盖后，下一次对该行跑任务会去抓**另一节课**的流并写回这一行。处置见 §2 1.1 的第四条落点。
- **P21 用户现象**：任务运行中改缓存目录，产物被劈到新旧两个目录，旧目录里几 GB 的视频/音频成为永远没人回收的磁盘孤儿，界面上看不出来。
  - **根因**：`ipc.ts:851-863` `settings:setCacheDir` 只做 UNC 拒绝 + `assertWritable`，没有像 `chooseLibrary`（`:879-884`「有任务在运行、排队或未完成，请先取消或清理任务后再迁移」）那样的在跑任务检查。而 cacheDir 是每次调用重读的设置（`app-context.ts:157`，第 1 轮材料），`orchestrator.ts:94-98`（第 1 轮材料）的 taskDir 每次调用都重新 join——同一任务的不同 stage 可能落在不同根下；`cleanStaleCache` 只 readdirSync 当前 cacheDir（`cache-clean.ts:49-65`，第 1 轮材料），tasks:delete 与 clearFinished 也只 rm 当前 cacheDir 下的任务目录（`ipc.ts:1090-1091`、`1114-1116`，第 1 轮材料）。
- **P22 用户现象**：生成/转写超时被翻译成「校园网可能较慢或服务暂不可用」——把用户引向错误方向（去查代理与 DNS），真正该做的（换更快的模型、缩短视频、减少图片）一句都没提。
  - **根因**：`src/shared/errors.ts:13` `[/ERR_TIMED_OUT|ETIMEDOUT|timeout/i, '连接超时——校园网可能较慢或服务暂不可用，稍后重试']`。而 `CHAT_TIMEOUT_MS = 600_000`（`src/main/providers/openai-client.ts:40`）撞墙时的原始信息是「The operation was aborted due to timeout」——`docs/plans/2026-09-19-note-experience-overhaul.md` §1.1（第 1 轮材料）实录「等了 10 分 34 秒，颗粒无收」，重跑 5 分 33 秒即成功；这条超时与校园网无关（provider 侧算得慢/请求过大）。
- **P23 用户现象**：整课导出 Obsidian 显示「导出 0 篇 / 跳过 N 篇」，用户以为那些课时只是没有笔记，而且连日志都不留。
  - **根因**：`src/main/notes/obsidian-export.ts:154-162` `try { exportLessonToObsidian(…) ; exported++ } catch { skipped += 1 }`——catch 是空的，错误文本既不返回也不落日志；`ipc.ts:1381-1393` 原样透出 `{exported, skipped}`。于是 vault 落在 OneDrive 同步目录/只读位置时，N 篇全部「跳过」，`:163` 的 `if (exported > 0)` 还会连索引都不重建。

---

### 1.8 窗口最大化右侧空白（P24，medium）

- **用户现象**：窗口右上角放大到宽屏后，「右边的逻辑会让右边完完全全空出来，是白屏」；用户提议「怎么解决，或者直接能够等比例放大，保持视觉的统一性」。
- **根因**（不是窗口/BrowserWindow 缺陷，是定宽正文列撞上宽屏）：
  - 布局链：`#app/.app-shell`（`style.css:324`，100vh flex column）→ `.app-main`（flex row：`.sidebar` 304px + `.content` flex:1）→ 面板定宽 `.task-panel/.qa-panel/.note-viewer { max-width: var(--content-max) }`（`style.css:581`，`--content-max: 860px` 定义在 `:58`）、正文列 `.note-body { max-width: 640px }`（`:2161-2166`）。面板不随窗口生长，空白全部堆在内容区右侧。
  - **实测取证**（本会话实跑 `node scripts/ui-probe.mjs --width=2560 --out=.ui-shots/probe-wide.json`）：视口 2560 时 `.content` 宽 2256（左 304 → 右 2560），而 `.note-viewer` 仍 860（右缘 1188）、`.note-body` 仍 640（右缘 968）——右侧分别空 **1372px / 1592px**；任务历史 `.history-row` 同样恒 860（六行全 860）。即宽屏下所有内容页只用到约四成宽度。对照默认窗 1266：面板右缘 1188、内容右缘 1266，只差 78px——所以观感是「一放大就出现，且随屏宽线性恶化」。
  - 不是回归事故：860/640 是 2026-09-18 排版整改「单一内容列」的既定决策（SKILL §6 把 640 钉为阅读排版铁律，实测 42.7 全角字/行）。要改的是**宽屏下的空间用法**，不是阅读列本身。
- **为什么第 1 轮漏了它**：该方向排查员报出 10 条，被分级员以「属既定排版决策、非缺陷」全部判为不进方案——判断本身有依据，但用户明确把它列为第 6 项体验问题，不能以「设计使然」结案；故本次会话实测复核后补入，并升格为决策项 D12 待拍板。

### 1.9 模型设置仍是三个选项（P25，medium）

- **用户原话（第 3 项的后半句）**：「你把当前的逻辑给改一下，直接改成 asr 语音转写模型和多模态模型这两个选项，不要设置成当前的三个选项」。
- **现状（实测）**：能力面仍是三项——`ProviderPanel.tsx:9` 的 `CAPABILITY_LABELS` 有 `text: '文本问答'`、`:10` 的 `CAPABILITY_ORDER = ['asr','multimodal','text']`、`:15-17` 的 `CapabilityNotes` 图例列三条；`src/main/providers/model.ts:19` 的 `Capability = 'asr' | 'multimodal' | 'text'`；`src/main/ipc.ts:119-121` 的 `requireCapability` 放行三值；`src/main/tasks/orchestrator.ts:43` 的 `chat(capability)` 形参含 `'text'`。
- **text 的唯一真实消费点**：`src/main/app-context.ts:570-573` 的 `qaCapability()`（`bindings.some(b => b.capability === 'text') ? 'text' : 'multimodal'`），由追问链路 `src/main/ipc.ts:1997` 取用。`orchestrator.chat()` 只在 `:604`（asr）与 `:823`（multimodal）被调用——**没有任何地方真的需要第三个能力**。
- **为什么第 1 轮漏了它**：模型设置排查员的指令里点名要查「text 能力的全部消费点与删掉后的替代路径」，但分级/成文时被并进 P8（首启默认值）与 P14（解绑），「三改二」本身没有独立条目。与 P24 同一类缺口（用户原话在方案里没着落），按 v5 的教训补为独立条目。
- **spec 冲突**：`docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md` §4 与 §211 把「text 模型绑定」写成产品承诺（「Advanced settings allow ASR, multimodal summarization, and text summarization to use different providers」「independent ASR, multimodal, and text model bindings」）——按声明层纪律，**spec 先行**：先改 spec 再改代码（见补批第 0 步）。

---

## 2. 分批实施计划

### 批1 — 数据保全与阻断性不可用（P0）

**目标**：消除两条「用户点了没反应 / 数据没了」的硬伤，堵住缓存目录迁移的磁盘泄漏。本批不动任何 IPC 契约，**不需要 smoke**。

**1.1 重新收割不再删除有产出的课时（P20）**
- 落点 `src/main/ipc.ts:528-546`（harvestLessons 的事务体）：
  - 事务内先算「受保护集合」：`SELECT DISTINCT l.id FROM lessons l WHERE l.course_id = ? AND (EXISTS(SELECT 1 FROM notes n WHERE n.lesson_id = l.id) OR EXISTS(… transcripts …) OR EXISTS(… keyframes …) OR EXISTS(… ppt_pages …) OR EXISTS(… tasks …) OR EXISTS(… qa …))`——六张表与 `001_initial.ts:34/51/60/71/82/95` 的级联清单一一对应。
  - DELETE 改为 `… AND id NOT IN (keepIds) AND id NOT IN (protectedIds)`；`keepIds.length > 0` 才删的现状保留（空收割仍不删）。
  - 序号漂移冻结：upsert 前取 protected 集合，protected 的行改用 `INSERT … ON CONFLICT(id) DO NOTHING`（title/play_ref 不被覆盖——否则笔记还挂在行上、行名已变成另一节课）；无产物行照常 upsert。旧 title → 新 title 的漂移记 `logger.info`。
  - 日志补三数：`harvestLessons: course=X entries=N dropped=K keptProtected=M`（dropped=本次真的删掉的空行数）。
  - **两个 writer 共用同一判定（2026-09-21 评审补口，v6）**：判定与写法收敛到新模块 `src/main/lessons/catalog.ts`——`protectedLessons(db, courseId)`（六表 EXISTS）、`upsertLessonCatalog(db, courseId, entries, fetchedAt)`（无产物行照常 upsert、有产物行 `ON CONFLICT DO NOTHING` 并返回漂移条目）、`describeCatalogDrift`（两条路径同一日志形态）。`school:harvestLessons` 与 `tasks` 的 `fetching_course` catalog refresh（`orchestrator.ts`）**都**走它；任务侧经新 dep `onCatalogDrift(courseId, drifted)` 把漂移交回 main 落 `task catalog drift (kept): course=X …` 日志（orchestrator 自己没有 logger，硬塞一个会动到它的 deps 面）。只冻结一条路径等于没冻（见 §1.7 P20 的「第二个 writer」）。
  - 测试（`tests/ipc.test.ts` 扩充，只增不减）：
    - 重收割返回更少课时时，带 notes 行的旧课时保留，且其 notes 行仍在（级联没触发）；
    - 无任何依赖行的旧课时仍被删（现有「c1-L9 被删」断言原样保留）；
    - 带笔记的课时 title 不被覆盖（漂移冻结），无产物行 title 照常更新；
    - 空收割仍不删任何行（现状钉住）；
    - **任务侧 catalog refresh 同款（2026-09-21 评审补口，v6）**：`tests/orchestrator.test.ts` 加一条——有产物的兄弟课时 title/play_ref 被冻结、空行照常跟随平台、漂移条目经 `onCatalogDrift` 交回（该用例在补口前实测为红）。

**1.2 课程导图不再被全屏浏览器遮住（P13）**
- 落点：
  - `src/renderer/App.tsx:332`：CourseBrowser 的 `onCourseMap={state.openCourseMap}` 改成本地 handler——`(courseId) => { closeCourseBrowser(); state.openCourseMap(courseId) }`（与「选课时先关浏览器再落选择」同惯例，见 `App.tsx:322-324` 注释）。关闭后 `CourseBrowser.tsx:143` 整体返回 null，遮罩自然消失。
  - `src/renderer/App.tsx:292`：`{state.courseMap != null && <CourseMapDialog …/>}` 移到 `<CourseBrowser>`（:324）之后渲染——三个自绘 overlay 同为 `z-index: 40`（`style.css:862` course-browser、`:2025` course-map、`:2412` bili-dialog），DOM 后者居上；这是防御性兜底（任何将来「浏览器开着打开地图」的路径都不会再被遮）。
  - **不改 z-index**：三个自绘 overlay 同为 40，单独抬高地图会破坏这组的既有均衡；共享确认弹层 `.dialog-backdrop` 是 `z-index: 60`（`style.css:932-939`），本批不碰。
  - Esc 双层同关的问题随之消解（浏览器已关闭，只剩地图弹层监听）。
- 测试（`tests/components/course-browser.test.tsx` 或 app-shell 扩充）：全屏浏览器开着时点课程卡「导图」→ 浏览器关闭、`role="dialog"` 的地图弹层可见；此后按 Esc 只关一层。

**1.3 缓存目录更换加在跑守卫（P21）**
- 落点 `src/main/ipc.ts:851-863`：照抄 `chooseLibrary`（`:879-884`）的守卫——`queue.members().length > 0 || unfinished.n > 0` → `err(new Error('有任务在运行、排队或未完成，请先取消或清理任务后再更换缓存目录'))`（unfinished 判定沿用 `state NOT IN ('succeeded','failed')`）。
- 测试（`tests/ipc-settings.test.ts`）：有未完成任务时 setCacheDir 返回 err 且文案含「任务」；无任务时照常成功（现有用例保留）。

**门禁**：四门禁全绿；本批不涉桥面，smoke 不适用（提交信息注明「未动桥面」）。
**提交**（3 个，小而聚焦）：
- `fix(data): 重新收割只删无产出课时，带笔记/转写的行保留且不被覆盖`
- `fix(ui): 全屏课程浏览器里打开课程导图先关浏览器，弹层不再被遮`
- `fix(settings): 任务在跑时拒绝更换缓存目录`

---

### 批2 — 笔记体检 / 返修 / 升级链路（P1）

**目标**：把「重新生成」这条唯一行动补上「按 findings 定向补全」；修掉返修复检口径；批量升级三连（失败原因 / 刷新当前屏 / 重试只跑未完成）；徽标同源；升级按钮加在途态。

**2.0 spec 先行（docs 提交，先于一切代码）**
- `docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md` §5 补批注（2026-09-20）：定向补全的行为边界——对**已存盘**的最新版笔记触发一次返修；**不发图片**（只带转写，多模态费用不翻倍）；**只跑一次**；warn 数（同口径，含证据/转写命中率）没有下降就**保留原稿、不存新版本**；入口在体检面板，与「重新生成此笔记」并列但语义不同。§9 无需新增条款（补全仍只把文本发给用户自己配置的 provider，§9 现有句子已覆盖）。
- 提交：`docs(spec): §5 补定向补全行为边界批注（返修入口 spec 先行）`。

**2.1 返修复检口径统一（P3）**
- 落点 `src/main/notes/summarize.ts`：
  - `repairOnce`（:313-353）新增入参 `evidenceRefs: ReadonlyArray<{ ref: string }>`（与 `evidenceHitRate` 第二参数同型，`src/shared/notes/evidence.ts:279-282` 只取 `.ref`）；返回值 `warnCount` 改为 `noteHealth(clamped, evidenceHitRate(clamped, evidenceRefs), transcriptRefHitRate(verified.stats)).warnCount`——与调用方 `:504` 同一个函数、同一组口径（命中率由返修稿自己的 stats 重算，不沿用旧值）。
  - **两份调用方传不同的 refs，且前后必须同源**：生成路径（`:510`）传「实际发过的图」（`inputs.images`，`summarize.ts:492` 的既有口径）；存盘补全路径（2.2）传 `loadValidRefs(db, lessonId)`（`src/main/notes/polish.ts:73-80`，与 courseHealth 的 `ipc.ts:1335` 同一份全量 refs）。**严禁给存盘补全传空数组**——`evidenceFindings` 在 `total === 0` 时返回空（`health.ts:218-220`），空 refs 会让证据命中率 warn 永远不出现，从而把「只差命中率」的笔记误判成返修成功（见 2.2 的闭环约束）。
  - 最终 `health.warnCount` / `grade`（:545-551）也用带命中率的口径（`grade: noteHealth(note, hitRate, transcriptHitRate).grade`），返修后 hitRate/transcriptHitRate 取 attempt 重算值。
  - 效果：只有形状 warn 被修掉时不再判「返修成功」，`use-notes-domain.tsx:478-482` 的「体检 N 项 → M 项」toast 从此说的是同一口径。
- 测试：`tests/notes-ipc.test.ts` 新增——笔记只有 1 条 evidence warn 时，返修把形状 warn 修掉但命中率 warn 仍在 → `repaired: false`、toast 不含「→」；命中率与形状同降时 `repaired: true` 且前后口径一致。

**2.2 定向补全通道 `notes:repair`（P2）**
- 落点：
  - `src/main/notes/summarize.ts`：导出新函数 `repairStoredNote(db, client, lessonId, libraryRoot, signal)`——读最新版笔记（与 `notes:latest` 同一查询）、`loadCleanSegments` + `formatTimedTranscript` 取转写（`loadSummarizeInputs` 同一份构造，**不读图片、零附件 IO**）、`loadValidRefs` + `transcriptHitRateFor` 算体检；warnCount=0 时**不调模型**直接返回「没有需要补全的问题」；否则复用 `repairOnce`，并把**同一份 `loadValidRefs` 结果**作为 `evidenceRefs` 传入（前置体检与返修复检因此同源——「只差证据命中率」的笔记返修后 warnCount 不变 → 不采纳、不存新版本、toast 说「补完没有改善，已保留原稿」，P3 的虚假 toast 不会以新形态复活）；采纳判据同 2.1；采纳才 `saveNoteVersion`（新版本）。复用 `claimNoteInflight(id, 'repair')`（与 regenerate/polish 共用在途登记，防 version 撞 UNIQUE）。
  - `src/main/ipc.ts`：新 handler `notes:repair`——守卫与 `notes:regenerate`（:1664-1683）一致（转写缺失 / 队列占用 / 该课时有在跑任务 / 在途登记），模型绑定取 multimodal（与 `summarizeLesson` 内返修同源），未绑定时报「未绑定多模态模型，请在设置中配置」。
  - `src/shared/bridge.ts` NotesBridge += `repair(lessonId)`，返回 `{ version, repaired, health: { warnCount, grade, warnCountBeforeRepair }, transcriptHitRate? }`；preload 同步。
  - 渲染层：`use-notes-domain.tsx` 加 `repairNote(lessonId)`（busy 三件套 + in-flight 守卫）；`NoteViewer.tsx:391-395` 的 warn 行动区在「重新生成此笔记」旁加「按体检结果补全」按钮（title 说明「只按体检问题修，不重新发送画面；修不好就保留原稿」）；toast：成功「已补全：体检 N 项 → M 项」，未改善「补完没有改善，已保留原稿」。
- 测试：新文件 `tests/notes-repair-ipc.test.ts`（无笔记拒绝 / 无转写拒绝 / warn=0 不调模型 / 采纳才存新版本 / 不采纳保留原稿且不涨版本 / **只有 evidence warn 时不采纳** / 在途与任务占用拒绝）；`tests/notes-ipc.test.ts` 补 regenerate 主用例不回归；组件测试补按钮存在性与 disabled 态。
- 门禁：四门禁 + **smoke**（expected surface 加 `notes:repair`；探针走错误路径——不存在的课时返回 err；成功路径会真的调模型，不探）。

**2.3 批量升级三连（P4/P5/P6）**
- 落点 `src/renderer/hooks/use-notes-domain.tsx` + `src/renderer/components/NoteUpgradeDialog.tsx` + `src/renderer/App.tsx`：
  - P4：`failed` 从 `Set` 改 `Map<lessonId, string>` 收集 `res.error`。**类型与初值三处都要改**（都在 553 行之前，漏一处必 TS 报错）：接口声明 `use-notes-domain.tsx:57`（`failed: ReadonlySet<string>` → `ReadonlyMap<string, string>`）、初值 `:142`（`failed: new Set()` → `new Map()`）、`closeNoteUpgrade`（:546-548）的重置同步改。
  - P4 渲染链：`NoteUpgradeDialog` 加 `reasonOf?: (lessonId: string) => string | undefined` prop，每行失败时在标题下渲染一行小字原因（复用 `.msg` 小区小字形态，SKILL：空态只有卡与一行小字两种）；挂载处 `App.tsx:293-310` 传 `reasonOf={(lessonId) => state.noteUpgradeRun.failed.get(lessonId)}`（`statusOf` 的 `failed.has(...)` 判断在 Map 上照常工作，不用改）；结尾 toast 汇总「N 个课时失败：〈第一个原因〉；其余原因见各行」（`use-notes-domain.tsx:576-578`）。
  - P5：批量结束后若 `done.has(currentLesson)` → `await loadNote(currentLesson)` 再 `await loadNoteIndex()`（`use-notes-domain.tsx:571` 的批量刷库保持**一次**——现有断言「批量完成后只刷一次笔记库」保持有效，用例扩充而非删除）。
  - P6：`NoteUpgradeDialog.tsx:62` confirm 改 `onRun([...selected].filter((id) => statusOf(id) !== 'done'))`——done 项在确认这一处统一裁掉，toggle/全选/reseed 不动。
- 测试：`tests/components/app-shell.test.tsx` 扩充——批量失败时行内出现真实原因文案、toast 含原因；当前课时在成功集时 loadNote 被调、笔记库仍只刷一次；done 课时不再进 confirm 载荷（对 done 课时 `bridge.notes.regenerate` 调用次数不增）。

**2.4 体检徽标同源（P7）**
- 落点：
  - `src/main/ipc.ts:1251-1262` `notes:latest`：**保留「无笔记时 `return ok(null)` 的早退**（`smoke-cdp.mjs:146` 的 `r.value === null` 探针因此原样保持绿，L1 expected surface 也不变——方法名没变）；只有取到笔记时的返回值从裸 `Note` 扩为 `{ note, transcriptHitRate }`，main 侧用与 courseHealth 同一个 `transcriptHitRateFor`（:1338）计算。返回类型是 `{note, transcriptHitRate} | null` 两支，不会出现「裸 Note 与包装对象」的第三形态。
  - **五个消费方全部点名并给出改法**（漏一个就是运行期静默失效或 `npm test` 红灯）：① `use-notes-domain.tsx:163-166` `loadNote`——cast 改新类型，`setNote(res.value.note)`，并把 `transcriptHitRate` 存进 hook 新 state `noteTranscriptHitRate`（随 loadNote 设置/清空）；② `scripts/note-coursemap-verify.mjs:260-263`——`const note = parsed?.value` 之后读 `note.knowledgeTree`，包一层后会恒 undefined、waitFor 永不成功，必须改 `parsed?.value?.note`；③ `scripts/smoke-cdp.mjs:146`——保留 `ok(null)` 早退的前提下无需改写，但 smoke 必须实跑复核（不能只改代码不跑门）；④ `tests/components/app-shell.test.tsx:281-294`——该 mock 现在给的是**裸 Note**（`ok({overview:'旧笔记概览', knowledgeTree:{…}, …})`），新形状下 `setNote(res.value.note)` 为 undefined，而用例（:279 起）正是先靠这份旧笔记加载成功、再验「点 brand 回首页后笔记页显示空态而非旧课时」，`.note-section` 永不出现 → `waitForSelector` 超时红；mock 必须改成 `ok({ note: {…原对象…}, transcriptHitRate: null })`（同文件 :133 的 `toHaveBeenCalledWith('l1')` 只钉调用参数，不受影响）；⑤ `tests/ipc.test.ts:495-511`——用例 :509-510 的 `latest.value?.overview` 取到的是包装对象 → undefined，`expect(...).toBe('概览')` 失败；断言改 `latest.value?.note?.overview`、cast 同步更新（:501 的「无笔记返回 null」分支断言不变）。
  - **第六个改动点（桥面实现侧，与上面五个消费方并列）**：`src/shared/bridge.ts:220` `latest` 类型同步为 `ApiResult<{ note: Note; transcriptHitRate: { hits: number; total: number } | null } | null>`，**并且必须同批改 `src/preload/index.ts:81`**——`src/preload/index.ts:12` 是 `const api: SeuSummaryBridge = {…}`（整对象按桥面接口标注），:81 现为 `latest: (lessonId: string): Promise<ApiResult<unknown>> => ipcRenderer.invoke('notes:latest', lessonId)`；`ApiResult<T>` 的 `value?: T`（`src/shared/api-result.ts:6-11`）是可变可选属性，`unknown` 不可赋给收窄后的联合类型，只改 bridge.ts 不改 preload 就是 **TS2322**（已用仓库自带 tsc 在仓库外草稿文件上复现：`node node_modules/typescript/bin/tsc --noEmit --strict <scratch>.ts` → `error TS2322: Type '(lessonId: string) => Promise<ApiResult<unknown>>' is not assignable to type '(lessonId: string) => Promise<ApiResult<LatestNoteResult | null>>'`，exit=2）。preload 的函数体不用动（`ipcRenderer.invoke` 声明为 `Promise<any>`，`node_modules/electron/electron.d.ts:9226`），只把声明返回类型改成与 bridge.ts 一致。
  - `noteTranscriptHitRate` 经 AppState 透传到 `NoteViewer`（与 `coverDataUrl` 同款路径，`App.tsx:575`）；`NoteViewer.tsx:235` 改为 `noteHealth(note, hitRate, noteTranscriptHitRate ?? null, imageCoverage)`——判据仍然只有一份（`shared/notes/health.ts`），渲染侧 info 级「配图覆盖率」不丢（main 不重算分配，避免第二套判据）。
  - 备选方案（不推荐）：整包 health 由 main 算——会丢渲染侧配图覆盖率 info，除非 main 也重跑一遍分配函数。
- 测试：`tests/notes-ipc.test.ts`（latest 返回新形状 + transcriptHitRate + 无笔记仍 ok(null)）；`tests/components/note-viewer.test.tsx`（徽标在只有转写 warn 时也报「待改进」）；既有消费方夹具**逐个点名更新**（契约变更，更新夹具不删断言）——`tests/components/app-shell.test.tsx:281-294` 的 mock 包一层、`tests/ipc.test.ts:509-510` 的断言解包；这两处不改，本批必跑的 `npm test` 必红，没有「顺带修」的余地。
- 门禁：四门禁 + **smoke**。

**2.5 「升级旧笔记」按钮在途态（P17）**
- 落点（**完整 prop 链，四层都要加**）：
  - `use-notes-domain.tsx:529-543` `openNoteUpgrade` 加 in-flight 守卫（courseHealth 在飞时再点直接 return）并在 finally 清守卫；同时暴露 `noteUpgradeLoading: boolean`（AppState 字段，初值 false，与 noteUpgrade.loading 区分——后者是对话框内列表的加载态）。
  - `App.tsx:570-592` 的 `<NoteViewer>` 挂载处加 `upgradeBusy={state.noteUpgradeLoading}`（与 `onUpgradeCourse`/`onExportCourseObsidian` 同一堆 props）。
  - `NoteViewer.tsx` props 声明区（`:51` `onUpgradeCourse?` 同款位置）加 `upgradeBusy?: boolean`，解构区（`:122` 同款）接住；两处 `<NoteLibrary>` 挂载（`:451`、`:465`，现在都传 `exportBusy={exportBusy}`）各加 `upgradeBusy={upgradeBusy}`。
  - `NoteLibrary.tsx:5-22` `NoteLibraryProps` 加 `upgradeBusy?: boolean`；按钮（`:117-128`）`disabled={upgradeBusy}` + 文案「读取中…」（busy 三件套，与同排「导出 Obsidian」的 `exportBusy` 同款）。
- 测试：组件测试连点两次只发起一次 courseHealth；按钮在途时 disabled 且文案含省略号。

**门禁**：四门禁 + smoke（2.2 与 2.4 都动桥面，一次跑齐）；测试数只增不减。
**提交**：`docs(spec)` → `refactor(notes): 返修复检改用与生成同口径的体检` → `feat(notes): 新增定向补全通道 notes:repair（不发图、不改善不存新版本）` → `fix(ui): 批量升级显示每课失败原因、成功后刷新当前笔记、重试跳过已完成` → `fix(ui): 笔记体检徽标与升级列表同源（notes:latest 带转写命中率）` → `fix(ui): 升级旧笔记按钮加在途态与守卫`。

---

### 批3 — 主进程失败可见性与文案（P1）

**目标**：让「失败了但看不出失败」的三条路径开口说话；封面从「导入时一次机会」变成「可回填」。

**3.1 超时话术（P22）**
- 落点 `src/shared/errors.ts:13`：改为同时覆盖两种超时、给出各自下一步（D11 待 Andiii 过目文案）：「连接或生成超时——校园网慢可稍后重试；若卡在笔记生成（10 分钟上限），换更快的模型、缩短视频或少发图片再试」。同文件 :12 的代理场景话术不动。
- 测试 `tests/errors.test.ts`：timeout 类输入映射到新文案且含「模型」；既有映射用例保留。

**3.2 Obsidian 整课导出失败可见（P23）**
- 落点：
  - `src/main/notes/obsidian-export.ts:154-162`：`catch` 里收集 `{ lessonId, reason: (e as Error).message }`（截断到 200 字符），返回 `{ exported, skipped, failures }`；`if (exported > 0)` 重建索引的现状保留。
  - `src/main/ipc.ts:1381-1393`：透出 failures，并 `ctx.logger.warn` 逐条落日志（lessonId + reason；vault 路径脱敏走既有 redact）。
  - `src/shared/bridge.ts` `exportCourseObsidian` 返回类型 += `failures?: Array<{ lessonId: string; reason: string }>`；渲染层 toast 改「导出 N 篇，M 篇失败：〈前 2 条原因〉；详见日志」。
- 测试：既有 obsidian 测试文件（`tests/obsidian-projection.test.ts` 一族）——单篇失败计入 failures 且带原因、导出成功的篇目与索引重建不受影响；ipc 测试断言日志落盘；smoke 补「vault 不可写/课程不存在」错误路径仍返回 err（返回结构变了，探针断言要同步）。

**3.3 封面回填（P1）**
- 落点：
  - `src/main/ipc.ts:446` 导入日志补封面成败：`bilibili import: course=X pages=N cover=ok|fetched-failed|skipped`（`view.coverUrl === ''` 记 skipped）。
  - 新 handler `notes:backfillCover(lessonId)`：读 `SELECT l.source, l.bili_page, c.bili_bvid FROM lessons l LEFT JOIN courses c ON c.id = l.course_id WHERE l.id = ?`（与 `ipc.ts:1648` 的 lessons:openSource 同款查询）；非 B 站源或无 BV → err「只有 B 站导入的课时能补取封面」；`ctx.bilibili.viewInfo(bvid)` → pic → `fetchImageAsDataUrl` → `saveLessonCover` → `UPDATE lessons SET cover_path`。**零新依赖**（复用现有 B 站客户端与封面落盘模块）。
  - 渲染层：`use-notes-domain.tsx` 加 `backfillNoteCover(lessonId)`（busy 三件套 + in-flight 守卫）；`NoteViewer` masthead 封面区在「无封面且当前课程来源为 bilibili」时渲染小按钮「重新获取封面」，成功后刷新 `coverDataUrl`。来源判定**不需要新增 AppState 字段**——`App.tsx:1497` 已由 `currentCourse?.source ?? 'seu'` 算出 `currentCourseSource` 并进 AppState（:800/:1800），`:588` 已在用它决定「原片」跳转入口；把它透传给 NoteViewer 即可（B 站课程的课时即 B 站源，课程级来源是可靠代理）。
  - bridge/preload += `backfillCover(lessonId)`。
- 测试：`tests/notes-cover.test.ts` + 新 ipc 用例（SEU 源拒绝 / 坏 BV 拒绝 / 成功落 cover_path / 取图失败返回 err 且不动原列）；组件测试（仅 B 站源且无封面时按钮出现、busy 三件套）。
- 门禁：四门禁 + **smoke**（新通道探错误路径：SEU 源/不存在课时返回 err；expected surface 同步加条目）。

**提交**：`fix(copy): 超时提示区分校园网与生成超时并给出各自下一步` → `feat(obsidian): 整课导出返回并记录每篇失败原因` → `feat(notes): B 站封面可回填 + 导入日志记录封面成败`。

---

### 批4 — 引导与信息架构（P2）

**目标**：新用户保存后管线就是可用的；取消勾选能力真的解绑；「我的学习」可全屏展开。

**4.1 Provider 首启引导（P8，文案与默认值见 D4）**
- 落点 `src/renderer/components/ProviderPanel.tsx`：
  - `:215-216` 初始 `capabilities` 与 `models` 按 D4 推荐改（默认含 multimodal；asr 模型按预设有无已知值预填）；`PROVIDER_PRESETS`（:22-28）加可选 `asrModel` 字段——**只给小米 MiMo 一例**：小米 MiMo→`mimo-v2.5-asr`（依据同文件 :30 `ASR_MODEL_HINT` 已列的示例）。**OpenAI 不预填**（2026-09-20 Andiii 决定：ASR 预设只留小米，不要 OpenAI），其余预设（OpenAI/DeepSeek/硅基流动/自定义）一律不预填 asr、也不因预设而自动勾选 asr。
  - `:233` `applyPreset` 在回填 multimodal/text 之余，预设有 asrModel 时一并回填 asr（没有则不动 asr，也不自动勾选）。
  - `submit()`（:248-265）/`canSave`（:285-289）：勾了 asr 但模型为空时，保存按钮 disabled **且**在 asr 输入框下给一行可见原因——不再静默 return。同批把 `:30` 的 `ASR_MODEL_HINT` 改成**只推荐小米**：「ASR 需要专门的语音模型，推荐小米 MiMo 的 `mimo-v2.5-asr`」（原句把 `whisper-1` 与小米并列，按 Andiii 2026-09-20 决定去掉 OpenAI 示例）。
  - `use-config-domain.ts:93-124` `saveProvider`：保存后若当前没有任何 multimodal 绑定，立即 toast「已保存。生成笔记还需要多模态总结模型——在上面勾选并绑定」，不等建任务才说。
- 测试：组件测试（默认勾选含 multimodal；只勾 asr 且空模型时 disabled + 可见原因；**切小米 MiMo 预设回填 `mimo-v2.5-asr`；切 OpenAI 预设不预填 asr**；保存后缺 multimodal 的 toast 文案）。
- 门禁：四门禁。

**4.2 能力解绑（P14）**
- 落点：
  - `src/main/ipc.ts`：新 handler `providers:unbind(capability)`——capability 过与 bind 同一份白名单（smoke 已有 `providers:bind('bogus',…)` 必须失败的探针，`scripts/smoke-cdp.mjs:158`，复用该校验），`DELETE FROM capability_bindings WHERE capability = ?`（表名见 `summarize.ts:464` 的同一查询）。
  - `src/shared/bridge.ts:123-131` ProvidersBridge += `unbind(capability)`；preload 同步。
  - `use-config-domain.ts:109-118`：保存时对「该 provider 原有绑定但本次未勾选」的能力逐个 `bridge.providers.unbind(...)`（原有绑定从 `ProvidersListResult.bindings` 按 providerId 过滤得出），成功后 toast「已解绑 N 项能力」。
- 测试：provider-store/ipc 测试（unbind 删行 / 非法 capability 拒绝）；use-config-domain 测试（取消勾选 → 调 unbind，勾选的仍 bind）；smoke expected surface 加 `providers:unbind` + 错误路径探针。
- 门禁：四门禁 + **smoke**。

**4.3 「我的学习」全屏展开（P9）**
- 落点：
  - `App.tsx:184-185` 旁加 `myStudyOpen` 状态 + close 回调；Ctrl+M 开关 effect 照抄 `App.tsx:227-241` 的 Ctrl+K 模式（应用菜单未占用该组合，同款注释写明）。
  - 新组件 `src/renderer/components/MyStudyDialog.tsx`：自绘近全屏弹层，三件套照抄 CourseBrowser（`useModalScrollLock` + `useFocusTrap` + Esc + 右上关闭键 + `aria-label`，SKILL §5「视图类自绘弹层」形制）；内部复用 `MyStudyPanel` 本体。
  - **onSelect 必须包一层**：`onSelect={(lessonId) => { onSelect(lessonId); onClose() }}`——先例在组件内而不是 App.tsx：`CourseBrowser.tsx:396-399` 就是 `onSelectLesson(lesson.id); onClose()`。若把 `App.tsx:427` 的 `onSelect={state.selectLesson}` 裸透传，选中课时不会关闭弹层，验收项「选课时后关闭并选中」必然失败。其余 props（mine/extracted/sameCourses/expanded/onToggle/onSelect/onHarvestLessons/onToggleMine/onRemoveCourse/onCourseMap/courseMapBusy/harvestInflight）透传。
  - `App.tsx:417-430` MyStudyPanel 外侧标题旁加入口按钮（`aria-label` + `data-testid="my-study-open"`，图标键形制同 `App.tsx:444-452` 的 course-browser-open）。
  - 样式：新增近全屏模态**基元**（`.fullscreen-overlay`：position/inset/z-index/scrim/居中，选择器进 style.css 顶部基元块），**四个**自绘 overlay 全部转为成员——course-browser（`style.css:861-866`）、course-map（:2024-2028）、bili-dialog（:2411-2415，与前三逐字重复的第四份手写 overlay）、my-study（新增）；共享确认弹层 `.dialog-backdrop`（z-index 60、grid 居中，`style.css:932-939`）是另一角色，不动。卡片内部规则（尺寸/head/list/padding）仍各自所有，不新增断点、不新增 padding 野值（基线 allowlist 只减不增）。
  - **同批更新 `docs/skills/ui-layout/SKILL.md` §2 基元表**：加一行「近全屏模态 `.fullscreen-overlay` + 成员列表」——SKILL 是排版唯一事实源，基元表不同步就是新的「声明与实现漂移」。
- 实拍：`scripts/ui-shots.mjs` 的截图清单（:178-517）只有 consent/bili/01-09/c1-c12，**没有「我的学习全屏」机位**，脚本只吃 `[outDir] [--prefix=] [--light|--dark] [--bili] [--compliance]`（:98-100、:220-232、:393-396）。因此本批给 ui-shots.mjs 加一个 `--my-study` 分支（照 :229-232 `--bili` 分支的模式：打开全屏我的学习弹层拍一张，light/dark 各一），并同步 SKILL §7 的清单描述。退路（不推荐）：把实拍降级为「组件测试 + 手工走查」并在提交信息注明未实拍——SKILL §7 要求排版改动实拍。
- 测试：`tests/components/my-study-panel.test.tsx` 或新组件测试——Ctrl+M 开/关、入口按钮打开、Esc 关闭、**选课时后关闭并选中**、滚动锁挂载；`tests/style-scale.test.ts` 保持绿（断点仍只有 1180/1024）。
- 门禁：四门禁 + `npm run build` + `node scripts/ui-shots.mjs .ui-shots/my-study --light`（新机位）+ 提交信息记关键数字。

**提交**：`feat(provider): 首启默认绑定多模态并明示 ASR 模型缺失原因` → `feat(providers): 取消勾选的能力随保存解绑` → `feat(ui): 我的学习可全屏展开（Ctrl+M）`。

---

### 批5 — 渲染层细节与可用性（P3）

**目标**：四处「印出字面标记 / 读屏听不懂 / 按钮能误点 / 搜索像坏了」的小而实。

**5.1 段落文本过 markdown 判据（P18）**
- 落点 `src/shared/notes/views.ts`：`:148` 与 `:172` 的 tldr 从直接造 paragraph 块改为走既有 `markdownBlock(note.tldr.trim())`（与 overview 同一 helper——判据只有一份）；`looksLikeMarkdown`（:135-139）补行内代码判据 `/`[^`\n]+`/`（`md-lite.ts:41` 的 `parseInline` 在 `:49` 有 code 分支，补上判据后含反引号的概览/tldr 走 MdLite 而不是印出字面反引号）。`NoteBlocks.tsx:43` 的 paragraph 分支保持纯文本（投影层已分流），注释写明「判据只有一份，在 views.ts」。
- 测试：`tests/notes-views.test.ts`——tldr 含行内代码 → markdown 块（渲染层出 `<code>`）；tldr 纯文本 → paragraph 块（旧笔记投影逐字节不变）；`tests/md-lite.test.ts` 已有 code 用例保留。

**5.2 知识结构树 a11y（P19，修法见 D10）**
- 落点 `src/renderer/components/NoteBlocks.tsx:196-233`：容器 `role="tree"` 不变；每个树行 `role="treeitem"` + `aria-level={depth + 1}`，有子节点时 `aria-expanded` 移到 treeitem 上（不再只挂在 toggle button 上）；子行容器包 `role="group"`。去掉 `depth === 0 ? 'treeitem' : undefined` 的条件。不做 roving tabindex（按钮本身可聚焦，读屏可用；完整键盘树导航记入 PROGRESS 观察项）。
- 测试：组件测试断言 treeitem 数量 = 树节点数、aria-level 递进、aria-expanded 随展开态变化。

**5.3 扫码等待期间主按钮不可点（P15）**
- 落点 `src/renderer/components/BiliImportDialog.tsx:322`：disabled 条件加 `loginPhase === 'qr'`，按钮文案在该相位显示「等待扫码…」（busy 三件套的既有形态，不新增第三种）；`onImportClick`（:211-223）加同一守卫（双保险）。
- 测试 `tests/components/bili-import-dialog.test.tsx`：qr 相位下主按钮 disabled 且文案含省略号；再点不会第二次调 `bridge.bilibili.login`（调用计数钉住）。

**5.4 导图搜索零命中空态（P16）**
- 落点 `src/renderer/components/MindMap.tsx`：`query.trim() !== '' && matched.size === 0` 时在工具栏下方渲染一行小字「没有匹配的节点——换个词，或清空搜索」（复用 `.msg` 小区小字，SKILL 空态两种形态之一；与 CourseBrowser 的零命中文案同口径）。
- 测试 `tests/components/mindmap.test.tsx`：输入不存在的词出现该文案；有命中时不出现；清空后消失。

**门禁**：四门禁。
**提交**：`fix(notes): tldr 与概览走同一套 markdown 判据（行内代码不再印字面反引号）` → `a11y(notes): 知识结构树补全 treeitem/aria-level/group` → `fix(bili): 扫码等待期间导入主按钮禁用并显示等待扫码` → `fix(mindmap): 搜索零命中给出空态提示`。

---

### 批6 — 观感与布局（P3，改 renderer 样式前已读 ui-layout SKILL）

**目标**：导图回到与其他四个视图一致的正文轴，画布不再常驻幽灵滚动条，笔记宿主有确定高度。

**6.0 探针先扩展（取证前提，本批第一个提交，先于 6.1–6.3）**
- 落点 `scripts/ui-probe.mjs` 的 `MINDMAP_GEOMETRY`（:430-441）：现状只返回 `{found, scale, scrollW（实为 clientWidth）, scrollH, svgW, svgH, drawnW, drawnH, fits}`，其中 `drawnW = Math.round(w * scale)`、`fits: w * scale <= sc.clientWidth + 1 && …` **假定「元素盒=布局原宽」**——正是 6.2 要改掉的对象；且全探针没有 `.mindmap-scroll` 的溢出差（能量溢出差的 `OV()` 在 :122，但只用于 `.note-toolbar`/`.note-actions`/`.note-body`，:142-144，从未用于导图画布），也没有 `.mindmap-wrap` 宿主高度。不改探针，批 6 点名的验收数字一项都取不到。
- 改法（三件事）：① 补画布溢出差 `overX = sc.scrollWidth - sc.clientWidth`、`overY = sc.scrollHeight - sc.clientHeight`（算法同 :122 的 OV，在 MINDMAP_GEOMETRY 字符串内联实现）；② 补 `.mindmap-wrap` 宿主高度 `wrapH`（6.3 的验收数字）；③ 按 6.2 的新元素盒模型重算 `drawnW/drawnH/fits`——新模型下元素盒=窗口×缩放=墨盒，改为 `drawnW = w`、`drawnH = h`、`fits = w <= sc.clientWidth + 1 && h <= sc.clientHeight + 1`（去掉 `* scale`，否则重复计缩放、fits 语义漂移）。既有字段名（含易混的 `scrollW`）保持不动，避免破坏既有记录格式。
- 测试/验收：探针是只读取证脚本，不进 vitest；本步的验收=跑一次 `node scripts/ui-probe.mjs --mindmap`（**修前**）确认新字段有值且旧字段语义如预期记录，把「修前」数字写进本步提交信息。
- 提交：`test(probe): 导图探针补画布溢出差与宿主高度，drawnW/fits 改按新元素盒模型`。

**6.1 正文列统一 640（P10）**
- 落点 `src/renderer/style.css:2167-2168`：删掉 `.note-body[data-view='mindmap'] { max-width: none }` 及其「破格」注释——SKILL §6「正文列 640px」是阅读排版铁律，五视图不再有例外；题头（`.note-masthead` 640）与 sticky 目录（640）从此与导图同轴。
- 横向大图的滚动交给画布内部（6.2 修完幽灵滚动后，滚动条只在图真的比 640 宽时出现）。

**6.2 SVG 元素盒随缩放（P11）**
- 落点 `src/renderer/components/MindMap.tsx:504-508`：viewBox 窗口钳到内容边界，元素盒改为「窗口用户宽 × 当前缩放」——
  ```tsx
  const vbWidth = Math.min(frame.width / view.scale, frame.width)
  const vbHeight = Math.min(frame.height / view.scale, frame.height)
  <svg width={vbWidth * view.scale} height={vbHeight * view.scale}
       viewBox={`${view.x} ${view.y} ${vbWidth} ${vbHeight}`} …>
  ```
  （缩放倍率不变：元素盒/viewBox = scale；缩到装得下时窗口=整幅内容，元素盒=内容×缩放，幻影滚动条消失；放大时窗口小于内容，元素盒=布局原宽，真实溢出照常可滚。）view.x/view.y 在 `zoomAt`（:24-28）与拖拽平移（:322）处补钳制到 `[0, frame.width - vbWidth]` / `[0, frame.height - vbHeight]`，避免窗口越出内容出现空白边。
- 备选（不推荐）：把视口模型整体改成「元素盒=内容×缩放 + viewBox=全内容 + 原生滚动平移」——更彻底，但要重写 zoomAt/平移/键盘一整套，成本与回归面都大一圈，本批不做。
- 测试 `tests/components/mindmap.test.tsx`（或 `tests/mindmap-svg.test.ts`）：四个缩放态下 svg 的 width/height 属性 = frame×scale（缩态）且 ≤ 容器宽；viewBox 不越出内容。

**6.3 笔记宿主确定高度（P12）**
- 落点 `src/renderer/style.css`：新增 `.note-body[data-view='mindmap'] .mindmap-wrap { height: min(60vh, 640px); display: flex; flex-direction: column; }` 与 `.note-body[data-view='mindmap'] .mindmap-scroll { flex: 1; min-height: 0; }`——与课程导图弹层宿主（`style.css:2038-2039`）同一策略；高度是容器级一次性预算（同 `max-height: 86vh` 弹层先例），不走间距 token；`.mindmap-scroll` 的 `padding: 8px` 原样保留（allowlist 条目不新增）。
- 连带效果：工具栏随 flex 列固定在顶部，不再被页面级滚动带走；`fitToViewport`（`MindMap.tsx:204-216`）的 `clientHeight` 第一次量到真实视口高度，竖直半边「适应窗口」在此宿主生效。

**6.4 宽屏不再大片留白（P24，依赖 D12 定档）**
- 落点 `src/renderer/style.css`：现有两个宽度断点全是 max-width（窄窗，`:1950` 与 SKILL §3），宽屏方向没有规则。按 D12 推荐做法：新增宽屏档 `@media (min-width: 1600px)`——**先改 `docs/skills/ui-layout/SKILL.md` §3 断点表与 `tests/style-scale.test.ts` 的钉住口径（同批，spec/skill 先行）**，再加宽列表型页面：`.task-panel`（`:581`）、`.note-library`/`.qa-recent`（`:1357`）放宽 max-width 或行改两列 grid；阅读页 `.note-viewer`/`.note-body` 保持 860/640 不动（与 D6 同源：排版铁律）。
- 若 D12 选备选 A（整体缩放）：落点改为 main 侧按屏幕工作区宽度设 `webContents.setZoomFactor` 分档——不新增 CSS 断点，SKILL §3 不受影响；但 `vh`/固定定位弹层（`.dialog` 的 `max-height: 86vh`、三个自绘 overlay `position: fixed`）在缩放下是否溢出必须实拍验证，**这是缩放方案能否成立的判据**。
- 验收数字：分别跑 `node scripts/ui-probe.mjs --width=1920` 与 `--width=2560`（`--width=` 即 Emulation 覆盖视口，探针已支持任意宽度），量「内容盒宽 − 面板右缘」的空白像素与列表行宽——修前 1372/1592（笔记页）、任务行恒 860；修后列表页用上空间、空白显著收窄；窄窗两态（960/1024）无新破格。

**门禁**：四门禁 + `npm run build` + `node scripts/ui-probe.mjs --mindmap` 实拍四态（首屏适应/放大后/适应后/窄窗适应；该 flag 存在于 `scripts/ui-probe.mjs:561`），提交信息记「修前 → 修后」关键数字（svgW、overX、overY、wrapH、drawnW）——这些字段由 6.0 的探针扩展提供，缺了 6.0 就没有数字可记。
**提交**：`test(probe): 导图探针补画布溢出差与宿主高度，drawnW/fits 改按新元素盒模型` → `style(notes): 思维导图回到 640 正文列，五视图同轴` → `fix(mindmap): SVG 元素盒随缩放，画布不再常驻横向滚动条` → `fix(mindmap): 笔记宿主给导图确定高度，工具栏不再被滚出视口` → `docs(skill): 断点表增补宽屏档（若 D12 选推荐方案，先于样式提交）` → `style(lists): 宽屏下列表页加宽/两列，吃掉右侧空白`（若 D12 选缩放备选，末两提交改为 `feat(window): 按屏宽分档设置界面缩放` + 弹层实拍修复提交）。

---

### 补批 — 模型设置两项化（P25，Andiii 第 3 项原话的剩余部分）

**目标**：设置页的能力面从三项（ASR / 多模态 / 文本问答）收敛到 Andiii 要求的两项（ASR / 多模态）；追问链路改走多模态；老库里的 text 绑定清理干净，界面不再出现第三项的任何痕迹。

**执行顺序**：本补批与批5、批6 同属剩余工作；本次续跑**先做本补批**（用户原话优先），再做批5、批6。

**补0 spec 先行（docs 提交，先于一切代码）**
- `docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md`：§4 的两处（「Advanced settings allow ASR, multimodal summarization, and text summarization…」与「A text-only model is a fallback for users who explicitly choose it」）与 §211 第 8 条（「independent ASR, multimodal, and text model bindings」）改为**两个能力**（ASR / multimodal），并写明「追问（Q&A）走多模态绑定」——这是产品边界变更，先落 spec 再落实现（Andiii 已明确要求）。
- 提交：`docs(spec): 能力面收敛为 ASR + 多模态两项，追问走多模态绑定`

**补1 能力面两项化（P25）**
- 落点：
  - `src/main/providers/model.ts:19`：`Capability` 收敛为 `'asr' | 'multimodal'`。
  - `src/main/app-context.ts:90` 的 `qaCapability: () => Capability` 与 `:570-573` 的实现：直接返回 `'multimodal'`（保留 dep 名，避免牵动 `ipc.ts:1997` 的调用点——取改动更小的一支）。
  - `src/main/ipc.ts:119-121` `requireCapability`：只放行两值（smoke 已有 `providers:bind('bogus')` 必须失败的探针，`'text'` 从此也进拒绝集）。
  - `src/main/tasks/orchestrator.ts:43` 的 `chat(capability)` 形参同步收窄（`:604` asr、`:823` multimodal 两处调用不变）。
  - `src/renderer/components/ProviderPanel.tsx:9-17`：`CAPABILITY_LABELS` / `CAPABILITY_ORDER` / `CapabilityNotes` 三项改两项（删「文本问答」行）；`:215-216` 的 `models` 初值与 `:233` 的 `applyPreset` 里的 `text` 字段一并去掉。
  - `src/renderer/hooks/use-config-domain.ts` 若因联合收窄报错，同步修（不改行为）。
- 老库清理（D13）：新增 migration 013 删除 `capability_bindings WHERE capability = 'text'`——该能力已不存在，留着只会在 `ProviderRowView` 里显示一个 UI 已无法维护的徽标。**不动** migration 003 的 CHECK 约束（改它要重建表，收益为零）；**零新增依赖**。
- 测试：`tests/provider-model.test.ts:19`（现用 `capability: 'text'` 的夹具改为两值内的用例，只改语义不删断言）；组件测试断言能力组只剩两个复选框且无「文本问答」；ipc 测试断言 `providers:bind('text', …)` 被拒；追问链路既有测试保持绿（走 multimodal）。
- 门禁：四门禁 + **smoke**（动桥面：`Capability` 联合收窄牵动 bridge/preload 的类型标注；expected surface 若含 text 绑定需同步）。
- 提交：`refactor(provider): 能力面收敛为 ASR + 多模态两项，追问改走多模态绑定`（migration 与测试同批）。

---

## 3. 决策项（D1–D13，均给推荐；Andiii 习惯「按推荐」拍板）

- **D1 — 重新收割的删除边界**。推荐：**有依赖行（notes/transcripts/keyframes/ppt_pages/tasks/qa 任一）的课时永不删**；真空行才删；带产物行的 title/play_ref 不覆盖（漂移只记日志）。理由：`removeCourse` 已立「该课程已有笔记，为保护数据不允许删除」（`ipc.ts:673-675`），同一纪律必须覆盖这条更隐蔽的路径；「序号漂移改名」会让用户对着旧标题找不到已生成的笔记。备选：永不删任何行（只提示）——更保守，但平台真的下架课时后列表里会留永久空行。若你更想要备选，批 1.1 的 DELETE 整个去掉即可。
- **D2 — 定向补全的入口与范围**。推荐：**单课入口**（体检面板「按体检结果补全」按钮，title 写明「只按体检问题修，不重新发送画面；修不好保留原稿」），批量升级对话框**不加**「补全」列。理由：补全与重生成是两种成本/语义不同的操作，一次只让用户面对一个选择；批量补全可以在单课稳定后单独开。行为边界（不发图、只跑一次、不改善不存新版本）已写进批 2.0 的 spec 批注，**需你确认这段 spec 文字**。
- **D3 — 体检徽标同源的方式**。推荐：`notes:latest` 返回扩为 `{ note, transcriptHitRate }`（保留无笔记时 `ok(null)` 早退），渲染层把该值喂给**同一个** `noteHealth`。理由：判据仍然只有一份（`shared/notes/health.ts`），渲染侧 info 级「配图覆盖率」不丢；代价是一次桥面变更（已排在批 2 的 smoke 里，三个消费方已全部列出）。备选：整包 health 由 main 算——会丢配图覆盖率 info，除非 main 也重跑一遍分配函数（第二套判据，漂移风险）。
- **D4 — Provider 首启默认值**（2026-09-20 Andiii 订正：ASR 预设只留小米）。推荐：新建表单默认勾选 **multimodal + asr**；`asr` 模型**只在小米 MiMo 预设下预填 `mimo-v2.5-asr`**，OpenAI/DeepSeek/硅基流动/自定义一律不预填 asr（**OpenAI 的 `whisper-1` 不写进预设表**）；预填不出 asr 的预设（如 DeepSeek、OpenAI）默认只勾 multimodal；勾了 asr 却空模型时保存被挡并给出可见原因；保存后缺 multimodal 立即 toast 指路。理由：spec §4 已写首启推荐「同一 provider 同时支持 ASR 与 multimodal」，当前实现与 spec 相反；ASR 预填只留 Andiii 指定的那一家，其余不猜；`ASR_MODEL_HINT`（同文件 :30）作为输入框下的示例文案照旧保留。
- **D5 — 我的学习全屏形态**。推荐：入口按钮挂「我的学习」标题旁 + **Ctrl+M** 快捷键，弹层形制完全照抄全屏课程浏览器（近全屏、滚动锁、focus trap、Esc、右上关闭键），overlay 基元抽出来四处共用，onSelect 包一层「选中即关闭」。理由：与既有「全部课程」全屏页完全同构，用户不需要学第二次；快捷键与 Ctrl+K 同款 effect 模式，应用菜单未占用 Ctrl+M。若你不想要快捷键，只去掉那支 effect 即可，其余不变。
- **D6 — 导图正文列宽**。推荐：**回到 640**，删掉破格规则。理由：这是你说的「没跟前面几个板块保持一致」；SKILL §6 把 640 钉成阅读排版铁律，导图是唯一例外；大地图的横向滚动交给画布内部（6.2 修完后滚动条只在图真的更宽时出现）。代价：同屏看到的导图比现在小一圈——若你实测后觉得太小，替代方案是「导图宿主仍 640，但允许画布横向溢出到 860 面板轴」，那会重新引入不一致，我不推荐。
- **D7 — 导图在笔记宿主的高度**。推荐：`height: min(60vh, 640px)` + 画布内部滚动（与课程导图弹层同一策略）。理由：工具栏不再被滚出视口、「适应窗口」竖直半边生效；具体数值是一次性容器预算（同弹层 `86vh` 先例），**请你在实拍后定档**——批 6 会跑 `ui-probe --mindmap` 把四态数字写进提交信息，你看了不满意只改这一个值。
- **D8 — 封面回填的触发方式**。推荐：新通道 `notes:backfillCover(lessonId)` + masthead 小按钮「重新获取封面」（仅 B 站源且无封面时出现），main 侧从库内 `courses.bili_bvid` + `lessons.bili_page` 重新走 `viewInfo` → 封面 URL → 落盘；导入日志补封面成败。理由：零新依赖（复用现有 B 站客户端与 `saveLessonCover`）；012 之前导入的课时同样能补（bvid 早在库里）。备选：导入时/任务成功后自动补抓——会在用户没要求时打网络请求，且导入路径刚被我们加固过，不建议再往里面加副作用。
- **D9 — Obsidian 失败报告形态**。推荐：返回失败清单（lessonId + 原因，截断 200 字），toast 显示前 2 条 + 「详见日志」，main 侧逐条 `logger.warn`。理由：vault 落在 OneDrive/只读位置时全部「跳过」是最容易发生的静默失败，用户至少要知道「一篇都没写进去」和第一个原因。备选：只要 `exported === 0 && skipped > 0` 就整体报错——更响但更糙（确实存在「全课都没笔记」的合法情形，会被误报成故障）。
- **D10 — 树 a11y 修法**。推荐：补全标准 ARIA 树（treeitem + aria-level + aria-expanded 在树项上 + 子行 `role="group"`），不做 roving tabindex。理由：「知识结构」本身就是层级语义，读屏用户按层导航的收益真实；成本约十几行。备选：摘掉 `role="tree"` 退回普通按钮列表——更简单但主动放弃了层级语义，与这个组件的立意相反。
- **D11 — 超时话术文案**。推荐改成：「连接或生成超时——校园网慢可稍后重试；若卡在笔记生成（10 分钟上限），换更快的模型、缩短视频或少发图片再试」。理由：原始两类超时（网络/provider 算得慢）共用一条正则（`errors.ts:13`），话术必须同时覆盖且各给下一步；这句只陈述可核实的事实（10 分钟上限 = `src/main/providers/openai-client.ts:40` 的 `CHAT_TIMEOUT_MS`），无法律术语。**请你过目这句**，措辞你定。
- **D13 — 老库里已绑定的 text 能力怎么处置（P25）**。推荐：**新增 migration 013 删掉 `capability_bindings WHERE capability = 'text'`**——能力面已收敛，留着这行只会在 Provider 列表里渲染一个 UI 再也无法维护的徽标（`ProviderRowView` 按库里的 bindings 渲染），属「声明与实现漂移」；删掉后追问自然落到多模态绑定，用户不需要做任何事。备选 A：保留行、渲染层过滤掉 text 徽标——不删数据，但库里留一行永远没人读的配置，下次读代码的人要重新推一遍为什么。备选 B：保留 text 能力但 UI 隐藏——与 Andiii 原话直接冲突，不取。**migration 只删这一种行，不动 CHECK 约束与其它绑定。**
- **D12 — 宽屏留白的解法（P24）**。推荐：**列表页响应式加宽 + 阅读列保持 640/860**——新增宽屏断点（先改 SKILL §3 断点表与 `tests/style-scale.test.ts` 钉住口径，spec/skill 先行，见批 6.4），任务历史/笔记库/课程树在宽屏下加宽或两列，把空白换成信息密度；阅读页的留白是 640 阅读铁律的既定代价，不动。理由：改动落在 max-width 档位而非刻度 token，对话框/弹层/钉住测试零牵连；「列表更宽」比「整体更大」的信息增益更高，也不改变任何既有页面的视觉语言。备选 A（你提的等比例放大）：main 侧按屏宽设 `setZoomFactor` 分档（如 1.25/1.5）——一次机制全覆盖、视觉最统一，且不新增 CSS 断点；但 `vh` 弹层与固定定位在缩放下是否溢出必须实拍验证（判据见批 6.4），放大后侧栏/工具栏会同比例变糙，且要决定是否给用户手动调缩放档位（那是新增产品设置）。备选 B：保持现状——阅读页留白即纪律，列表页也不加宽。**这是产品观感选择，请你定档**；若选备选 A，请一并给档位与是否可手动调。

---

## 4. 验收清单

每批独立验收，全部完成后再整体复核：

- [ ] **批 1**：重收割一门课（平台列表变小）→ 有笔记/转写的课时与它们的笔记都还在，日志有 `keptProtected`；空行仍被清理。全屏浏览器点「导图」→ 浏览器关闭、地图弹层可见、Esc 只关一层。任务在跑时改缓存目录被拒并提示先取消/清理。
- [ ] **批 2**：对一份 warn 笔记点「按体检结果补全」→ 只跑一次模型、不发图；改善则出新版本且 toast「体检 N 项 → M 项」口径真实，未改善则版本不变、toast 明说保留原稿。**只有证据/转写命中率 warn 的笔记不被误判为「补全成功」**。批量升级混入失败课时 → 每行显示真实原因、toast 汇总；当前课时升级成功后屏幕笔记与徽标即时更新；对已完成课时点重试不再触发 regenerate。查看器徽标与升级列表对同一份笔记结论一致。「升级旧笔记」连点只发起一次体检。
- [ ] **批 3**：构造超时失败 → 任务行/详情显示新话术且指向「换模型/缩短视频/少发图」。vault 指向不可写目录做整课导出 → toast 报告失败篇数与原因、日志有逐条记录、不再显示具有误导性的「跳过 N 篇」。B 站课时点「重新获取封面」→ 封面出现；SEU 源课时不给这个入口；导入日志能看到封面成败。
- [ ] **批 4**：全新 userData 首启 → Provider 表单默认含 multimodal、asr 有预填或明确原因；只勾 asr 空模型时保存被挡且看得到原因；保存后若缺 multimodal 立即被告知。编辑已有 Provider 取消勾选某能力 → 保存后列表徽标消失、管线不再用它。「我的学习」标题旁按钮 / Ctrl+M 可全屏展开，选课时后弹层关闭并落到该课时，Esc/关闭键行为与课程浏览器一致。
- [ ] **补批（P25）**：设置页能力组只剩「ASR 转写」「多模态总结」两个复选框，界面上没有「文本问答」；旧库里绑过 text 的账号升级后列表不再显示该徽标、追问仍可用（走多模态绑定）；`providers:bind('text', …)` 被拒；spec §4 与 §211 的第 8 条已改成两项并与实现一致。
- [ ] **批 5**：含行内代码的 tldr/概览渲染成代码而不是字面反引号；纯文本笔记投影不变。读屏（或 DOM 断言）下知识树有完整 treeitem/aria-level/aria-expanded。扫码等待期间主按钮禁用且显示「等待扫码…」，不会二次取码。导图搜不存在的词出现零命中提示。
- [ ] **批 6**：`ui-probe --mindmap` 四态（探针已由 6.0 扩展）：导图文列宽 = 640（与其余四视图同轴）、svg 元素盒随缩放、**`overX = 0`（适应态，探针新字段）**、**`wrapH` 为确定高度且工具栏常驻可见（探针新字段）**；窄窗（`--width=960`）无新破格。宽屏（`--width=1920`/`--width=2560`）：列表页用上空间、空白像素较修前（1372/1592）显著收窄、阅读页仍 640/860，数字写进提交信息。
- [ ] **整体**：`npm run lint && npm run typecheck && npm test` 全绿；动过桥面的批（2/3/4）各自 `npm run smoke` 全绿；测试数只增不减（每批在 PROGRESS 记「X → Y」）；`PROGRESS.md` 每阶段一条记录（含纯实现细节的取舍理由）；README/CHANGELOG 在最后一批收口时对齐。

---

## 5. 风险与回滚

- **批 1 删除策略**：风险是「平台真的下架课时」后列表留空行（推荐方案只删空行）。缓解：日志记 `keptProtected`，空行仍会被后续收割清理；若 Andiii 选备选（永不删），删掉 DELETE 即可。回滚：单 commit revert，无 schema 变更、无数据修复动作。
- **批 1 弹层顺序**：只改 DOM 顺序 + handler，不动 z-index；若将来再叠加弹层，仍以「先关后开」为纪律。回滚：revert 两个提交。
- **批 2 桥面变更**（`notes:repair` 新增、`notes:latest` 形状扩展、`exportCourseObsidian` 返回字段、`providers.unbind`）：smoke 的 L1 断言「桥面与 bridge.ts 完全一致」会先抓到漂移；`loadNote` 解包改动影响面仅笔记加载一条路径，**五个消费方 + preload 实现点已全部点名**（渲染层 loadNote / coursemap-verify 脚本 / smoke 探针 + `app-shell.test.tsx` 与 `ipc.test.ts` 两个测试夹具 + `preload/index.ts:81`，见 §6）。回滚：按提交逐个 revert（spec 提交保留，它是行为记录）。
- **批 2 补全成本**：一次文本模型调用（不发图）。若用户对某课反复点，每次都是一次调用——按钮 busy + in-flight 守卫保证不会并发；「warn=0 不调模型」保证空转不花钱；「口径不同源」这个已识别风险由 2.1/2.2 的 evidenceRefs 同源约束 + 专项测试钉住。
- **批 3 封面回填**：每次点击打一次 B 站 view 接口，可能撞风控——失败路径返回人话错误、不动库里既有 `cover_path`。回滚：revert，导入路径恢复「只抓一次 + 日志多一个字段」。
- **批 4 解绑**：用户可能解绑后忘记，任务跑到一半才发现没绑 ASR/多模态——现有任务路径已有明确报错（「尚未绑定…」），本批只是把「解绑」从不可能变成可能。回滚：revert bridge/handler，渲染层调用点同时撤。
- **批 4 新弹层与基元抽取**：新增第四个近全屏弹层，overlay 基元抽取会动到 course-browser/course-map/bili-dialog 三条既有规则——`tests/style-scale.test.ts`（断点/token/padding allowlist）与三个既有弹层组件测试是回归网；SKILL.md §2/§7 同批更新；实拍对照首屏。回滚：revert 样式与组件提交。
- **批 6 排版**：640 收窄后大地图同屏可见区域变小（D6 已提示，待你实拍定档）；元素盒公式改动影响全部导图宿主（笔记页 + 课程弹层 + SVG/PNG 导出路径共用同一 `frame`/`view` 模型）——`tests/mindmap-svg.test.ts`、`tests/components/mindmap.test.tsx` 与 `ui-probe --mindmap` 四态是验收网（探针先由 6.0 扩展，`overX`/`wrapH` 数字才存在；6.0 的「修前」记录同时也是 6.2 改动的对照基线）。回滚：四个提交可独立 revert；导出路径（`treeToSvgDocument` 是纯函数，不读 view 状态）预计不受影响，若实拍发现导出尺寸异常，优先回滚 6.2。
- **批 6 宽屏留白（P24/D12）**：推荐方案要动 SKILL §3 断点表与 `tests/style-scale.test.ts` 钉住口径（「只有两个宽度断点」扩为含宽屏档）——漏改任一则门禁红，必须同批；若 D12 选缩放备选，`vh` 弹层与固定定位在 `zoomFactor ≠ 1` 下溢出是主要风险，实拍不通过即回退到推荐方案。回滚：revert 批 6 对应提交，宽屏规则是纯新增、不影响既有两档。
- **通用**：6 批之间无代码依赖，可分批执行、分批发布；任何一批单独 revert 不回退其他批。每批提交前 `git status` 只含本批目标文件。

---

## 6. 修订记录（第 2 轮 B1–B7、第 3 轮 B1 补全、终审两条、v5 补入 P24 的处置）

评审 7 条意见已逐条打开源文件复核，全部成立（除行号类两条见 B7 说明），处置如下：

- **B1（notes:latest 契约变更与 smoke 冲突、消费方漏列）——v2 已修、v3 补全**：2.4 明确「保留无笔记时 `ok(null)` 早退」（`src/main/ipc.ts:1257-1258` 的 `if (row == null) return ok(null)` 不动），`scripts/smoke-cdp.mjs:146` 的 `r.value === null` 探针因此原样保持绿、L1 expected surface 也不变（方法名没变）。**v3 订正**：v2 在此处写「已核实全仓消费方仅此三处 + preload/bridge」是**错的**——那句 grep 只扫了 `src/` 与 `scripts/`，没扫 `tests/`。第 3 轮评审实跑 `grep -rn "notes\.latest\|notes:latest" src/ tests/ scripts/` 抓到两个测试消费方，且都会让本批必跑的 `npm test` 红：① `tests/components/app-shell.test.tsx:281-294` mock 的是裸 Note，新形状下 `setNote(res.value.note)` 为 undefined，:279 用例的 `.note-section` 永不出现 → waitFor 超时；② `tests/ipc.test.ts:509-510` `latest.value?.overview` 取到包装对象 → undefined → `expect(...).toBe('概览')` 失败。现共**五个消费方全部点名**并给出改法：`use-notes-domain.tsx:163-166`（cast + `setNote(res.value.note)` + 新 state `noteTranscriptHitRate`）、`scripts/note-coursemap-verify.mjs:260-263`（`parsed?.value` → `parsed?.value?.note`）、`scripts/smoke-cdp.mjs:146`（保留但必须实跑复核）、`tests/components/app-shell.test.tsx:281-294`（mock 包成 `ok({ note: {...}, transcriptHitRate: null })`）、`tests/ipc.test.ts:495-511`（用例 :509-510 断言解包为 `value?.note?.overview`，cast 同步）。教训记入：契约变更的消费方清查必须连 `tests/` 一起 grep——「漏一个就是红灯」对测试夹具同样成立，v2 的风险节也因此从「两个脚本消费方」更正为「五个消费方」。
- **终审-1（preload 漏改，2.4「不用动」是事实错误）——已修**：v3 的 2.4 写「preload 的 `ApiResult<unknown>` 不用动」是错的——`src/preload/index.ts:12` 是 `const api: SeuSummaryBridge = {…}`（整对象按桥面接口标注），:81 的 `latest` 声明返回 `Promise<ApiResult<unknown>>`；`ApiResult<T>` 的 `value?: T`（`src/shared/api-result.ts:6-11`）可变，`unknown` 不可赋给收窄后的联合。**已用仓库自带 tsc 在仓库外草稿文件复现**：`node node_modules/typescript/bin/tsc --noEmit --strict <scratch>.ts` → `error TS2322: Type '(lessonId: string) => Promise<ApiResult<unknown>>' is not assignable to type '(lessonId: string) => Promise<ApiResult<LatestNoteResult | null>>'`（exit=2；草稿文件已删，仓库未留残留）。即只改 `src/shared/bridge.ts:220` 不改 preload，本批必跑的 `npm run typecheck` 必红。现 preload/index.ts:81 列为 2.4 的**第六个改动点**（与五个消费方并列），函数体不用动（`ipcRenderer.invoke` 声明为 `Promise<any>`，`node_modules/electron/electron.d.ts:9226`）。
- **终审-2（批 6 验收数字在探针里不存在，且探针公式与 6.2 冲突）——已修**：`scripts/ui-probe.mjs` 的 `MINDMAP_GEOMETRY`（:430-441）只返回 `{found, scale, scrollW（实为 clientWidth）, scrollH, svgW, svgH, drawnW, drawnH, fits}`——没有 `.mindmap-scroll` 的 `scrollWidth − clientWidth`（`OV()` 在 :122 但只服务 :142-144 的三个笔记元素），也没有 `.mindmap-wrap` 宿主高度；且 `drawnW = Math.round(w * scale)`、`fits: w * scale <= sc.clientWidth + 1` 正是「元素盒=布局原宽」旧模型的产物，6.2 改成「元素盒=窗口×缩放」后 drawnW 会重复计 scale、fits 语义漂移。批 6 现增加 **6.0 探针先扩展**一步（本批第一个提交）：补 `overX`/`overY`/`wrapH` 三个字段，drawnW/fits 去掉 scale 乘法按新模型重算，既有字段名不动；§4 验收项同步改用新字段名（`overX = 0`、`wrapH`）。同类缺口在 ui-shots.mjs 上已按 §6 B6 补 `--my-study` 机位，此处对齐处理。
- **B2（存盘补全的 images 口径会重新制造虚假 toast）——已修**：`repairOnce` 的入参改名 `evidenceRefs` 并规定「前置体检与复检必须同源」——存盘补全传 `loadValidRefs(db, lessonId)`（`src/main/notes/polish.ts:73-80`，与 courseHealth 的 `ipc.ts:1335` 同一份），严禁传空数组（`health.ts:218-220`：`total === 0` 时证据 warn 不出现）；2.2 测试加「只有 evidence warn 时不采纳、不存新版本」专项例。
- **B3（基元表不更新 + 第四份 overlay）——已修**：批 4.3 增加「同批更新 SKILL.md §2 基元表」这一步，并把 `.bili-dialog-overlay`（`style.css:2411-2415`，与另三处逐字重复）一并转为基元成员（共四处）；同时订正批 1.2 的事实错误——`.dialog-backdrop` 是 `z-index: 60`（`style.css:932-939`），同为 40 的是三个自绘 overlay（862/2025/2412）。
- **B4（failed 类型三处 + upgradeBusy 四层 prop 链）——已修**：2.3 补齐 `use-notes-domain.tsx:57`（接口）、`:142`（初值）、`:546-548`（closeNoteUpgrade 重置）与 `NoteUpgradeDialog` 的 `reasonOf` prop 及 `App.tsx:293-310` 挂载处；2.5 改为完整四层链——hook `noteUpgradeLoading` → `App.tsx:570-592` `<NoteViewer upgradeBusy>` → `NoteViewer` props 声明/解构 + 两处 `<NoteLibrary>`（:451、:465）→ `NoteLibraryProps`（:5-22）→ 按钮（:117-128）。已核实 `NoteLibraryProps` 现无 `upgradeBusy`、NoteViewer 两处挂载都只传 `exportBusy`。
- **B5（props 全量透传与「选中即关闭」自相矛盾）——已修**：批 4.3 明确 `MyStudyDialog` 必须把 onSelect 包一层（先例在组件内：`CourseBrowser.tsx:396-399` 的 `onSelectLesson(lesson.id); onClose()`），其余 props 透传；验收项与测试同步。
- **B6（ui-shots 无机位、实拍不可执行）——已修**：批 4.3 改为「给 `scripts/ui-shots.mjs` 加 `--my-study` 分支（照 :229-232 `--bili` 模式）+ 同步 SKILL §7 清单描述」，并给出退路；批 6 的 `ui-probe --mindmap` 经核实 flag 存在于 `scripts/ui-probe.mjs:561`，保留。
- **B7（行号偏差）——已修/已核对**：采纳并改正——`views.ts:139-143` → `:135-139`；`db/open.ts:11` → `:10`；`NoteLibrary.tsx:104-115` → `:105-116`；`md-lite.ts:46` → `:41`（parseInline）/`:49`（code 分支）；`labels.ts` → `src/renderer/labels.ts`；`openai-client.ts` → `src/main/providers/openai-client.ts`。**两条经复核原引用正确、按原样保留**：`use-notes-domain.tsx:483-484`（`grep -n "await loadNote(lessonId)\|await loadNoteIndex()"` → 483/484/518/519/571，单条路径确为 483-484）与 `:571`（批量路径 loadNoteIndex 就在 571）；`App.tsx:444-452`（course-browser-open 按钮块，`class` 在 :445、`data-testid` 在 :446）。另 `App.tsx:417-430` 复核为 MyStudyPanel 完整块（:417 开、:430 `/>`），保留。
- **v6（ASR 预设只留小米，2026-09-20 Andiii 订正）——已改**：Andiii 在方案执行期间明确「asr 预设只写小米，不要 open ai」。据此订正三处：① §2 批4.1 的 `PROVIDER_PRESETS.asrModel` 只给小米 MiMo 一例（`mimo-v2.5-asr`），OpenAI/DeepSeek/硅基流动/自定义一律不预填 asr、也不因预设自动勾选 asr；② 同批把 `ASR_MODEL_HINT`（`ProviderPanel.tsx:30`）改为「ASR 需要专门的语音模型，推荐小米 MiMo 的 `mimo-v2.5-asr`」——原句把 `whisper-1` 与小米并列，属用户可见文案，一并去掉 OpenAI 示例；③ 批4 的测试断言从「切 OpenAI 预设回填 whisper-1」改为「切小米 MiMo 预设回填 `mimo-v2.5-asr`、切 OpenAI 预设不预填 asr」。§3 的 D4 与 §4 批4 验收项同步。执行工作流已按方案正文读取，此订正发生在批4 之前，批4 实现者按新口径落地。
- **v5（P24 窗口最大化空白，第 6 项反馈补入）——已修**：第 1 轮排查中「窗口放大排查员」报出 10 条发现，被分级员全部判为不进方案（理由：定宽正文列是 2026-09-18 排版整改的既定决策、非缺陷）。终审后逐条对照 Andiii 原话时发现：**用户的第 6 项反馈在方案里没有着落**——分级员可以把发现判为「不进方案」，但不能让用户点名的问题无声消失。本次会话实测取证（`node scripts/ui-probe.mjs --width=2560 --out=.ui-shots/probe-wide.json`：内容盒 2256 vs 面板右缘 1188 vs 正文右缘 968，右侧空白 1372/1592px；任务行恒 860）确认为真问题，补为 P24、列入批 6（新增 6.4）与决策项 D12，其余 23 条的批次与结论未动。教训记入：**每条用户原话都必须在方案里有明确着落——修，或作为决策项给出「不修/换解法」的理由；分级是筛噪音，不是销项**。
- **v8（P25 模型设置两项化，2026-09-21 补入）——待执行**：批4 只落地了 D4 的首启默认值与 P14 的解绑，Andiii 第 3 项原话的另一半「**直接改成 asr 与多模态这两个选项，不要三个**」在方案里没有着落——模型设置排查员的指令里点名要查 text 能力的消费点与删除路径，但成文时被并进 P8/P14，独立条目消失。这与 v5 的 P24 是同一类缺口（用户原话在方案里没着落）。补为 **P25 + 补批**：spec §4/§211 先行收敛为两个能力，`Capability` 联合、`qaCapability()`（追问改走多模态）、`requireCapability`、`ProviderPanel` 三项改两项，老库 text 绑定按 D13 用 migration 013 删除。**教训第二次记入**：分级与成文都必须逐条对着用户原话核「这句在方案里落在哪一条」，不能用「已并入某条」代替独立着落。
- **v7（2026-09-21，批1 实现后评审补口）——已修**：批 1 的 1.1 只冻结了 `school:harvestLessons` 一个 writer，而同一份课时目录在任务侧还有第二个 writer（`orchestrator.ts` 的 `fetching_course` catalog refresh，SEU 路径每次任务运行都跑）。于是提交 `e6ae65b` 的信息与 PROGRESS 里「带笔记/转写的行保留**且不被覆盖**」这句在仓库范围内**是错的**——收割刚冻结完，下一次任务运行就把整门课的行名/play_ref 按平台当前索引重写回去；play_ref 又是下一次任务用来点「第N节课」的 ref，被覆盖会去抓另一节课的流。处置取评审推荐①（改动小、语义一致）：判定与写法抽到 `src/main/lessons/catalog.ts`，两个 writer 共用，任务侧漂移经 `onCatalogDrift` 落 main 日志。**教训记入**：本方案 §1.7/§2 的每条根因都写了 file:line，但「同一份数据的其他 writer」这类**横向**事实靠读单点代码是看不见的——声明「不被覆盖」这种全称命题前，必须先 `grep` 该列的全部写入点（`INSERT INTO lessons` / `UPDATE lessons SET`），而不是只读被点名的那一处。
