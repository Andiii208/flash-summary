# 方案：追问坞改「笔记页右侧悬浮小卡片」（2026-09-22）

> 状态：**执行中**（由 /workflow 分批落地，每批自带门禁与评审，逐批记录到 PROGRESS.md）。
> 触发：Andiii 2026-09-22 两轮反馈——
> **第一轮原话**：「这个追问框，你还是没有理解我的意思，我不需要在除了笔记之外的其他界面去展示，我只需要在笔记这个地方去展示。用户本身的使用逻辑就是点开笔记才去追问的。在笔记这个界面，右边不是有一个比较大的空白区域，没有任何内容吗？也就是『导出 pdf 按钮的下方』，那一块区域我无论点哪个子板块，都是空白的。我想的是把右边那个空白的地方，直接放一个问答框……而不是像现在这样放在角落，在右下角，并且排版上也有问题，我想要的只是一个悬浮小窗，而不是一个小卡片，也不是放大到全屏的时候那种直接占据一小半面积，毫无美感可言的设计。除此之外，我认为整体的前端设计和排版还可以做细致一些的优化……特别是我期望的悬浮追问小窗口，希望你这回可以很好的去设计和实现。」
> **第二轮澄清（工作流已启动后的即时纠正，本轮设计以此为准）**：「不要改到右上，不要跟现在的宽屏形态同一尺寸，我想要的只是在右边放一个悬浮小卡片而已。」
> **第三轮订正（P44，收口实拍后）**：「现在这个卡片太宽了，我希望它能窄一点，然后变长一点。也就是说不要跟笔记的部分有重叠，它只是利用笔记右侧的空白区域那一点位置。然后你还要注意组件溢出和文字溢出的这些问题。」
> **第四轮订正（P45）**：「卡片还不够，要再瘦长一点，并且现在这个课程名字这个栏是溢出的，但是我认为根本没有必要设置这个课程栏的这个小组件，因为我本身就是在笔记内部针对我当前的笔记进行一个提问，所以我认为不需要设计这个功能。」
> **第五轮订正（P46）**：「我认为这个小窗口应该是可以折叠的，比如折叠成一个悬浮小球你看看你当前有没有做到，如果没有的话你去看看怎么做，然后再启动一下给我看看。」——折叠功能本来就有（收起键 → 右缘入口钮），但旧形态是文字药丸；升级为 44px 圆形图标钮后启动应用目视验收。
> 取证方式：每条根因均已打开源文件核对（`file:line` 为本次会话实读）。两轮反馈均授权自主执行，决策项全部走推荐侧。
> 与上一轮的关系：`docs/plans/2026-09-21-ux-optimization-round2.md` 的 P36/P37 已落地并随 v0.7.10 发布（右侧坞 + 无笔记门禁）。本方案**不改那两个决策本身**，只改坞的呈现形态与挂载范围，并处理用户点名的「排版问题」。
> 铁律遵守：唯一设计规格 `docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md`（本方案改的是 spec 2026-09-21 修订批注①描述的行为 → 批0 先改 spec 再动代码）；排版唯一事实源 `docs/skills/ui-layout/SKILL.md`；busy 一律「文案加省略号 + disabled」；测试只增不减（随行为变更更新的断言在提交信息点名）；不改 `name`/`appId`/userData；零新增运行时依赖；**宽屏方向从此没有任何 min-width 断点**（SKILL §3 的「坞档 1400 例外」随本方案取消）；每批提交前四门禁全绿。

---

## 0. 结论先说

Andiii 的意见逐条核实：

1. **「不需要在笔记之外的界面展示」——现状确实全 tab 常驻**。追问坞挂在 `.app-main` 下、三个 tab 面板之外（`App.tsx:724-742`），任务页/设置页也一直显示。改为**只在笔记 tab 挂载**（D1）。
2. **「排版有问题」——坞内三处硬伤实锤**：`.qa-recent-where` 写死 `flex: 0 0 220px`（`style.css:1435`）在约 300px 的窄坞里把问题列挤成一条线；`.qa-dock-head` 无 `min-width:0` 防挤爆；`.qa-a/.qa-q/.qa-input` 三处 padding 野值还在基线清单里。全部归 token 收口（P40）。
3. **「不要贴右下角的小卡片，也不要全屏占一小半的拉伸大列」——两种旧形态都被否**：<1400 是 `position: fixed` 贴右下角的 400px 小窗（`style.css:1528-1543`）；≥1400 是 `align-self: stretch` + `flex: 0 1 520px` + 近满高 `max-height` 的第三列，还顺带把正文列拉宽（`style.css:1571-1583` 的 `:has()` 规则）。
4. **第二至四轮澄清定案形态——「在右边放一个悬浮小卡片」**（§2）：**一种形态、不再有断点**：固定悬浮在笔记页右侧空白区，**右缘对齐内容盒右缘（24px）、垂直居中**（既非右上角也非右下角）；**宽 = 笔记右侧空白本身（默认窗 260px、封顶 260、下限 200）、高随对话内容（84vh/720）**——明显小于旧宽屏列的 340–520px 满高尺寸；带阴影圆角的独立瘦长小卡片。全屏时窗口缩放把 CSS 视口钉在 1600，卡片逐像素复用同一紧凑尺寸，物理上等比例放大，但**永远不占据小半屏**。第三轮实拍（P43/P44）发现 380px 卡片在默认窗压住封面右缘/工具行右端（含「导出 PDF 讲义」）约 106px——「只放空白」当场破功，遂有「笔记盒收 640 阅读轴 + 卡片宽从 968 以右算起」的零重叠结构；第四轮（P45）再瘦长（260×620 @默认窗）并删掉溢出的课时切换 chip。

### 问题 → 批次对照

| # | 问题 | 严重度 | 批次 |
|---|---|---|---|
| P38 | 坞全 tab 常驻（任务/设置页也显示），与「只在笔记页展示」冲突 | medium | 批1 |
| P39 | 两种旧形态都被否（贴角小卡 / 拉伸满高列）；终态＝右侧悬浮小卡片（单一 fixed 形态、无断点、380px、垂直居中） | medium | 批2 |
| P40 | 坞内排版硬伤：近期行写死 220px、头部无防挤爆、三条 padding 野值 | medium | 批3 |
| P41 | 卡片窗口感细化：头部分隔、输入行动线、间距单点定义、入口钮同形制 | low | 批4 |
| P42 | 验收工具滞后：探针还在点不存在的「追问」tab；smoke 断言坞首屏常驻——与「只在笔记页」冲突 | medium | 批5 |
| P43 | 收口实拍发现 380px 卡片在默认窗压住封面右缘/工具行右端（「导出 PDF 讲义」被盖）约 106px | medium | 批2 收口订正 |
| P44 | 用户：「卡片太宽了……窄一点、长一点……不要跟笔记的部分有重叠，只利用笔记右侧空白那一点位置；注意组件/文字溢出」 | medium | 收口订正 |
| P45 | 用户：「卡片还不够，要再瘦长一点；课程名字这一栏是溢出的——根本没有必要设置这个课程栏小组件」 | medium | 收口订正 |

---

## 1. 现状实读（根因）

### 1.1 挂载点：坞在 tab 之外，全 tab 常驻（P38）

- `App.tsx:724-742`：`{qaDockOpen ? <QaDock … /> : <button class="qa-dock-launcher">}` 渲染在 `</main>` 之后、`.app-main` 之内——**与 `tab` 状态无关**，三个 tab 都能看到。
- `App.tsx:195-196`：`qaDockOpen` 折叠态（默认展开、不持久化，P36 决策保持不变）。
- 坞内部件 `QaDock.tsx:62-196`：对话流 + pending/error 气泡 + 重试 + busy 提示 + 输入行；`hasNote` 硬门禁（P37，不动）。
- **代价（如实记）**：切 tab 再回来，输入框草稿丢失（`draft` 是组件内 state）。评估后可接受——追问语义绑定「正在读的这篇笔记」，不抬升到 App state。

### 1.2 旧形态一：贴右下角的小卡片（P39，用户明否）

`style.css:1528-1543`：`position: fixed; right: var(--space-3); bottom: var(--space-3); width: min(400px, calc(100vw - 48px)); max-height: min(70vh, 640px); z-index: 30`；折叠态 `.qa-dock-launcher` 同样贴右下角（`style.css:1551-1565`）。

### 1.3 旧形态二：拉伸满高的第三列（P39，用户明否）

`style.css:1571-1583`：`position: static; flex: 0 1 520px; min-width: 340px; max-height: calc(100vh - var(--space-4) * 2); align-self: stretch`，且同档 `:has(.qa-dock)` 把 `.task-panel/.note-viewer/.settings-panel` 改成 `max-width:none; flex:1; min-width:0`——**正文列被拉宽**（640 阅读铁律在该档被放开）。

### 1.4 坞内排版硬伤（P40）

- `.qa-recent-where { flex: 0 0 220px }`（`style.css:1435`）：为 860 面板轴设计；坞内可用宽约 300px，写死 220px 后问题列只剩约 60px——**用户说「排版有问题」的直接来源**。
- `.qa-dock-head`（`style.css:1544-1547`）：标题 + chip + 收起键一行，无 `min-width:0` 兜底。
- 三条 padding 野值在 `tests/style-scale.test.ts` 的 `KNOWN_PADDING_VIOLATIONS`：`.qa-a` `12px 16px 12px 18px`（`:320`）、`.qa-input` `8px 11px`（`:355`，与 `.task-error` 共用条目）、`.qa-q` `8px 14px`（`:357`）。
- `.qa-time { margin-top: 6px }`（`style.css:1520`）、`.qa-busy-hint { margin: 4px 0 0 }`（`style.css:1306`）裸值。
- `.qa-log/.qa-input-row` 的 `max-width: var(--content-max)`（`style.css:1517/1521`）靠 `.qa-dock` 内两条覆盖（`:1548-1549`）才变窄——通途式与坞形态耦合，本批显式化。

---

## 2. 目标设计：右侧悬浮小卡片（单一形态，无断点）

**一个组件、一套类名、一种形态**——取消「≥1400 常驻列 / <1400 悬浮窗」双形态，也取消坞档断点：

| 维度 | 规格 | 依据 |
|---|---|---|
| 形态 | 唯一一种：`position: fixed` 悬浮小卡片（自带 elevation；不是弹层：不挂 `.fullscreen-overlay`、不加遮罩、不锁滚动） | 用户「悬浮小卡片」 |
| 水平位置 | `right: var(--space-5)`（右缘与内容盒右缘对齐 24px）；`width: max(200px, min(260px, calc(100vw - var(--space-5) - 304px - var(--space-5) - 640px - var(--space-3)))`——宽 = 笔记右侧空白本身（默认窗 260px）；**坞展开时笔记盒经 `.app-main.qa-dock-open` 收到阅读轴 640（右缘 968），卡片任何窗宽不压笔记内容** | 全站右缘同一刻度；260 明显小于旧宽屏列的 340–520；零重叠由「笔记让位」保证而非祈祷 |
| 垂直位置 | **垂直居中**：`top: 50%; transform: translateY(-50%)` | 用户「不要改到右上」也不要右下角——居中即「在右边」 |
| 高度 | 随对话内容；`max-height: min(84vh, 720px)`（默认窗 738 下最高 620px），日志区自滚 | 「小卡片」不是满高列；P45「再瘦长一点」 |
| 层 | `z-index: 30`（低于四个自绘 overlay 的 40、高于内容） | 现状不变 |
| 可见性 | 仅在 `tab === 'notes'` 渲染 | 用户明示 |
| 坞头 | 只有「追问 + 收起」——**无课时切换 chip**（P45 删）：切课时在侧栏课程树/笔记题头 chip/顶栏面包屑三处都可做，坞里是冗余且在窄卡里是溢出源 | 用户明示 |
| 折叠态 | **悬浮小球**与卡片**同一位置**（右缘、垂直居中）：44px 圆形图标钮（`border-radius: 50%` + `MessageCircleQuestionMark` + accent 填充），不是文字药丸 | 折叠读作「卡片收了头」；P46 用户明示「折叠成一个悬浮小球」 |
| 正文列 | **不动**：`.note-viewer` 保持 `max-width: var(--content-max)`（640），删除 `:has(.qa-dock)` 拉伸规则 | SKILL §6 阅读列铁律 |
| 断点 | **取消坞档 1400**：style.css 宽屏方向不再有任何 `min-width` 断点；`style-scale` 钉住测试改写为「宽屏零 min-width」 | SKILL §3「宽屏方向没有断点」恢复无例外 |

卡片视觉（窗口感）：`--radius-lg` + `--shadow-lg` + 1px `--border-strong`；头部分隔线把「标题 + 课时 chip + 收起」与对话流分开；气泡拉满可用宽；输入行 textarea 与按钮等高；间距/圆角/字号全走既有 token，不新增刻度。

**全屏行为**：`window-zoom.ts` 的 `z=clamp(W/1600,1,2.5)` 把 CSS 视口钉在 1600 → 卡片恒为 380 CSS px 宽、内容高，只被物理等比例放大；「不占一小半」由构造保证，探针在 zoom 各档断言（批5）。

---

## 3. 批次设计（执行顺序）

### 批0 — 文档先行（spec / SKILL / 本方案）

- spec `docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md:134` 修订批注①改写：从「全 tab 常驻 + ≥1400 常驻并列/拉伸第三列」改为「**只在笔记页渲染的右侧悬浮小卡片**（单一 fixed 形态、无断点；右缘对齐内容盒右缘、垂直居中；宽 380px、高随对话内容；可折叠成同位置入口钮；正文列 640 不变）」；②（无笔记硬门禁）原文保留。
- `docs/skills/ui-layout/SKILL.md` §3 宽屏例外段（`:71-77`）**删除「坞档 1400 例外」**，恢复「宽屏方向没有任何 min-width 断点」；§5 追问坞段（`:110-119`）按新形态改写（保留「不是弹层、不遮罩、不锁滚动」「打印不受影响」两条不变事实）。
- 本方案 §2 规格表即设计事实源；状态行随批6 置为「已执行」。
- 不改任何代码；单独一个 docs 提交。

### 批1 — 挂载点收窄到笔记页（P38）

- `App.tsx`：坞/入口钮渲染条件加 `tab === 'notes'`；注释重写。结构不动（仍挂 `.app-main` 内）。
- 测试随行为变更更新（提交信息点名）：`tests/components/app-shell.test.tsx:126-141` 改写为「任务/设置页无坞；笔记页有坞；折叠/恢复循环」；`:221-233`、`:235-246` 两条 qa 历史用例先切「笔记」tab 再断言。
- 提交：`refactor(ui): 追问坞只在笔记页渲染（任务/设置页不再常驻）`。

### 批2 — 右侧悬浮小卡片（P39，本方案核心）

- `style.css` 坞段整体重写为**单一 fixed 形态**（规格见 §2）：`right: var(--space-5); top: 50%; transform: translateY(-50%); width: min(380px, calc(100vw - 2 * var(--space-5))); max-height: min(70vh, 620px); z-index: 30`；flex 列、`gap: var(--space-2)`、surface 底、1px `--border-strong`、`--radius-lg`、`--shadow-lg`、`padding: var(--space-3)` 保持或归 token。
- **删除 1400 档整块、删除 `:has(.qa-dock)` 三条面板拉伸规则**（全文件不得再出现 `:has(.qa-dock)`）。
- `.qa-dock-launcher` 同位置（右缘、垂直居中）同形制（radius-lg/shadow-lg/border-strong、surface 底、accent 文字、`padding: var(--space-2) var(--space-4)`）。
- `tests/style-scale.test.ts`：`213-220` 行「宽屏（min-width）只有追问坞档 1400」→ 改为「宽屏零 min-width 断点」；`222-229` 行坞档用例删除或改写为「坞不依赖任何断点」；基线清单本批不动（批3 清）。
- 提交：`style(ui): 追问坞改右侧悬浮小卡片——单一 fixed 形态、380px、垂直居中、无断点`。

### 批3 — 坞内排版归 token 与防挤爆（P40）

- `.qa-recent-where`：`flex: 0 0 220px` → `flex: 0 1 auto; min-width: 0; max-width: 45%` + 省略号；`.qa-recent-q` 保持 `flex:1 + min-width:0`。
- `.qa-dock-head` 加 `min-width: 0`；`.qa-dock-head .lesson-chip { flex: 1 1 auto; min-width: 0 }` 与两个子 span 可压缩省略（**选择器带 `.qa-dock-head` 前缀**，PageHeader 的 chip 不受影响）。
- 三条 padding 归 token 并同步基线：`.qa-a` → `var(--space-3) var(--space-4)`、`.qa-q` → `var(--space-2) var(--space-3)`、`.qa-input` → `var(--space-2) var(--space-3)`；`'8px 11px'` 条目**保留但改写为只挂 `.task-error`**（`style.css:1059` 不动）；跑 `node scripts/style-padding-baseline.mjs` 核对。
- `.qa-time`/`.qa-busy-hint` 的 6px/4px → `--space-icon`/`--space-1`；`.qa-dock .qa-q`、`.qa-dock .qa-a { max-width: 100% }`；`.qa-dock .qa-input-row .qa-input { min-width: 0 }`。
- 提交：`style(ui): 追问坞内排版归 token——近期行不写死 220、头部防挤爆、三条 padding 出基线`。

### 批4 — 卡片窗口感细化（P41，只做可验证小项）

- `.qa-dock-head` 底部 1px `--border` + `padding-bottom: var(--space-2)`（标题/chip/收起键与对话流分层）；坞整体 padding 维持 `--space-3`。
- `.qa-dock .qa-input-row { align-items: stretch }`，按钮 `flex: none` 与 textarea 等高；textarea 维持 `min-height: 44px` 与 `resize: vertical`。
- 间距单点定义：对话流与输入行之间的距离只在一处定义（排查 `.qa-log` margin-bottom 与坞 gap 叠加），注释写明。
- 入口钮与卡片同位置同值（右缘、垂直居中、宽度语义一致）；滚动条不新增（全站已统一定义）。
- 提交：`style(ui): 追问坞卡片窗口感细化——头部分隔/输入等高/间距单点定义`。

### 批5 — 验收工具对齐与新形态量测（P42）

- `scripts/ui-probe.mjs`：删/替 `clickTab(cdp, '追问')` 两处（`:458`、`:474`——该 tab 早已删除，量到的其实是当前页）；`MEASURE` 的 `qaDock` 扩充为 `{ w, h, top, bottom, left, right, position, blankRight, coversNote（左缘 < .note-viewer 右缘）, centerOffset（|坞垂直中心 − 视口垂直中心|）, viewportH }`；`probeMainPages` 增加「任务页/设置页无坞」实测；`summarize()` 摘要行与 zoom 档行改为打印：宽×高、右缘空白、是否压正文列、垂直居中偏差；**zoom 每个物理档位断言「坞宽 ≤ 380 CSS px 且坞高 ≤ 70vh」（用户「不占一小半」的可执行版）**。
- `scripts/smoke-cdp.mjs:356-363`：L4 从「坞常驻」改为「任务页首屏无坞；点笔记 tab 后坞出现」。
- 提交：`test(ui): 探针/smoke 对齐「坞只在笔记页」并量测右侧悬浮小卡片`。

### 批6 — 收口（门禁 / 实拍 / 文档 / 提交）

- 四门禁全量：`npm run lint && npm run typecheck && npm test && npm run build`。
- `npm run smoke`（构建 + smoke-cdp）全过（含改写后的 L4 坞断言）。
- 探针实跑：`node scripts/ui-probe.mjs`（默认窗）+ `--zoom`；关键数字（坞宽/高/右缘空白/是否压正文列/垂直居中偏差/zoom 各档 ✓✗）写进提交信息与 PROGRESS.md。
- 文档收口：`PROGRESS.md`（批0–批5 逐批一行 + 收口实测数字 + 已知代价）、`CHANGELOG.md [未发布]`（条目：只在笔记页 / 悬浮小卡片单一形态 / 排版归 token / 工具对齐）、`README.md` 测试数同步（docs-consistency 兜底）。
- 提交：`docs: 追问坞悬浮小卡片整改收口（PROGRESS/CHANGELOG/README 对齐）`。
- **不做**：版本 bump、tag、push、Release（未获发布指令，留待装机走查后统一发版）。

---

## 4. 决策项（全部按推荐执行）

| # | 决策 | 推荐 |
|---|---|---|
| D1 | 坞的可见范围 | **只笔记 tab**（用户两轮明示）。切 tab 丢草稿的代价可接受 |
| D2 | 形态数量 | **单一 fixed 悬浮小卡片**，取消 ≥1400/<1400 双形态与坞档断点（双形态本身正是他被否的原因） |
| D3 | 尺寸 | 宽 = 空白本身（封顶 260、下限 200）、高随内容 `max-height: min(84vh, 720px)`——用户两次「窄一点/再瘦长一点」；200 下限同时堵住「空白算成负值」的非法 width |
| D4 | 垂直位置 | **垂直居中**（`top:50% + translateY(-50%)`）——右上/右下两个角他都否了，居中即「在右边」且不挑角落 |
| D5 | 正文列 | **640 不动**，删 `:has(.qa-dock)` 拉伸；`style-scale` 钉住反转为「宽屏零 min-width」 |
| D6 | 「整体优化」范围 | 只做能量测的小项（卡片窗口感/间距/入口钮/排版归 token）；新问题记 PROGRESS 遗留，不擅自扩批 |

## 5. 验收清单（每批可执行）

- [ ] 批0：spec 批注①、SKILL §3/§5 与 §2 规格表逐条一致；「宽屏零 min-width」写进 SKILL。
- [ ] 批1：任务页、设置页**无** `.qa-dock`/`.qa-dock-launcher`；笔记页按折叠态出现；折叠→恢复循环（app-shell 用例）。
- [ ] 批2：style.css 无 `:has(.qa-dock)`、无坞相关 min-width 断点；坞宽 `min(380px,…)`、`top:50%`、`right: var(--space-5)`；`style-scale` 全绿（宽屏零 min-width）。
- [ ] 批3：`KNOWN_PADDING_VIOLATIONS` 精确少两条（.qa-a/.qa-q）、'8px 11px' 改写为只剩 .task-error；style-scale 全绿。
- [ ] 批4：头部分隔线、输入行等高、无双倍 gap；入口钮与卡片同位置同值。
- [ ] 批5：探针量到「任务/设置页无坞」「zoom 各档坞宽 ≤380 且坞高 ≤70vh」「垂直居中偏差 ≤8px」「1600 CSS 下 coversNote=false」；smoke L4 改写后通过。
- [ ] 批6：四门禁 + smoke + 探针数字入 PROGRESS；CHANGELOG/README 对齐；`git status` 干净、无敏感文件。
- [ ] P44/P45（收口订正，均已实测）：默认窗坞 = **260×620、右缘空白 24、垂直居中偏差 0、压正文列「否」**；窄窗（960）坞 200×165、工具行横向溢出 0、无负宽；坞头无 chip（组件级 + 样式级双钉住）。

## 6. 风险与回滚

- **最大结构风险 = 批2 取消坞档断点**：1400 档整块删除，`style-scale` 宽屏断言必须同批从「唯一 min-width 是 1400」反转为「零 min-width」；单独落地任一半都会红。回滚 = 还原 style.css 坞段与对应测试，两个提交可独立 revert。
- **窄物理窗（<1420 CSS）会压住正文列一部分**：卡片 380px 右缘对齐时左缘约 976（视口 1366），正文列右缘 968——会压约 60px 正文。接受（用户明要「悬浮小卡片」；可一键折叠）；探针 `coversNote` 如实记录，不漂白。
- **垂直居中 + 长对话**：对话变长时卡片从中心向两端扩张，触到 `max-height` 后稳定；`translateY(-50%)` 不依赖内容高度，无跳变。
- **坞只在笔记页 = 切 tab 丢草稿**：已知代价，写入 PROGRESS；若试用后要求保留，再抬 `draft` 到 App state（小改，不进本方案）。
- **窄物理窗（≤1100 CSS、侧栏展开时）仍会压住笔记**：空白算出来为负，`max(200px, …)` 把宽度兜在 200——那种窗下「侧栏 304 + 阅读列 640」本就装不下卡片，重叠不可避免（≤1024 侧栏自动收起后反而放得下；再窄可一键折叠）。探针 `coversNote` 如实记「是」，不漂白。
- **P43 的教训**：固定悬浮卡片的宽公式必须从「正文右缘」算起并留 gap——按视口比例算（`min(380px, 100vw - 48px)`）在默认窗会盖住工具行右端与封面，而工具行/导出按钮正是功能所在。
