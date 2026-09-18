# 方案：全应用排版系统化整改（2026-09-18）

> 状态：**已批准，执行中**（2026-09-18 Andiii「现在就请你按照计划去一步一步执行。如果遇到问题，都按你推荐的去做」→ D1-D11 全取推荐侧）。
> 触发：Andiii「我感觉这个项目的 UI 排版上还有很多问题需要提升。你把这些问题都找到，最后写一份这个计划供我审阅」。
>
> 取证方式：**不读码猜，全部实测**。三条只读代码审计（style.css 2079 行通读 + 31 个组件逐个过）+ 真实应用实拍 15 张（13 张主流程 + 2 张空库首启） + CDP 几何探针（`.ui-shots/probe.json`、`.ui-shots/probe-empty.json`）。真实 Library 与已安装版全程未触碰（沿用 `scripts/ui-shots.mjs` 的库隔离缝：拷贝 app.db 到临时目录 + `SEU_SUMMARY_DOCS_OVERRIDE`）。
> 下文每个数字都是实测值（CSS px）。基线：master `0245140`、0.7.6 测试构建、1025/1025 测试。

---

## 执行期修正与教训

- **批0（2026-09-18）两处偏差，均已记账**：
  1. **padding 归一挪到批1**。批0 原写「13 种 gap / 40 种 padding 一起归到最近档」，实做时只做了 gap / line-height / letter-spacing：padding 的 40 处正是批1 要用 `.card`/`.row` 等基元按**角色**收口的那批，先按数值归一等于同一批地方改两遍。故 padding 的刻度化并入批1，一次性按角色落定。
  2. **刻度保留 `--space-icon: 6px` 档（D1 的备选）**。D1 推荐 4/8/12/16/24+2，把 6px 归到 4 或 8 都不对：图标↔文字压到 4px 在最小窗口下更挤，放宽到 8px 会让工具行更宽、加剧 T1/批5 的挤压。6px 在这里**有唯一语义**（图标↔文字），不是「说不清的第三个值」，故保留并加了钉住测试（`--space-icon` 只允许出现在点名的图标/标签容器上）。
  3. 顺带修了 `letter-spacing: 3px`（设置页页脚箴言）——它是全站唯一装饰性字距，不删，收成 `--tracking-seal` 并注明别处不得引用；`.sidebar-head h2` 的 `text-transform: uppercase` 对中文是空操作，删除。
  4. 重复选择器合并采用「**合并到最后一处**」：同 at-rule 上下文里同一选择器重复定义时，后者对同属性必然胜出，故合并到后处可证明等价（新增声明按首次出现顺序、值取最后者）。13 个选择器、26 个编辑区间，`.mindmap-node, .mindmap-edge` 因一个在 `@media (prefers-reduced-motion)` 里而**正确排除**（at-rule 上下文不同，合并会改语义）。

- **批1（2026-09-18）六处落地决定**：
  1. **基元落地方式**：不往 JSX 里加新类名，而是把成员选择器挂进基元的选择器列表，并把成员规则里被基元接管的声明**删掉**（不是覆盖）——所以每个角色在文件里只有一处定义。唯一动 JSX 的是 `MyStudyPanel`（T31：它是全仓唯一用 Tailwind 任意值的组件，`text-[12px]/text-[11px]/text-[10px]/p-2.5/tracking-[1px]` → `.study-panel/.study-group/.study-group-head/.study-hint/.count-pill`）。
  2. **卡片 padding 单值化**：`.card` 12px、`.card-lg` 16px。原方案写的「12px 14px」里的 14 不在刻度上（批0 定的是 4/8/12/16/24），故取单值。
  3. **列表行分三档**：`.row` 8/12（历史行、笔记库行、考点卡）、`.row-sm` 8/10（provider 行、课程行、升级行）、卡内行 4/8（`.course-card-lesson`）——原来 6 种 padding 收敛成 3 个有角色的档位。
  4. **分段标签按钮内边距取 `--space-2` 而非 `--space-icon`**：批0 新增的钉住测试当场拦下了这个误用（`--space-icon` 是「图标↔文字」专用档），改用 8px 后顺带让标签页按钮与 `.btn` 同高。
  5. **计数药丸锁 16px、标签族锁 18px**：T26 的「同一行 4 种高度」（17.2/16.2/23.2/23）由此消失；半像素 padding（`1.5px`/`2.5px`）一并去掉（T27）。
  6. **弹窗标题统一 16px**（`.dialog-title` + 三个自绘弹层的 `h2`），层级问题（h2/h3 混用）留批6；容器内边距落刻度：侧栏 12/12/16、内容区 16/24/24、顶栏 8/12（品牌左缘因此与侧栏「课程」同轴）。

- **批2（2026-09-18）**：T1 修后实测按钮 **62×115 / 57×115 / 85×115 → 220×37**（单行整宽竖排）；T5 实测列表溢出 **+21px → −21px**（弹窗加宽到 560px，列表收进框内）；零课程时主区渲染 `.welcome-guide-main`（860×263）而侧栏保留紧凑版，负向断言「不许出现『从左侧课程树点击一个课时』」已入测试。

- **批3b（2026-09-18）导图几何三处**：①断行改以词/禁则为单位（`wrapTitleLines` 先分词，拉丁/数字连写不可分；单词语长到放不下才硬切；空格补在上一行尾以保住「`lines.join('') === 原文`」这个不截断不变量）——实拍里「经典激活函数：Sigmoid, Tan / h」不再被拦腰切开；②标签胶囊盒宽改按**中文字宽**（`labelBoxWidth`，CJK = 1 个字宽、ASCII ≈ 0.55），屏幕端与 **SVG 导出端**都改（导出端此前同样是按拉丁字宽估的同一个缺陷）；③**适应窗口**（D11）：首屏自适应一次 + 按钮（原「重置视图」）+ `0` 键，scale 夹在 0.4..1（只缩小不放大），并把滚动位置居中到内容上。真实数据实测三态：内容本来就装得下时 scale = **1.0**（证明不会放大）、按 3 次 `+` 到 **1.728** 后点适应窗口回到 **1.0** 且 `fits:true`、窄窗 597px 视口下 **0.843**（708×928 → 597×783 全可见）。
  测试处置：更新两条既有断言（工具栏标签 `重置视图`→`适应窗口`；缩放测试改为断言「装进视口」而非回到 1:1——happy-dom 量不到 `clientWidth`，故测试显式 stub 视口尺寸），把一条**钉住具体切点**的断言改成性质断言（断行以词为单位后切点会移动，钉切点等于把实现细节当契约）；新增 3 条纯函数测试（拉丁词不被切开、超长词硬切、标签盒宽按中文字宽）。测试数 1040 → 1043。

- **⚠️ 批1 埋下并当场修掉的一个坑（写进纪律）**：清理脚本 `strip-decls.mjs` 的 `PLAN` 里，`.empty-state, .welcome-guide` 写的是**合并选择器全文**，与批1 新建的基元规则同名 → 脚本按 `endsWith` 匹配到基元那条，把**基元的 padding 删了**（而不是成员规则的），空规则随后被当作「空块」删除。因为断言数的是**键**不是**规则条数**，两条规则同键时它报 1、不报错。发现方式=批2 的 CDP 探针读到侧栏卡片 computed padding 仍是 `26px 22px`（旧值），而基元本该给 `16px 24px`。纪律：**基元与成员的清理必须靠「改后实拍/探针复核」，脚本的断言挡不住同名选择器**；清理脚本的 PLAN 只写单个选择器，绝不写合并选择器全文。

---

**排版问题不是「这里差了 2px」的零散瑕疵，是三层结构性缺失**——所以本方案的第一步不是改观感，是**先把刻度和基元建起来**，否则每一批改造都会重新定价一次。

1. **没有排版刻度**。token 层是完整的「色 / 圆角 / 阴影 / 字号 / 字体」，但**间距、行高、字距一个 token 都没有**，全是逐处手写。实测分布：`gap` 13 种取值（8×34、6×25、10×25、12×10、4×8、3×7、7×6、2×4、5×2、9、1、16、0）、`padding` 约 40 种、`line-height` 9 种、`letter-spacing` 6 种手写 px。每处单看都合理，连起来读就是「没对齐过」。
2. **同一个角色有多套实现**。「分段标签」×2 套度量、「卡片」×11 种 padding、「列表行」×6 种 padding、「组头」×7 种写法、「空态」×5 种形状、「数字计数」×4 种画法、「模态遮罩」×2 种裸 rgba + 4 套宽度。相邻两屏切换时能看出「胖瘦变了」。
3. **没有任何宽度断点**。全仓只有 2 个 `@media`，都是 `prefers-reduced-motion`。窗口到下限 960 时内容盒只剩 598px，`860`（页面轴）与 `680`（正文轴）两个 max-width **同时失效**，只能靠 flex 硬挤——实测笔记工具栏行高 25→43px（按钮标签被压到逐字换行）、任务列表的失败原因列 440→128px。

**最疼的一条单独说**：**首启空库的引导卡**——三个行动按钮实测 `62×115` / `57×115` / `85×115`，标签被逐字换行成三根竖排字条（截图 `.ui-shots/empty/welcome-tasks.png`）；与此同时主区 962px 几乎全空，还写着「从左侧课程树点击一个课时即可创建任务」——而左侧一门课都没有。这是新用户看到的第一屏。

**这一版要做的事**：建刻度（批0）→ 建 6 个共享基元（批1）→ 按 P0→P2 分 9 批把分歧收敛掉，共 11 批。预期效果不是「更好看」，而是**同一个角色在哪都长一样、长文读起来不累、窄窗不塌**。

---

## 1. 现状量化（实测）

### 1.1 token 层盘点

| 类别 | 是否有 token | 实况 |
|---|---|---|
| 颜色 | ✅ 完整 | `:root` 32 个值 + 暗色双块（`style.css:65-98` 与 `102-133`，注释要求两处同步改） |
| 圆角 / 阴影 / 字号 / 字体 | ✅ 有 | `--radius-sm/--radius/--radius-lg`、`--shadow-sm/…`、`--font-size-xs/sm/md/lg/xl`、4 个字体栈 |
| **间距** | ❌ **无** | 全库 grep `--space-\|--gap-\|--pad-` **0 命中** |
| **行高** | ❌ 无 | `line-height` 9 种取值分散写成 1.55/1.6/1.65/1.7/1.8/1.85/1.5/1.3/1.25 |
| **字距** | ❌ 无 | 0.3 / 0.5 / 1 / 1.2 / 1.5 / 3px 六种手写 |
| **内容轴** | ✅ 有 | `--content-max: 860px`（`style.css:43`）；正文另有硬编码 `680px`（`style.css:1912`） |
| 死引用 | ❌ 1 处 | `.dialog-title { font-size: var(--font-size-base) }`（`style.css:810`）——**`--font-size-base` 全仓未定义**，该声明失效 |

### 1.2 关键几何实测

| 项 | 实测 | 含义 |
|---|---|---|
| 内容盒 / 页面轴 / 正文轴 | 962 / 860（`328→1188`）/ 680（`328→1008`） | **同屏两个右缘，差 180px** |
| 题头（masthead）宽 | 860（文武线打到 1188） | 分隔线比每一行正文多伸出 180px |
| 笔记正文行长 | 14px / 1.7 → **48.3 全角字/行**（676px 实测） | CSS 注释自称目标「34-38 字/行」（`style.css:1909`）——**实现与声明漂移** |
| 笔记标题 | 20px 楷体，2 行，43 字/行 | 与页面标题「笔记」（同为 20px 楷体 h2）同级 |
| 主标签 vs 笔记标签 | `6px 18px`/14px/高 39 ↔ `5px 14px`/12.5px/高 35 | 同一「分段标签」角色两套度量 |
| `.note-actions`（7 键） | 宽窗高 25px → 960 窗高 **43px** | 按钮标签被压到折行（`.btn` 无 `white-space: nowrap`） |
| 任务列表失败原因列 | 宽窗 440/390px → 960 窗 **178/128px** | 2 行截断下每行只放得下约 9 个汉字 |
| 任务列表列漂移 | 失败原因左缘 677 ↔ 519；按钮左缘 531 ↔ 716 | **列表没有列**，每行形状都不同 |
| 升级旧笔记弹窗 | 列表右缘 864 > 弹窗右缘 843（**溢出 21px**） | `.note-upgrade-list{min-width:420px}` vs `.dialog` 内容盒 378px |
| 首启引导按钮 | 62×115 / 57×115 / 85×115 | 标签逐字换行成竖排 |
| 空态卡 | `padding: 26px 22px`，860×158 | 与任务/笔记列表同宽的巨型空卡 |

> 两轴分离的触发条件：窗口 >1032px 时 `860` 与 `680` 两个右缘开始分离，默认窗口（实测视口 1266）下满额 180px；窗口 <1032px 时两者都被压到同一宽度，缺陷不可见（但这不代表窄窗没问题——见 2.A/2.C 的实测）。

> 重跑方式：`node .ui-shots/probe-layout.mjs --width=960`（真实库）与 `--empty --shot`（空库首启）。脚本目前是 gitignored 的临时工具，见 D9。

---

## 2. 问题清单（T1-T51，全部有证据）

级别口径：**P0** = 任何用户一眼看出「坏了」；**P1** = 明显的质量差距；**P2** = 打磨。

### 2.A 首启与空库（P0 集中区）

| # | 问题 | 证据 | 级别 |
|---|---|---|---|
| T1 | 首启引导卡三个按钮被压成竖排字条 | 实测 62×115 / 57×115 / 85×115；`.guide-actions,.empty-actions{display:flex;gap:10px;justify-content:center}`（`style.css:1574`）**无 flex-wrap、无 min-width**；`.btn`（`style.css:511-523`）**无 `white-space:nowrap`** | **P0** |
| T2 | 主区空态文案与侧栏自相矛盾 | 零课程时侧栏说「开始使用：1 获取课程视频 2 配置 Provider 3 选择课程」，主区说「先选择课时：从左侧课程树点击一个课时」——左侧无课（`TaskPanel` 空态 / `App.tsx:197` `showWelcome = tree.length === 0`） | **P0** |
| T3 | 引导内容被塞进 304px 侧栏，主区 962px 空着 | 引导卡实测 269×360 在侧栏；主区空态卡 860×158 几乎全白 | **P1** |
| T4 | 空库仍渲染「全部任务（最近 50 条）」标题，下面只有「暂无任务」 | `.ui-shots/empty/welcome-tasks.png` | P2 |
| T5 | 「升级旧笔记」弹窗列表溢出弹窗外框 21px | 实测 listRight 864 vs dialogRight 843；`style.css:1305` `min-width:420px` + `style.css:802-809` `.dialog` 内容盒 378px；只有 `:has(.consent-body)`/`:has(.legal-scroll)` 两条加宽规则 | **P0** |

### 2.B 阅读排版（正文本体）

| # | 问题 | 证据 | 级别 |
|---|---|---|---|
| T6 | 正文行长 48.3 全角字/行（目标 34-38） | 实测 676px ÷ 14px；注释 `style.css:1909` 自称 34-38 | **P1** |
| T7 | `.note-body` 声明的阅读字号从未生效 | `style.css:1911-1916` 写 `max-width:680px; font-size:15.5px; line-height:1.85`，但正文实由 `.note-section p`（`1352`，14px/1.7）与 `.md-lite .md-para`（`1615`，14px/1.7）渲染 → 15.5/1.85 对任何一段真实正文都不适用 | **P1** |
| T8 | 「次级文字」这一档被通配规则整体吃掉 | `.note-section p`（特异性 0,1,1）压过 `.concept-def`/`.concept-example`/`.step-explain`/`.quiz-answer`/`.feedback-hint`（均 0,1,0）→ 概念定义、步骤解释、自测答案全部按 14px/1.7 渲染，笔记正文只剩一种字号 | **P1** |
| T9 | 同屏两个同级 20px 楷体 h2 | `PageHeader`「笔记」（`style.css:403`）与 `.note-title` 课程名（`style.css:1938-1945`）同族同号同重 | **P1** |
| T10 | 文档层级在屏幕端扁平 | `.md-lite .md-h` 对 h2/h3 一视同仁（`1616` 14px），只有 `.md-h1` 升到 16px（`1617`）；`MdLite.tsx:68` 把 md h1-h4 映射到 h4-h6 后 CSS 只区分一档 | P2 |
| T11 | 屏幕端与 PDF 端的标题层级整体错一位 | 屏幕笔记小节 `<h3>`（`NoteViewer.tsx:357`）↔ PDF `<h2>`（`PrintHandout.tsx:51…`）；课时标题屏幕 `h2` ↔ PDF `h1` | P2 |
| T12 | 段落间距因块类型而异 | `<p class="note-para">`（`NoteBlocks.tsx:38`）走 `.note-section p{margin:3px 0}` → 段距 6px；markdown 段落走 `.md-lite{gap:8px}` → 段距 8px。模型输出哪种是随机的 | **P1** |
| T13 | 关系标签胶囊宽度按拉丁字宽估算，3 个汉字起就溢出 | `MindMap.tsx:492/494/536` `width = label.length*6.5+10`，而 `.mindmap-link-label` 是 10px 中文（每字 ≈10px）→ 4 字 40px vs 盒 36px | **P1** |
| T14 | 导图节点文字在拉丁词中间断行 | 实拍：节点显示「经典激活函数：Sigmoid, Tan\nh」 | P2 |
| T15 | 导图打开不自适应视口（已有台账记录） | `PROGRESS.md:7`：两课时课程导图 svg 938×1420 vs 视口高 525 → 竖直只显示约 37%；无 fit-to-view，「重置视图」只回 1:1 | **P1** |
| T16 | 长 B站 标题占满最显眼位置且不降档 | 实拍：20px 楷体两行「（中英字幕完结）斯坦福CS224N《深度学习自然语言处理》全集课程！附课件代码 \| 2025最新」 | **P1** |
| T17 | 题头分隔线比正文多伸 180px（同屏两个右缘） | 实测 masthead 328→1188 vs 正文 328→1008；`style.css:1936` 文武线打在 860 容器上 | **P1** |
| T18 | 反馈输入框漏了行高 | `.feedback-text`（`style.css:1894-1904`）设了字体/边框/内边距却**没有 line-height**，与 `textarea.qa-input{line-height:1.5}`（`1391`）手感不一致 | P2 |
| T19 | 小节分隔线上下间距不对称 | `.note-section{padding:14px 2px 20px; margin-bottom:4px}`（`1342-1343`）：线上 24px、线下 38px | P2 |

### 2.C 刻度与基元（结构性）

| # | 问题 | 证据 | 级别 |
|---|---|---|---|
| T20 | 无间距 token，13 种 gap / ~40 种 padding 并在 | 见 §1.1；`7px` 一类「6 与 8 之间的第三种值」在 `.crumbs`(207)/`.running-pill`(259)/`.session-badge`(286)/`.course-tree`(560)/`.course-card-head`(748)/`.course-card-main`(758) 等处反复出现 | **P1** |
| T21 | 卡片 padding 11 种 | `.task-status` 14/16、`.settings-block` 14/16、`.note-health-panel` 12/16、`.timeline-card` 12/14、`.concept-card` 10/12、`.formula-item` 10/12、`.quiz-card` 10/12、`.provider-row` 8/10、`.course-card` 9/11、`.dialog` 18/20、`.empty-state` 26/22 | **P1** |
| T22 | 列表行 padding 6 种 | `.history-row` 9/12、`.note-library-row` 9/12、`.callout-item` 9/12、`.provider-row` 8/10、`.course-head` 8/9、`.note-upgrade-row` 6/8 | P2 |
| T23 | 组头写法 7 种 | `.sidebar-head h2`（650/1.2px/muted/uppercase）、`.subheading`（620）、`.note-library-group-toggle`（620）、`.course-browser-head h2`、`.note-section h3`（16px 楷）、`.settings-block h3`（16px 楷）、`MyStudyPanel.tsx:46` Tailwind | **P1** |
| T24 | 计数画法 4 种 | 裸数字（`.course-count`、`.all-courses-count`）、药丸（`.tree-count` `padding:0 7px`、`.note-library-count` `1px 8px`）、Tailwind 药丸（`MyStudyPanel.tsx:64`） | P2 |
| T25 | 空态 5 种形状 | `EmptyState` 卡（860×158）、`.msg` 一行（860×19）、`.course-browser-empty`（24/4）、`.course-map-empty`（min-height 200 居中）、裸 `.dialog-message` | **P1** |
| T26 | 徽标族同排 4 种高度 | `.chip` `2px 10px`、`.badge` `1.5px 8px`、`.course-browser-select` `4px 8px`、`.btn.small` `3px 10px` 并在 `style.css:752` 的同一 flex 行 | **P1** |
| T27 | 半像素 padding 让文字落在非整数像素 | `.badge{padding:1.5px 8px}`（856）、`.bili-chip{padding:2.5px 10px}`（2044） | P2 |
| T28 | 用负 margin 抵消 flex gap（2 处硬补丁） | `.task-status-lesson{margin:-6px 0 10px}`（880）、`.bili-dialog-hint{margin:-4px 0 0}`（2004） | P2 |
| T29 | 12 个选择器被定义两次，产生死声明 | `.qa-q`(1365/1964)、`.qa-a`(1375/1965)、`.note-section h3`(1347/1922)、`.settings-block h3`(1451/1971)、`.concept-term`、`.timeline-title`、`.timeline-stamp`、`.feedback-hint`、`.mindmap-label`、`.md-table td`、`.timeline-quote.best`、`.mindmap-scroll` | P2 |
| T30 | 8 个 className 渲染出来但没有任何 CSS | `note-para`（有 `.note-section p` 兜底）、`show-more`、`note-health-toggle`、`bili-selected-note`、`mindmap-relation-node`、`md-ordered`；**`capability-group`/`capability-check`（`ProviderPanel.tsx:152/154`）无兜底** → 三个能力复选框挤成一行文字 | **P1** |
| T31 | 一个面板单独用 Tailwind 任意值绕过 token | `MyStudyPanel.tsx:44-110`：`gap-1.5`/`p-2.5`/`text-[12px]`/`text-[11px]`/`text-[10px]`/`tracking-[1px]`，而其兄弟 `.all-courses-head` 是 12.5px；全仓仅此一文件用工具类 | **P1** |
| T32 | 圆角裸值 5 种，且子元素比父元素更圆 | token 是 4/6/10，实用 8/6/3/10/12；`.formula-item{radius:6px}` 内含 `.formula-code{radius:8px}`；`MindMap.tsx:496/508/536/570/586` `rx=8/9` | P2 |
| T33 | 暗色下没有一条排版微调规则 | `[data-theme]` 只出现在两个 token 块（66/102），无第三条规则；正文细衬线（`--font-serif`）在 `#171b19` 上发虚 | P2 |

### 2.D 一致性与可达性

| # | 问题 | 证据 | 级别 |
|---|---|---|---|
| T34 | 弹窗标题引用了不存在的 token → 标题与正文同号 | `style.css:810` `var(--font-size-base)` 未定义；实测弹窗标题 = 14px = `.dialog-message` | **P0** |
| T35 | 四个自绘弹层的遮罩/圆角/内边距/宽度四套 | `.dialog-backdrop` `rgba(10,12,18,.45)` z60 无高度钳制 / `.course-browser-*` `rgba(18,22,20,.5)` z40 `min(1440px,98vw)`×`92vh` 固定 / `.course-map-*` `96vw` pad24 / `.bili-dialog-*` `96vw` pad18；共享 `Dialog` 反而最紧（420px / 6px 圆角） | **P1** |
| T36 | 共享 `Dialog` 无 max-height、无滚动区 | `style.css:802-809`；滚动预算散落四处（`.consent-body` 46vh、`.legal-scroll` 62vh、`.feedback-body` 46vh、`.note-upgrade-list` 320px） | **P1** |
| T37 | 关闭动作位置不统一 | 共享 `Dialog` 在底部右侧（`ui/Dialog.tsx:67-82`），三个自绘弹层在右上角标题行 | P2 |
| T38 | 弹窗标题层级不一致 | 共享是 `<h3>`（`ui/Dialog.tsx:64`），自绘是 `<h2>` | P2 |
| T39 | 三处「展开/收起」工具栏按钮集与顺序都不同 | 侧栏 `App.tsx:459-466`（全部展开/全部收起，左对齐拉伸）、树视图 `NoteBlocks.tsx:175-182`（同序，右对齐）、导图 `MindMap.tsx:370-381`（**逆序** L2/L3/全部展开） | **P1** |
| T40 | 课程三键在侧栏与全屏浏览页里顺序镜像 | `CourseTree.tsx:111-134`（删除→导图→星标）↔ `CourseBrowser.tsx:337-360`（星标→导图→删除） | P2 |
| T41 | 三个面板的行动按钮没有统一位置约定 | `TaskPanel.tsx:132-139` 两个裸按钮无容器无 gap（只靠行内空白分隔）、`NoteViewer` 工具行（primary 靠 `margin-left:auto`）、`SettingsPanel` 全部内联、`HistoryList` 右贴、`NoteLibrary` 右贴按钮簇 | **P1** |
| T42 | 同一动作两个动词 / 同一目标两个标签 | 「更改」（`SettingsPanel.tsx:158`）vs「浏览…」（`:180`）；「打开」「打开导出目录」「打开日志目录」三种 | P2 |
| T43 | 工具行的分组规范只在一处存在 | 导图工具栏有分组分隔线（`.mindmap-toolbar-divider`，`style.css:1792`；`MindMap.tsx:383/386`）；而笔记工具行 `.note-actions` 的 7 键（体检/重新生成/复制 Markdown/导出 Anki/导出 Markdown/导出 Obsidian/导出 PDF）**平铺无分组**，其中 4 个是同一族的导出动作（实拍 `03-note-detailed.png`） | **P1** |
| T44 | 提示 glyph 只有 9px | `.info-glyph{font-size:9px}`（1811）；同类 `.stage-name`/`.caret`/`.thumb-origin`/`.caret-count`/`.mindmap-link-label`/`.ai-tag` 都是 10px（低于 `--font-size-xs:11px`） | P2 |
| T45 | 截断处 tooltip 给的是平台 id 而不是人话 | `TaskPanel.tsx:309-311` `<span class="history-lesson" title={row.lesson_id}>`，屏幕上截断的是「课程 · 课时」 | **P1** |
| T46 | 长 token（URL/JSON）在两处会撑破容器 | `.qa-error-msg`（`style.css:1134`，内容 `QaPanel.tsx:130` 的原始报错）与 `.error-boundary p`（1984）是仅有的两处漏点——同文件其它 5 处都补了 `overflow-wrap:anywhere`（1213/1239/1309/2038/2054） | **P1** |

### 2.E 数字 / 时间 / 单位 / 导出

| # | 问题 | 证据 | 级别 |
|---|---|---|---|
| T47 | `formatTime` 可以输出 `01:60` | `src/shared/notes/format.ts:6-11` `Math.round(seconds % 60)`：119.6 → `01:60`，59.6 → `00:60`；可达路径含时间戳、概念引用、缩放弹窗标题、PDF、Markdown/Obsidian 导出 | **P1** |
| T48 | 三种日期渲染 + 任务列表完全不显示时间 | `SettingsPanel.tsx:62` `toLocaleString()`（无 locale 无选项）；`NoteLibrary.tsx:21` 与 `QaPanel.tsx:45` 同一实现的两份拷贝（回退值已分叉）；任务历史查了 `created_at`（`src/main/ipc.ts:883`）但 `TaskPanel` 里**没有任何时间渲染** | **P1** |
| T49 | 时长两种单位 | `BiliImportDialog.tsx:295` 「约 42 分钟」（`totalMinutes`）vs 全局 `mm:ss` | P2 |
| T50 | 打印讲义与屏幕零共用一套语言 | `grep -c 'var(' print.css` = **0**；print.css 自带一整套靛蓝/中性灰调色板（`#3b5bdb` 等）+ 单一字体（`PrintHandout.tsx:236-271` 的 SVG 也是靛蓝）→ 同一棵知识树屏幕是墨绿、PDF 是靛蓝 | **P1** |
| T51 | 讲义字号/几何常量散在三处 | `print.css:15-18`（A4/165mm）、`PrintHandout.tsx:222-226`（730×900）、`src/main/notes/pdf-export.ts:36`（英寸边距） | P2 |

---

## 3. 方案

### 批0 — 刻度与死引用（机械、低风险，但后面每批都依赖它）

1. `:root` 新增三组 token（**不改任何现有值以外的语义**）：
   - `--space-1..5: 4/8/12/16/24px`（+ `--space-0: 2px` 仅供图标与文字之间）
   - `--leading-tight/snug/normal/relaxed: 1.3/1.55/1.7/1.85`
   - `--tracking: 0.5px`、`--tracking-wide: 1px`（去掉 3px 与 1.2px 这类孤值）
2. 把现有 13 种 gap / 40 种 padding / 9 种 line-height / 6 种字距**归到最近档**（6/7/9/10/14/18/22/26 → 4/8/12/16/24 就近，保留 6px 仅用于「图标与文字之间」这一个语义）。
3. 修 `--font-size-base` 死引用（`style.css:810`）→ 取 `--font-size-lg`（16px），恢复弹窗标题层级。
4. 合并 12 个重复选择器（T29）：删死声明，保留唯一一处。
5. 补 `capability-group`/`capability-check` 的布局（T30）：复选框组按 `.capability-model-row` 同款 flex 行排。

**不变量**：不改变任何组件的结构、不加新 class、不改文案。
**风险**：像素会动（这是本批的目的），必须逐屏实拍对照。

> 反例警戒：这一步**不能**用「全局替换像素值」的脚本一把梭——`.caret` 的 10px 与 `.empty-state` 的 26px 归到同一套刻度会撞车。批0 是按语义归类，逐处判断，工作量集中在这里。

### 批1 — 六个共享基元（把「同一角色多套实现」收敛）

在 style.css 建立 6 个基元并让现有选择器复用它（不引入组件库、不动 JSX 结构，除 T30 一处）：

| 基元 | 收敛对象 | 规格（推荐值，见 D4） |
|---|---|---|
| `.seg-tabs` | `.tabs` + `.note-tabs` | 同字号同内边距，唯一差异只允许「换行与否」 |
| `.card` | 11 种卡片 padding | `12px 14px`（大卡 14px 16px 由 `.card-lg`） |
| `.row` | 6 种列表行 padding | `8px 10px` |
| `.group-head` | 7 种组头写法 | 12.5px / 620 / `--text-muted`（仅侧栏一级用 14px/650） |
| `.count-pill` | 4 种计数画法 | 统一药丸，高度对齐 `--font-size-xs` 行盒 |
| `.empty` | 5 种空态 | 组件两种形态：卡（大区）/ 一行 `.msg`（小区），不再有第三、第四种 |

同时把 T26（同排 4 种高度）、T32（圆角裸值）、T27（半像素）、T28（负 margin 补丁）、T44（9/10px 字号）一并收口。

### 批2 — 首启与空库（P0）

- T1：`.empty-actions` 加 `flex-wrap: wrap` + `.btn { white-space: nowrap }`（**推荐 D6**）；侧栏内改为整宽竖排按钮（269−44 = 225px 可用，6 字标签足够）。
- T2/T3：零课程时主区渲染**三步引导**（复用 WelcomeGuide 的内容，改为主区大卡），侧栏保留紧凑清单；空态文案去掉「从左侧课程树点击一个课时」这类零课程下不成立的说法。
- T4：空库不渲染「全部任务（最近 50 条）」标题。
- T5：`.note-upgrade-list` 去掉 `min-width:420px`，改为跟随弹窗宽度；给 `.dialog` 加 `:has(.note-upgrade-list)` 加宽到 560px（与 consent 同档）。

### 批3 — 阅读排版

- T6/T7：正文列与字号按 **D2** 定案（推荐 `680→640`、`14→15px`、`1.7→1.85` → 42.7 字/行）；删掉从未生效的 `.note-body` 字号/行高声明，改为真正生效的那一处。
- T8：把 `.note-section p` 的通配改成只作用于直接段落，恢复 `.concept-def`/`.step-explain`/`.quiz-answer`/`.feedback-hint` 的次级字号。
- T9/T16：建立标题降档规则——课时标题 >28 字降一档（17px/1.45）并保留全文 tooltip；页面标题与课时标题不再同级。
- T10/T11：给 `.md-h` 补 h2/h3 两档；对齐屏幕端与 PDF 端的层级映射。
- T12：段距统一（`.note-para` 与 `.md-para` 同值）。
- T17：按 **D3** 定案，把文武线收到正文列。
- T18/T19：补 `.feedback-text` 行高；小节线上下对称。
- T13/T14/T15：导图侧——关系标签宽度按**中文字宽**测量（`measureText` 或按 CJK 计数 ×10px）、节点文字按词边界断行、加 fit-to-view（**D11**）。

### 批4 — 溢出与截断（P0 一条）

- T46：给 `.qa-error-msg`/`.error-boundary p` 补 `overflow-wrap: anywhere`（与同文件 5 处一致）。
- T45：截断 tooltip 改成人话（`taskLabel(row)` 全文），保留 `lesson_id` 只给日志/反馈。
- 复核全部 `title=` 与 ellipsis 组合（现状已覆盖度高，只补漏点）。

### 批5 — 窄窗（首次引入宽度断点）

- 建立**唯一一套断点**：`@media (max-width: 1180px)`（内容盒 < 860）与 `@media (max-width: 1024px)`（< 680）。
- 1180：工具行真正折行（允许换行到第二行，而不是压扁按钮）；`.note-toolbar` 的次导出键收进「更多」或缩短为图标+tooltip（**D5 备选 B**）。
- 1024：侧栏默认折叠、`.content` 内边距收到 16px、正文列改流式。
- T36：给共享 `Dialog` 补 `max-height: 86vh` + 内部滚动区，清掉四处散落的滚动预算。

### 批6 — 一致性收口（低风险、纯观感）

T37、T38、T39、T40、T41、T42、T43、T24。

### 批7 — 数字 / 时间 / 单位

T47（`formatTime` 进位，附单测 `119.6 → '02:00'`）、T48（统一一个 `formatStamp` 到 `shared/`，任务列表补时间列）、T49。

### 批8 — 暗色

T33（暗色下无一条排版微调规则）、T35 的遮罩改 token，并加 6 个暗色 subject ink 变体（当前 `#3d5a80` 对 `#171b19` 实测对比度 **2.46:1**，低于图形元素所需的 3:1；数值为按 WCAG 相对亮度计算，实施时以实拍复核）。

### 批9 — 讲义与屏幕同一套语言（**需单独裁决，见 D8**）

T50/T51：print.css 改用同一套 token（宣纸墨绿 + 文楷标题 + 宋体正文），几何常量收成一处。

### 批10 — 文档与台账

PROGRESS/ROADMAP/README 同步；`docs/skills/` 补一页「排版规范」（刻度表 + 6 个基元 + 断点表），供后续会话不再重新定价。

---

## 4. 决策点（每条都给了推荐）

| # | 决策 | 推荐 | 理由 / 备选 |
|---|---|---|---|
| **D1** | 间距刻度取值 | **4/8/12/16/24**（+2px 仅图标与文字之间） | 覆盖面够、记忆成本低。备选：加 6px 档（代价是又一次「差 2px 说不清」） |
| **D2** | 正文列宽与字号 | **640px + 15px + 行高 1.85**（48.3 → 42.7 字/行） | 一次动三件，收益最大；仍高于传统 34-38 是因为 680 是历史锚点，一步到 560 会显得「版心突然瘦了」。备选 A：只把字号提到 15.5（43.9 字）；备选 B：一步收到 560（40 字）；备选 C：不动 |
| **D3** | 题头文武线是否跟正文列 | **跟（860 → 640）** | 2026-09-07 的裁决原文理由是「课时标题在五个视图里保持一个恒定宽度」——收窄后五视图仍然一致，故不冲突；同屏两个右缘是可核验缺陷 |
| **D4** | 分段标签统一到哪一档 | **14px / `6px 16px`**（即主标签现档） | 主标签是主导航，应比笔记子标签大；实测笔记 5 标签升到 14px 后宽约 410px，860 轴内仍有余量 |
| **D5** | 窄窗策略 | **只用 CSS 断点，不改窗口下限 960** | 备选 B：把 `minWidth` 提到 1100（改窗口下限会影响小屏/投影用户，不推荐） |
| **D6** | `.btn` 是否加 `nowrap` | **加**（配合 `flex-wrap: wrap`） | 不加就是「标签逐字换行」的根因（T1 实测 115px 高的按钮） |
| **D7** | 首启引导的落点 | **主区承接三步引导，侧栏留紧凑清单** | 备选：只修侧栏按钮形态（改动最小，但 T2 的矛盾文案仍在） |
| **D8** | 讲义是否换成屏幕同一套语言 | **换（批9）** | 代价：已交付的 PDF 观感会变。备选：只统一字体与层级映射，保留靛蓝 |
| **D9** | 是否把探针脚本收进 `scripts/` | **收（`scripts/ui-probe.mjs`）** | 让「排版回归」可核验，而不是靠眼睛。备选：留在 gitignored 临时目录（下一轮审计要重写） |
| **D10** | 是否引入「token 存在性」钉住测试 | **引入** | 扫 style.css 里所有 `var(--x)`，断言都在 `:root` 或暗色块定义过——`--font-size-base` 这类死引用（T34）以后编译期就报 |
| **D11** | 导图 fit-to-view 是否本轮做 | **做（并入批3）** | `PROGRESS.md:7` 已记录实测（竖直只显示 37%）并标注「待 Andiii 点头」 |
| **D12** | 批8/批9 是否本轮做 | **批8 做、批9 延后** | 批9 影响已交付的 PDF 观感且工作量大，建议与其它一起看实拍后再定 |

---

## 5. 批次与提交计划

每批一个 Conventional Commit（`refactor(ui):` / `fix(ui):` / `style(ui):`），批批过四门禁 `npm run lint && npm run typecheck && npm test && npm run build`；**测试数只增不减**。

| 批 | 内容 | 规模 | 观感变化 |
|---|---|---|---|
| 0 | 刻度 + 死引用 + 重复选择器 | 中 | 全屏微调（必须逐屏对照） |
| 1 | 六个共享基元 | 中大 | 可见（同角色对齐） |
| 2 | 首启与空库（P0） | 中 | 首屏明显 |
| 3 | 阅读排版 + 导图几何 | 大 | 笔记页明显 |
| 4 | 溢出与截断 | 小 | 局部 |
| 5 | 窄窗断点 | 中 | 仅窄窗 |
| 6 | 一致性收口 | 中 | 局部 |
| 7 | 时间/数字/单位 | 小 | 任务页新增时间列 |
| 8 | 暗色 | 小 | 仅暗色 |
| 9（延后） | 讲义 token 化 | 中 | PDF 观感变化 |
| 10 | 文档与台账 | 小 | 无 |

依赖关系：**批0 必须先落**（批1-8 都引用它的刻度）；批2/批3 是 P0/P1 主体，建议优先。

---

## 6. 验收

1. **每批前后实拍对照**：`node scripts/ui-shots.mjs .ui-shots-audit-N/after --light`（+ `--dark`），批次目录进 `.gitignore`（已是）。
2. **几何数字回填**：`node scripts/ui-probe.mjs --width=960` 输出关键量（行长、两轴差、工具栏行高、空态按钮尺寸），批次提交信息里写「修前 X → 修后 Y」。
   - 目标值：行长 ≈42.7 字/行、两轴差 0px、`.note-actions` 在 960 下高 ≤25px、首启按钮高 ≤40px、升级弹窗溢出 0px。
3. **新增钉住测试**（只增不减）：
   - `style.css` 里每个 `var(--x)` 都有定义（D10）；
   - `formatTime(119.6) === '02:00'`、`formatTime(59.6) === '01:00'`；
   - 时间戳格式化只有一个实现（`shared/`），断言 `NoteLibrary`/`QaPanel`/`TaskPanel` 都从它取；
   - 首启：零课程时主区不出现「从左侧课程树点击一个课时」字样（负向红线写成正向断言）；
   - `.empty-actions` 的按钮容器声明了 `flex-wrap`（CSS 合同测试）。
4. **不动的**（回归护栏）：860 面板轴本身、`ui/Dialog` 机制、`CodeBlock`、`MdLite`/`InlineText`、`LessonChip`、`ToastArea`、`ProgressBar`、`CourseTree`/`CourseBrowser`/`NoteLibrary` 的长标题处理（现状已到位：`title` + ellipsis + `min-width:0` 全覆盖）、各面板的错误/加载态。

---

## 7. 红线与不做

- **不动**：`DISCLAIMER.md` / `src/shared/disclaimer.ts` / `appId` / npm 包名 / userData 目录 / `release/` 安装包 / ROADMAP 阶段划分。
- **不新增用户可见承诺**：本方案所有文案改动都是「把不成立的话改成人话」（如 T2），不新增承诺，故不触 spec §9；但**任何新增/改写的用户可见文案仍要 Andiii 过目**（口吻纪律：只陈述能核对的事实，不出现法律术语）。
- **不做**（记入候选，不擅自做）：引入 UI 组件库或 Tailwind 全面替换现有 class 体系（只把 `MyStudyPanel` 的任意值归回 token）、虚拟滚动、路由/多窗口、动画重设计、图标体系替换、markdown 链接渲染、笔记库全文搜索。
- **本方案不含**：任何功能新增（导图 fit-to-view 除外，它是已记录的实测缺陷且 D11 单列）。

---

## 8. 待你裁决

1. D2 的正文列宽/字号（这是「读起来累不累」最直接的一刀，也最容易凭感觉分歧，建议先看三档实拍对比再定）。
2. D7 首启形态（改主区结构，属观感方案而非纯排版）。
3. D8/D12 讲义换皮（会改变已交付 PDF 的外观）。
4. D9 探针脚本入仓（新增开发工具文件）。
5. 批次顺序：是否同意以「批0 → 批1 → 批2 → 批3」为主线（批0 是一切前提，批1 基元未落地前批3 的间距仍是散值），批4-批8 按你的优先级插队。
