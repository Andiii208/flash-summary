# SEU Summary 用户实测六问题整改方案（待审批）

> 2026-09-04。来源：Andiii 最新版装机实测反馈 6 条，全部经代码取证定位根因。
> 状态：**计划，未获批准不动代码**。基线：master d119303（四门禁 404/404 + smoke 19/19）。

---

## 一、问题取证清单

### P1 任务卡尺寸跳动（筛选「全部」↔「进行中」）

**根因**：主内容区 `.content`（style.css:296-302）`overflow-y: auto` 但**没有** `scrollbar-gutter: stable`。切筛选 → 历史列表高度变化 → 滚动条出现/消失 → 内容区宽度 ±10px → 任务卡（`.task-status`、历史行）宽度跳变。侧栏当年 F3 修过完全同类问题（style.css:253 有先例注释），主区漏修。

### P2 抓取课时目录后「跳回最前面」

**根因链**（app.tsx:720-729 `harvestLessons`）：
1. 抓取目录需主窗口导航到平台播放页，期间 **renderer 整体卸载**（第二渲染器环境级故障的既定约束，PROGRESS「失败与卡点」）；
2. fresh mount 时 `expanded = new Set()`（app.tsx:376）、`currentLesson = ''`、列表滚动位置归零——用户刚收割的课程在 500+ 门课目录里折叠沉底，视角跳回顶部；
3. 收割是 fire-and-forget：**完成无成功提示**（只有开始时的 toast），**失败被 `.catch(() => undefined)` 静默吞掉**（app.tsx:726）——用户不知道成没成。

### P3 笔记/追问被「先选课时」门控

**根因**：`currentLesson` 是笔记页与追问页的唯一钥匙。
- 笔记页：`NoteViewer` 空态显示「尚无笔记 — 运行任务生成后自动显示」（NoteViewer.tsx:127-128）——**库里有笔记也看不到**，必须先在侧栏 500+ 门课里找到那门课、展开、点课时；
- 追问页：无选中课时输入框禁用（QaPanel.tsx:20,50）——历史追问看不到、无法继续问；
- 三个导出/重新生成按钮也全部失效（app.tsx:219-222）。

### P4 导出文件命名不规范

**根因**：三种导出的 defaultPath 只用 `lesson.title`（ipc.ts:682 / 717 / 780），而课时标题只是「第3节课」这样的字符串——导出得到 `第3节课.md` / `第3节课-讲义.pdf`，没有课程名、教师、学期，多个课时的文件无法区分。Markdown 文件内文标题同样只有课时标题（noteToMarkdown 的 title 参数）。

### P5 思维导图文字省略号截断

**根因**：导图节点盒宽上限 200px（`NODE_MAX_WIDTH`，mindmap-layout.ts:12），标题超长时**按字符数硬截断加省略号**——交互导图 `truncate()`（MindMap.tsx:94-97）与 PDF 讲义 `truncateTitle()`（PrintHandout.tsx:216-219）两处同款。节点高度固定 40px（`NODE_HEIGHT`），完全没有换行能力。

### P6 笔记页右侧大片空白、全屏布局诡异

**根因**：阅读列 `.note-body { max-width: 660px }`（style.css:1125-1130，V4 试卷纸度量）**左对齐不居中**；追问区 780px（style.css:845/869）、设置面板 760px、Provider 表单 560px 同样左挂。窄窗口勉强能看，**全屏时左侧一窄条 + 右侧几十列空白**。另外导图视图被塞在 660px 阅读列里（`mindmap-scroll` 在 `note-body` 内），宽屏下既挤又空，两个问题叠加。

---

## 二、整改方案（五批，按用户痛点与依赖排序）

### 批 A：布局稳定与阅读列居中（P1 + P6）——纯 CSS，最小风险先做

- **A1** `.content` 加 `scrollbar-gutter: stable`（与侧栏 F3 同款修法，滚动条常驻预留位，筛选切换零跳动）。
- **A2** 阅读列居中：`.note-body`、`.qa-log`/`.qa-input-row`、`.settings-panel`、`.provider-form` 统一加 `margin-inline: auto`——全屏时内容居中，左右留白对称。
- **A3** 导图破格全宽：`NoteViewer` 在 `note-body` 上带当前视图 `data-view`；`view = 'mindmap'` 时 `.note-body[data-view='mindmap'] { max-width: none }`，导图吃满内容区宽度（横向大图明显少滚动）。
- **A4** 删除 style.css:819 的旧 `.note-body { max-width: 780px }`（已被 1126 行覆盖，死规则）。

验收：任务页反复切四档筛选无任何宽度跳动；笔记页 1920×1080 全屏居中；导图视图占满内容宽。`npm run lint && typecheck && test` + ui-shots 双主题截图自检。

### 批 B：笔记库与追问解门控（P3）——最大体验收益

核心思路：**「点开一条历史笔记 = 选中那个课时」**，复用现有全局选中上下文（currentLesson），追问、导出、重新生成、复制全部立即生效，不另造第二套状态。

- **B1** 新 IPC `notes:list`：`SELECT n.lesson_id, n.version, n.created_at, l.title AS lesson_title, c.name AS course_name, c.teacher FROM notes n JOIN lessons l ON … JOIN courses c ON … ORDER BY n.created_at DESC LIMIT 200`（main 侧单查询，preload 桥 + bridge.ts 类型 + smoke 登记三处同步）。
- **B2** 笔记页空态 → **笔记库列表**：未选课时显示全部已生成笔记（课程名 · 教师 · 课时标题 · 生成时间 · 版本徽标，复用 history-row 的行样式语言）；点击条目 → `selectLesson(lessonId)`（侧栏同步高亮，加载笔记 + 追问历史 + 任务历史）。空库时才显示现在的引导文案。
- **B3** 新 IPC `qa:recent`：跨课时最近 50 条问答（带课程/课时名）。追问页空态 → **最近追问**列表；点击条目 → 同样 `selectLesson` 进入该课时上下文，输入框立即可用、历史气泡接着显示。
- **B4** masthead 兜底：从笔记库进入时树还没展开也能显示卷头——`lessonContext` 计算失败时用笔记库条目带来的 courseName/teacher/lessonTitle 兜底（NoteViewer 增加可选 fallback 参数）。

验收：冷启动不点任何课时 → 笔记页看到全部历史笔记 → 点开一条 → 五视图可看、追问可问、三种导出可用。新增 IPC 测试 + 组件测试（列表渲染/点击选中/空库引导）。

### 批 C：收割目录不丢位置、有反馈（P2）

- **C1** localStorage 持久化 UI 会话状态：`expanded`（课程展开集）、`currentLesson`、当前页签、`allCoursesOpen`。挂载时恢复——收割/登录导致的 renderer 重载不再回到「一切折叠 + 顶部」。树刷新后对消失的 id 做清理（防陈旧键膨胀）。
- **C2** 收割状态可见：main 侧 `school:harvestLessons` 记录 in-flight courseId（内存即可，app-context），新 IPC `school:harvestState` 查询；fresh mount 发现有 in-flight 收割 → 侧栏该课程行显示「抓取中…」并 2s 轮询 `school:courseTree` 直到完成。
- **C3** 收割完成/失败反馈：完成 → toast「已抓取 N 节课时」+ **自动展开该课程并滚动定位到它**（不自动选课时——选哪节留给用户）；失败 → toast 错误（移除 `.catch(() => undefined)` 吞错）。

验收：点「抓取课时目录」→ 窗口跳走回来 → 课程处于展开态、视口定位在该课程、看到成功 toast 与课时数；中途失败有错误 toast。localStorage 恢复在重启应用后同样生效。

### 批 D：导出命名规范化（P4）

- **D1** shared 纯函数 `noteExportName`（src/shared/notes/ 下，main/renderer 共用 + 单测）：入参 `{ courseName, teacher, lessonTitle }`，产出 `课程名 - 教师 - 第3节课`；空段省略（不出现 `课程 - - 第3节` 空分隔）；过 `safeFileName`。
- **D2** 三处 IPC 统一接入：`notes:exportMarkdown` / `notes:exportAnki` / `notes:exportPdfDialog` 的 SQL JOIN courses 取 name/teacher，defaultPath = `noteExportName(...) + 后缀`（`-讲义.pdf`、`-Anki-概念卡.txt` 保持现有后缀语义）。Markdown 导出的内文 H1 同步用完整名。
- **D3** Anki 牌堆文件名同 base（`${base}-${deck.name}.txt`，ipc.ts:726 现有逻辑换 base 即可）。

推荐模板（审批时定）：`{课程名} - {教师} - {课时标题} - 讲义.pdf`。不进学期/日期：课程名+教师已唯一定位，文件名超长在资源管理器里反被截断；如需日期可在审批时提出加 `- YYYYMMDD`。

验收：同一门课第 1、3、5 节各导一份 md/PDF/Anki，文件名互不冲突且一眼可辨；教师为空课程名仍规范。现有 notes-ipc / notes-pdf-ipc / notes-anki 测试补命名断言。

### 批 E：思维导图多行完整显示（P5）

- **E1** 布局层支持多行节点（mindmap-layout.ts 纯函数，交互导图与 PDF 讲义共用同一几何）：
  - 新增 `wrapLineCount(title, boxWidth)`：按 CJK 单位宽 13px 估算行数（与现有 `nodeWidth` 同一套宽度模型，确定性不变）；
  - 节点高度改为 per-node：`height = max(40, lines * 18 + 12)`；布局 `place()` 全部改用 node.height（现在是 NODE_HEIGHT 常量）；
  - `NODE_HEIGHT` 导出保留为最小高度语义，引用处（MindMap.tsx、PrintHandout.tsx、mindmap-layout.test.ts）同步。
- **E2** 渲染层换行：`<text>` 内每行一个 `<tspan x="12" dy="…">`（不用 foreignObject——printToPDF 对其支持不稳，PDF 讲义共用此渲染）；折叠徽标/计数圆的 y 坐标改用 node.height/2。**删除两处 truncate/truncateTitle**，任何长度完整显示。
- **E3** PDF 缩放补高度维度：StaticMindMap 现在只按宽度缩放（PrintHandout.tsx:181-182），多行后整图变高，补 `scale = min(widthScale, heightScale)` 防止导图跨页被切。

验收：构造 30+ 字超长标题的节点 → 交互导图盒内完整换行显示、无省略号；导出 PDF 同样完整；同宽度下 1 行节点高度不变（旧笔记渲染不回归）。mindmap-layout.test.ts 更新：长标题行数/高度断言、无截断断言。

---

## 三、批次顺序与理由

| 批 | 内容 | 规模 | 理由 |
|---|---|---|---|
| A | 布局稳定 + 居中 | 最小 | 纯 CSS 零逻辑风险，先拿最痛的「跳动」与「全屏诡异」 |
| B | 笔记库 + 追问解门控 | 大 | 用户主诉第一条，新增 2 个只读 IPC + 空态重做 |
| C | 收割体验 | 中 | 依赖 B 同款的 selectLesson 复用；localStorage 持久化顺手恢复一切导航 |
| D | 导出命名 | 小 | shared 纯函数 + 三处 JOIN，独立可并行 |
| E | 导图多行 | 中 | 动共用布局函数，最后做，回归面（交互/PDF/测试）最宽 |

每批独立提交（Conventional Commits），批内 lint + typecheck + test 全过再进下一批；涉及 UI 的批加 ui-shots 双主题截图自检。测试数只增不减。

## 四、明确不做（本轮边界）

- 不做笔记在线编辑、版本切换 UI（遗留清单既有项）。
- 不做收割改后台 WebContents/第二窗口（环境级故障既定约束，PROGRESS 有案）。
- 不虚拟化课程列表（M3-2 已有 150 门分页揭示，够用）。
- QA 不做多轮上下文记忆增强（现有 priorQa 10 条机制不动）。

## 五、待 Andiii 拍板的决策点

1. **D 批命名模板**：推荐 `{课程名} - {教师} - {课时标题} - 讲义.pdf`；要不要追加日期段？
2. **C3 收割完成后**：自动展开+定位（推荐），还是顺手自动选中该课第一课时？
3. **B3 追问空态**：显示「最近追问」跨课时列表（推荐），还是只显示最近有追问的课时入口？
