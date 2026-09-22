---
name: ui-layout
description: SEU Summary 的排版与观感规范——刻度 token、七个共享基元、宽度断点、主题与一致性约定。凡改动 renderer 样式/布局/组件的会话必须先读本文件。
version: 1.0.0
---

# SEU Summary 排版规范（UI Layout）

> 2026-09-18 由排版整改计划（`docs/plans/2026-09-18-typography-layout-overhaul.md`，批0-批8）沉淀。
> 整改前的状态是：**token 层只有色/圆角/阴影/字号/字体，间距/行高/字距一个都没有**——
> 实测 `gap` 14 种取值、`padding` 约 40 种、`line-height` 11 种、`letter-spacing` 6 种，
> 全是逐处手写；同一角色还有多套实现（卡片 11 种 padding、列表行 6 种、空态 5 种形状…）。
> 本文件是那之后**唯一**的排版事实源；新增样式前先读它。

## 1. 刻度（`src/renderer/style.css` 的 `:root`）

| 类别 | token | 值 | 用在哪 |
|---|---|---|---|
| 间距 | `--space-hair` | 2px | 发丝缝：圆点/连接线/紧邻一对 |
| | `--space-1` | 4px | 同一控件内部 |
| | `--space-icon` | 6px | **只用于「图标 ↔ 文字」**（有钉住测试点名允许的选择器） |
| | `--space-2` | 8px | 兄弟元素之间（默认） |
| | `--space-3` | 12px | 卡片内部 / 卡片列表之间 |
| | `--space-4` | 16px | 区块之间 / 大卡内边距 |
| | `--space-5` | 24px | 内容区内边距 / 大分隔 |
| 行高 | `--leading-none` | 1 | 单字符头像/徽标 |
| | `--leading-tight` | 1.3 | 标题、单行强调 |
| | `--leading-snug` | 1.5 | 密集行、元信息行、输入框 |
| | `--leading-normal` | 1.6 | 默认 UI 文本（绝大多数） |
| | `--leading-relaxed` | 1.7 | 散文（中文正文） |
| | `--leading-loose` | 1.85 | 长文阅读列（`.note-body`） |
| | `--leading-loose-dark` | 1.95 | 同上，**仅暗色**（光晕补偿） |
| 字距 | `--tracking` | 0.5px | 默认标题字距 |
| | `--tracking-wide` | 1px | 页标题/箴言 |
| | `--tracking-seal` | 3px | 仅设置页页脚箴言（别处不得引用） |

**纪律**：`gap` / `line-height` / `letter-spacing` 只能取上表的 token（`gap: 0` 例外），
由 `tests/style-scale.test.ts` 强制，新增裸值即红。`padding` 同刻度但走**基线 allowlist**
（2026-09-20 批8 起）：存量野值（73 处 / 46 个值）登记在测试的
`KNOWN_PADDING_VIOLATIONS` 里并注明归属，规则**只减不增**——出现 allowlist 外的新野值
或该删未删的条目都会红；allowlist 用 `node scripts/style-padding-baseline.mjs` 重新生成
（打印当前值清单与出现位置）。修 padding 时优先直接改走 token 并从清单里删条目。

## 2. 七个共享基元

同一视觉角色**只允许一处定义**。成员把选择器挂进基元的选择器列表，**成员规则里不得
再出现被基元接管的属性**（padding / border-radius / 字号 / 高度）——否则就是新的漂移。

| 基元 | 规格 | 成员（选择器列表在 style.css 顶部基元块） |
|---|---|---|
| `.seg-tabs` | 14px / `8px 16px`，容器 `gap 4px + padding 4px`，允许换行 | `.tabs`（主导航）、`.note-tabs`（笔记视图切换） |
| `.card` / `.card-lg` | padding 12px / 16px，圆角 `--radius` | 概念卡、公式卡、自测卡、时间线卡、体检面板、课程卡（大卡：任务状态条、设置块） |
| `.row` / `.row-sm` | padding `8px 12px` / `8px 8px`，圆角 `--radius` | 历史行、笔记库行、考点卡 / provider 行、课程行、升级行（`.row-sm` 的横向内缩是 `--space-2`=8px——2026-09-21 批7 订正：规格表此前沿用了 8057786 收敛前的旧值 10px） |
| `.group-head` | 12.5px / 620 / `--text-secondary` | 笔记库分组标题、`MyStudyPanel` 组头（侧栏一级 `.sidebar-head h2` 是 14px/650，内容区小节标题见 `.subheading` 14px/620） |
| `.count-pill` | 高 16px 药丸、等宽数字、`flex-shrink: 0` | 树节点数、笔记库计数、侧栏课程数、全部课程数 |
| `.tag` | 高 18px 药丸（去掉半像素 padding） | `.chip`、`.badge`、`.formula-tag`、`.callout-tag`、`.quiz-tag`、`.bili-chip` |
| `.fullscreen-overlay` | `position: fixed; inset: 0; z-index: 40` + `--scrim` 遮罩 + 居中 + `padding: var(--space-3)` | 近全屏弹层的**覆盖层**：`.course-browser-overlay`（全部课程）、`.course-map-overlay`（课程导图）、`.bili-dialog-overlay`（B站导入）；`.fullscreen-overlay` 本体用于「我的学习」全屏弹层。卡片自身的尺寸/头部/列表仍各自所有；共享确认弹层 `.dialog-backdrop` 是另一档（z-index 60、grid 居中），不并入 |

空态只有**两种**形态：卡（`.empty-state`，大区）与一行小字（`.msg`，小区）。

## 3. 宽度断点（全站两个，都是窄窗方向）

| 断点 | 含义 | 做什么 |
|---|---|---|
| `@media (max-width: 1180px)` | 内容盒装不下 860（面板轴） | 内容区横向内边距 24 → 16；任务行的时间列收起（让位给失败原因，完整时间戳仍在 `title` 里） |
| `@media (max-width: 1024px)` | 装不下 640（正文轴） | 正文列与题头改流式；App 侧 `matchMedia` 让侧栏**挂载时**默认收起（不监听 resize，免得夺走用户的手动展开） |

**宽屏方向没有断点——用窗口缩放代替（2026-09-21 P28）**：窗口一放大，`main`
侧 `src/main/window-zoom.ts` 按物理宽度设 `webContents.setZoomFactor`
（`z = clamp(W/1600, 1, 2.5)`），CSS 视口随之钉在 1600：所有页面的既定布局在
宽屏逐像素复用 1600 窗口的形态，只是物理等比例放大；笔记页右侧空白由追问坞小窗
（`.qa-dock`，见 §5）吸收，其余页面仅由缩放本身消化。**不要再加 `min-width` 断点去「适配宽
屏」**——宽屏档在缩放方案下永不可命中（批6 的 1600 宽屏档已因此删除，见
`style.css` 该处注释）；追问坞曾经的「坞档 `min-width: 1400px`」是唯一例外，已随
2026-09-22「右侧悬浮小卡片」方案取消（§5）——**宽屏方向不再有任何 `min-width` 断点**。

新增断点前先问：能不能用现有断点或窗口缩放解决？`tests/style-scale.test.ts`
钉住了「窄窗只有 1180 与 1024、宽屏零 min-width」——加档要同时
改测试，也就是要过审。

## 4. 主题（浅色 «宣纸» / 暗色 «墨面»）

- 暗色 token 写在**两块**（`@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`
  与 `:root[data-theme='dark']`），**值必须一致**（注释里已写明）。
- **学科墨水是主题 token**：`--subject-ink-1..6`（浅色 = `shared/subject-ink.ts` 的 `SUBJECT_INKS`，
  暗色 = 混 35% 白）。渲染层只注入**变量名**（`subjectInkVar`），切主题不需要 JS。
  守卫：`tests/subject-ink.test.ts`（浅色逐值一致、暗色两处同值、对暗面 ≥4.5:1）。
- **遮罩用 `--scrim`**，不写裸 rgba（暗色需要更重的遮罩才分得出层）。
- 暗色下唯一需要动的排版参数是**正文行距**（`--leading-loose-dark`）——亮底暗字的光晕让
  细衬线发虚；字号/字重不动（衬线字体在 400/700 之间的值会被合成加粗，反而更糊）。

## 5. 一致性约定（都有钉住测试）

- **课程行的三个动作键**顺序固定为「星标 → 导图 → 删除」（收藏最常用在前，破坏性动作最后），
  侧栏与全屏浏览页必须一致；图标键一律带 `aria-label`。
- **展开/收起**三处（侧栏、树视图、导图）统一为「由少到多」：全部收起 → … → 全部展开。
- **工具行分组**用 `.toolbar-divider`（`aria-hidden`）把「维护 · 导出 · 主行动」分开。**笔记工具行（P48，2026-09-22）**：三组各自 `display:inline-flex; flex-wrap:nowrap`（组内不换行、组间才换——别把按钮平铺给 flex-wrap 自由切，分隔线会被拦腰切断）；课时导航（上一节/下一节）在题头右侧上下文组（`.page-head-context`）而不在行动行；次要导出格式收进「其它导出」菜单（`NoteExportMenu`，形制同 `.lesson-chip-menu`），「导出 PDF 讲义」作为主行动留在行尾贴右。
- **按钮标签不折行**（`.btn { white-space: nowrap }`），由容器负责换行（`flex-wrap`）。
- **弹层**：确认类用共享 `ui/Dialog`（底部右下两键；额外行动键走 `extraActions` 靠左，
  弹层只有一行按钮）；视图类自绘弹层用右上关闭键 + `aria-label`。弹窗有 `max-height: 86vh`
  与唯一的滚动区 `.dialog-body`（**不要**再给子元素加 max-height/overflow）。
  **近全屏弹层的覆盖层一律挂 `.fullscreen-overlay` 基元**（§2），成员不再自写
  position/inset/z-index/遮罩/padding；同一批同时开着两层时，DOM 后者居上，所以
  「导图」这类从弹层里打开的第二层必须渲染在更后面。
- **时间口径**：时间戳用 `formatTime`（mm:ss）/ `formatStamp`（绝对）/ `formatRelativeStamp`
  （一周内相对）；时长用 `formatDuration`（中文单位）。实现只有 `shared/format.ts` 与
  `shared/notes/format.ts` 两处，不许再抄。
- **追问坞 `.qa-dock`（2026-09-22 改为笔记页右侧悬浮小卡片，见 docs/plans/2026-09-22-qa-dock-float-window.md）**：
  **只在笔记页渲染**（任务页/设置页不显示）；**不是弹层**——不挂 `.fullscreen-overlay`、不加遮罩、不锁滚动。
  **单一 `position: fixed` 形态，不依赖任何断点**：右缘对齐内容盒右缘（`var(--space-5)`）、
  垂直居中（`top: 50% + translateY(-50%)`，不在右上角也不在右下角）、宽 = 笔记右侧空白本身
  （`max(200px, min(260px, calc(100vw - 24 - 304 - 24 - 640 - 12)))`，默认窗 260px）、
  高随对话内容（`min-height: min(380px, …)`、`max-height: calc(100% - 上下各16px)`——卡片 absolute 挂 `.app-main`（后者 `position: relative`），`top: 50%` 即**内容区**垂直居中，不伸进顶栏；日志区自滚）、`z-index: 30`——低于四个自绘 overlay 的 40、高于内容。
  折叠态为**同位置**的**悬浮小球** `.qa-dock-launcher`（P46，2026-09-22 用户「我认为这个小窗口应该是可以折叠的，比如折叠成一个悬浮小球」）：44px 圆形图标钮（`border-radius: 50%`、`MessageCircleQuestionMark`、accent 填充 + 对比色图标），与展开态卡片同一组定位值（右缘、内容区垂直居中、z-index 30）——折叠功能本来就有，旧形态是文字药丸，本批升级为球。
  **展开/折叠零布局变化（P47）**：`.note-viewer` **常驻 640 阅读轴**（追问卡槽位常驻，不随展开状态收放），点小球展开时笔记侧一个像素都不动；旧实现按展开态收窄笔记盒，展开瞬间题头 chip 行/工具行重排、「导出 PDF 讲义」移位（Andiii 明令禁止）。**正文列 640 不变**（§6）；坞展开时
  `.app-main.qa-dock-open` 把笔记盒收到阅读轴 640（右缘 968），卡片只落在 968 以右的空白里，
  任何窗宽不压笔记内容（P44 实拍订正：旧 860 面板轴右带正是工具行/导出按钮所在）。**坞头无课时切换
  chip**（P45，用户明示）——只剩「追问 + 收起」。
  打印不受影响：`@media print` 整体隐藏 `.app-shell`，坞挂在其内。

## 6. 阅读排版（笔记正文）

- 正文列 **640px**、字号 **15px**、行高 `--leading-loose`（实测 **42.7 全角字/行**；
  中文舒适区 30-40 字，640 是「比历史 680 收窄、又不显得版心突然瘦了」的折中）。
- 正文的字号与行高**只在 `.note-body` 声明一次**，段落规则继承——次级文字
  （概念定义/步骤解释/自测答案）才拿得回自己的字号（此前被 `.note-section p` 的通配压掉）。
- 题头（`.note-masthead`）与正文列**同轴**（640px）；超长标题（>28 字，B站视频名常见）
  降一档到 17px/1.3，全文进 `title`。
- markdown 标题三档：`md-h1` 16px / `md-h2` 15px / `md-h3-4` 14px 弱色。

## 7. 怎么验收排版改动

排版问题**不看代码猜，全部实拍实量**：

```bash
npm run build
node scripts/ui-shots.mjs .ui-shots/xxx --light   # 或 --dark；13 张主流程截图
```

专项机位（各自拍完即退出，不走主流程清单）：

```bash
node scripts/ui-shots.mjs .ui-shots/bili --light --bili          # B站导入对话框
node scripts/ui-shots.mjs .ui-shots/consent --light --compliance # 声明层四个界面
node scripts/ui-shots.mjs .ui-shots/my-study --light --my-study  # 「我的学习」全屏弹层
```

几何量测用 `scripts/ui-probe.mjs`（与 ui-shots 同一套库隔离缝，只读）：

```bash
node scripts/ui-probe.mjs                 # 三个页面：内容轴 / 正文行长 / 工具行 / 弹层 / 任务行列宽
node scripts/ui-probe.mjs --width=960     # 追加窄窗一轮（Emulation 覆盖视口，不改窗口）
node scripts/ui-probe.mjs --empty         # 空库首启（侧栏引导卡 + 主区首启卡）
node scripts/ui-probe.mjs --dialog        # 长文本弹层在 960×600 下的钳制与滚动
node scripts/ui-probe.mjs --provider      # 绑定能力复选框组布局
node scripts/ui-probe.mjs --mindmap       # 导图四态：首屏适应 / 放大后 / 适应后 / 窄窗适应
```

完整几何写 `.ui-shots/probe.json`（gitignored），终端打印关键数字摘要——
**提交信息里的「修前 X → 修后 Y」就取这里**。

改排版的批次必须：四门禁全绿（lint/typecheck/test/build）→ 实拍对照 → 把关键数字写进提交信息。
