# 双源并列与全面 UX 审查整改方案

- 日期：2026-09-07
- 状态：已批准（Andiii「都按照你推荐的去做」，D1=A/D2=A/D3=A/D4=A/D5=A）· 批1-6 落地（4b2afa7…d28d18b，四门禁 691/691），批7 列遗留
- 触发：Andiii 实测反馈四问题 + 授权全量审查（「找出所有的问题来，制定详细方案，审阅通过后再做」）
- 审查方式：全量 renderer 组件代码走读（App/TopBar/TaskPanel/MindMap/BiliImport/QaPanel/NoteViewer/CourseTree/MyStudyPanel 亲读 + 其余 18 个组件委托 Explore agent 全量扫描，58 项发现）+ 真实库 CDP 截图 13 张（`.tmp-audit-shots/`，gitignored，留档供翻阅）+ CSS 层级分析。

---

## 一、Andiii 四问核实结论

### 1. 东大/B站层级不对等 —— 属实，且比描述的更严重

- B站入口是侧栏**最底部**折叠 `<details class="manual-fallback bili-import">`（App.tsx:300），与「手动添加（后备）」**共用同一套「后备功能」样式**（muted 小字 summary、`margin-top:auto` 沉底、border-top 分隔；style.css:1184 起，B站面板样式是在后备样式上打补丁长出来的——style.css:1501 注释自证）。
- TopBar 右上只有 CAS 会话徽标 + 「登录 CAS」按钮（TopBar.tsx:61-73）；B站登录状态**没有任何常驻可见位置**——必须展开那个底部折叠面板才能看到。
- 设置页「账号」块只覆盖 CAS（SettingsPanel.tsx:75-94）；首访引导 WelcomeGuide 三步全是 CAS 路径（登录 CAS→配 Provider→选课），B站用户第一步就走不通（WelcomeGuide.tsx:19-31）。
- 结论：B站是被当成「侧栏小工具」接进去的，与「并列内容源」的产品定位不符。

### 2. 思维导图折叠倒三角 —— 属实

- MindMap.tsx:490：折叠态 `M -3 -5 L 5 0 L -3 5 Z`（右指三角）、展开态 `M -5 -3 L 0 5 L 5 -3 Z`（下指三角），均为三角形 path。
- 顺带：课程树/分组折叠用的是 lucide ChevronDown/Right（箭头形），风格也不统一。

### 3. 「多样思维导图是否真正加进去了」—— 全部在代码里，且真实数据验收过；问题不在缺失，在**可发现性**

导图拓展（Map Expansion，2026-09-05）11 批次功能全部落地并当日真实验收（1690625-L0 真实笔记、CDP 截图 9 张、四门禁 587/587）：

| 功能 | 位置 | 状态 |
|---|---|---|
| 深度控制（全部收起/展开L2/L3/全部展开） | MindMap 工具栏 | ✅ 在 |
| 节点搜索（命中高亮+自动展开祖先+滚动定位） | MindMap 工具栏 | ✅ 在 |
| Ctrl+滚轮缩放 / 拖拽平移 / +-0 键盘缩放 | MindMap 画布 | ✅ 在 |
| 回忆模式（遮罩+逐个揭示+全部揭示） | MindMap 工具栏 | ✅ 在 |
| 焦点下钻（双击节点聚焦子树+面包屑返回） | MindMap 画布 | ✅ 在 |
| 概念浮层（ℹ️：关联概念定义+锚定自测题+跳转详细视图） | MindMap 节点右下 | ✅ 在 |
| 概念关联虚线（conceptLinks+关系标签） | MindMap 布局 | ✅ 在 |
| 导出 SVG | MindMap 工具栏 | ✅ 在 |
| 课程导图对话框（多课时聚合树） | 课程行分支图标按钮 | ✅ 在 |

**但可发现性差**：工具栏 8+ 个按钮挤一行无分组；「双击下钻」没有任何提示（面包屑只在下钻后才出现，用户不知道有这个能力）；ℹ️ 按钮很小无 title；课程导图入口是课程行一个 13px 小图标。「功能在但用户感知不到」正是 Andiii 产生此疑问的原因，批3 一并解决。

### 4. 失败任务重试后看不到状态 —— 属实，三个叠加根因

- **根因A（主）**：任务页在「未选中课时」分支（全局任务视图）**完全不渲染进度卡**（TaskPanel.tsx:98-111 只有 EmptyState+历史列表）。从全局列表重试失败任务后，进度事件照常流入 state，但 UI 上没有任何地方显示——Andiii 命中的就是这个。（选中课时分支有进度卡，新建任务可见正是这个差异。）
- **根因B**：历史行不实时刷新。`onProgress` 只在 `succeeded` 时 `loadGlobalHistory`（App.tsx:984-998）；**`failed` 分支根本不刷新列表**（App.tsx:999-1006，只重算 running）——顺带实锤一个存量 bug：任务失败后，历史行仍显示旧的活动状态+「取消」按钮，点它会报「取消失败」。运行中行也全程显示旧状态。
- **根因C**：排队中（pending）行的「启动」按钮在有任务运行时是**死点击**——`retryTask` 里 `if (running) return` 静默返回（App.tsx:1399-1405），按钮只按 `disabled={running}` 置灰，行为对但「启动」语义误导。

---

## 二、问题全清单

> 来源标注：〔报〕=Andiii 报告；〔审〕=本轮代码/截图审查；〔扫〕=Explore agent 扫描。级别：P0=体验断裂，P1=高频摩擦，P2=打磨。批次列见第三节。

### P0（4 项核心 + 3 项顺带实锤 bug）

| # | 问题 | 位置 | 来源 | 批次 |
|---|---|---|---|---|
| 1 | 双源层级不对等（入口沉底共用后备样式/会话无常驻位/引导单路径/设置页账号块缺 B站） | App.tsx:300、TopBar.tsx:61、SettingsPanel.tsx:75、WelcomeGuide.tsx | 〔报〕 | 批1 |
| 2 | 重试后进度不可见（全局视图无进度卡） | TaskPanel.tsx:98-111 | 〔报〕 | 批2 |
| 3 | 历史行不实时刷新 + **failed 后不刷新（存量 bug：显示旧状态+可点取消）** | App.tsx:978-1007 | 〔审〕 | 批2 |
| 4 | 排队行「启动」按钮运行中死点击 | TaskPanel.tsx:300-304 + App.tsx:1399 | 〔审〕 | 批2 |
| 5 | 导图折叠倒三角 | MindMap.tsx:490 | 〔报〕 | 批3 |
| 6 | 导图功能可发现性差（工具栏无分组/双击无提示/面包屑无常驻/课程导图入口小） | MindMap.tsx:339-408、CourseTree.tsx:116 | 〔报+审〕 | 批3 |
| 7 | 任务起步阶段（0%）进度条完全静止，无 indeterminate 模式、无百分比读数 | ProgressBar.tsx:8-15 | 〔扫〕 | 批2 |

### P1（高频摩擦，14 项）

| # | 问题 | 位置 | 来源 | 批次 |
|---|---|---|---|---|
| 8 | 错误 toast 6.5s 自动消失、无关闭按钮、无 hover 暂停——长错误读不完即消失 | use-toasts.ts:21、ToastArea.tsx | 〔扫〕 | 批4 |
| 9 | QA 失败无内联痕迹（问题气泡入列但永无回答，无重试入口）；busy 时 Enter 静默吞掉 | QaPanel.tsx:107-129、App.tsx ask() | 〔扫〕 | 批4 |
| 10 | openPath 返回值被丢弃——目录不存在/打开失败=死按钮无反馈 | use-config-domain.ts:183-188 | 〔扫〕 | 批4 |
| 11 | refreshProviders/refreshSettings 静默失败——设置页永远空白无错误无重试 | use-config-domain.ts:46-54 | 〔扫〕 | 批4 |
| 12 | toast 无上限可堆叠遮挡 TopBar；类型仅靠 8px 色点区分 | style.css:1107-1143 | 〔扫〕 | 批4 |
| 13 | ManualAdd：失败清空用户输入（ID 难查重输成本高）、无 busy、无回车、按钮文案「添加课程」与表单不符 | ManualAdd.tsx:12-25 | 〔扫〕 | 批5 |
| 14 | 设置页五连：expired 仍显示过去的「有效期至」；主题下拉加载闪变；libraryRoot 占位「…」语义不明；「迁移完成需重启」只活在 3.5s toast 里；缓存保存无 dirty 检查无确认 | SettingsPanel.tsx:43-127 | 〔扫〕 | 批5 |
| 15 | LessonChip 无兄弟课时时仍是可点击外观（死端 hover） | LessonChip.tsx:42-54 | 〔扫〕 | 批5 |
| 16 | 概念卡时间戳死端（可点击外观无响应）；时间戳/「展开全部引文」双入口重复 | NoteBlocks.tsx:50-54、183-203 | 〔扫〕 | 批6 |
| 17 | 图片放大对话框：「取消」+「关闭」双按钮；标题直出内部 ref 标识；Esc 行为与遮罩点击在各弹层间不统一 | NoteBlocks.tsx:217-268、Dialog.tsx vs CourseMapDialog.tsx | 〔扫〕 | 批6 |
| 18 | NoteLibrary 200 条平铺：无分组无筛选无搜索，课程一多不可用；v2 徽标/v日期回显等细节 | NoteLibrary.tsx:30-53 | 〔扫〕 | 批6 |
| 19 | 阅读视图知识树 vs 导图能力悬殊（无批量展开/收起）；课程导图不支持 Esc、空树无空态 | NoteBlocks.tsx:124-156、CourseMapDialog.tsx | 〔扫〕 | 批3 |
| 20 | PrintHandout：自测题答案与题目并排直接可见（自测交互在纸上失效）；「课堂画面」空小节仍渲染 | PrintHandout.tsx:113-139 | 〔扫〕 | 批6 |
| 21 | 展开状态以数组索引为键——重新生成笔记后展开态「串卡」到错误条目 | NoteBlocks.tsx:95-103、164 | 〔扫〕 | 批6 |

### P2（打磨，10 项）

| # | 问题 | 位置 | 来源 | 批次 |
|---|---|---|---|---|
| 22 | QuizCards 翻面后无「收起」暗示 | NoteBlocks.tsx:112-115 | 〔扫〕 | 批6 |
| 23 | 缩略图「引用/就近」徽标术语不透明无 tooltip | NoteBlocks.tsx:209、262 | 〔扫〕 | 批6 |
| 24 | QA 同面板两种时间格式；「最近追问」选中课时后彻底不可见 | QaPanel.tsx:99-106 | 〔扫〕 | 批6 |
| 25 | MdLite 内联标题与页面骨架竞争层级（h3） | MdLite.tsx:28 | 〔扫〕 | 批7 |
| 26 | EmptyState 与 WelcomeGuide 两套几乎相同卡片实现 | EmptyState.tsx vs WelcomeGuide.tsx | 〔扫〕 | 批7 |
| 27 | ErrorBoundary 错误直出技术信息、无复制/打开日志入口；局部错误整窗 reload 丢上下文 | ErrorBoundary.tsx:39-55 | 〔扫〕 | 批7 |
| 28 | testProvider 无并发保护可连点；saveProvider 部分失败后列表不刷新 | use-config-domain.ts:64-115 | 〔扫〕 | 批7 |
| 29 | 弹窗背景可滚动（图片放大时后面内容在动）；Dialog 无焦点陷阱 | Dialog.tsx | 〔扫〕 | 批7（只做滚动锁+Esc 统一） |
| 30 | busy 视觉无统一模式（文本型/纯置灰型/无反馈型三种并存） | 全局 | 〔扫〕 | 批7（梳理约定） |
| 31 | 「已处理✓」徽标二态语义；B站面板 session 状态仅 mount 时读取（面板常驻不重查） | LessonChip.tsx:68、BiliImport.tsx:71-75 | 〔扫〕 | 批1（随对话框重构解决 B站侧） |

---

## 三、修复方案（七批）

> 原则：每批独立提交、测试只增不减、行为契约改动落钉住测试；反门控反截断命名要全的品味不变。

### 批1 双源并列（信息架构，P0）

**目标**：东大云课堂与 B站在一切用户可见的层级上平级。

1. **TopBar 双会话徽标并列**：右上改为两个同构徽标 `[● 东大·已登录] [● B站·未登录]`（+最左运行中 pill 保留）。
   - 东大徽标 = 现有 session-badge + 登录/退出按钮合并：未登录/过期点击→登录流程（现逻辑）；已登录点击→退出确认（现对话框）。
   - B站徽标：未登录点击→打开 B站导入对话框（内含扫码）；已登录点击→同样打开导入对话框（B站上下文里做导入最自然；退出登录放对话框内账号行）。
2. **新组件 `BiliImportDialog`**（迁移 BiliImport 面板全部逻辑，参照 CourseMapDialog 自绘弹层并补 Esc/遮罩关闭）：
   - URL 输入+解析 → 预览卡（封面/标题/UP/分P chips/全选清空/约 N 分钟）→ B站账号行（常显登录状态+已登录时「退出登录」）→ 导入按钮。
   - 未登录点导入：对话框**原地**展开二维码（180→220px 放大），扫码确认后自动继续导入（pendingPages 机制已有）。
   - 对话框每次打开重查 session 状态（修 #31 的 stale 问题）。
3. **侧栏**：删除底部 B站 details；侧栏头部「刷新课程」旁加同重按钮「导入 B站视频」→ 打开上述对话框。手动添加保留底部（真后备），summary 改「高级：手动添加课程 ID」。
4. **WelcomeGuide 双路径**：步骤 1 改为「获取课程视频」，下方两按钮并列：「登录东大云课堂」/「导入 B站视频」；步骤 3 说明按所选来源走（选课或粘贴链接）。
5. **SettingsPanel 账号块**：加 B站行（状态+退出登录），与 CAS 行同构。
6. 侧栏底部两 details 的 `.manual-fallback` 样式只服务手动添加（回归其「后备」本义）。

**测试**：新增 top-bar（双徽标+点击行为）、bili-import-dialog（session 重查/退出/QR 流/导入回调，从 bili-import.test.tsx 迁移扩展）；welcome-guide、settings-panel、app-shell（入口接线）更新。IPC 零新增（login/loginStatus/logout/session/resolve/import 通道已全）。

### 批2 任务链路可见性（P0）

**目标**：任何视图、任何来源的任务，状态实时可见；起步阶段有活动感。

1. **全局任务视图渲染进度卡**：TaskPanel `noLesson` 分支在 EmptyState 与列表之间插入 `TaskStatusCard`（progress != null 时）——重试后立刻看到六阶段轨道。EmptyState 文案改为轻引导（「从左侧选择课时，或用上方 B站导入添加视频」）。
2. **历史行实时刷新**：App `onProgress` 维护 `lastProgressKey`（taskId+state+stage），变化时 `loadGlobalHistory()` + `loadHistory(currentLesson)`；**failed 分支同样刷新**（修存量 bug：失败后行显示旧状态+可点取消）。succeeded 分支维持现行为。
3. **排队行「启动」按钮**：running 时禁用 + title「队列忙碌，将自动开始」，修死点击误导。
4. **ProgressBar**：active 且 percent===0 时 indeterminate 动画（低宽度往复，CSS）；TaskStatusCard 进度条右端加百分比读数。
5. TopBar 运行中 pill 可点击 → 跳任务页（顺路小甜点）。

**测试**：task-panel（noLesson 进度卡/启动禁用/百分比）、app-shell（**钉住：failed 事件后 globalHistory 重拉**——存量 bug 的钉住测试）、progress-bar（indeterminate）。

### 批3 导图体验（P0）

**目标**：折叠符圆点化；已有功能被看见。

1. **折叠符 ▸/▾ → 圆点**（MindMap.tsx:487-498 重画）：
   - 折叠态：**实心圆点**（accent 色，r≈4.5）+ 后代计数胶囊（保留）；
   - 展开态：**空心圆环**（text-muted 描边，同尺寸）；
   - hover/热区/键盘语义不变；课程树 Chevron 不动（树形结构用箭头是惯例，导图用圆点）。
2. **工具栏分组**：`[全部收起|展开L2|展开L3|全部展开] · [重置视图] · [回忆模式] · [导出SVG] · [搜索框]`——组间细分隔线，文案全保留（反截断）。
3. **可发现性**：
   - 有子节点的节点 title 补「双击聚焦此分支」；
   - 面包屑栏**常驻**（未下钻时显示灰色「全图」占位，让用户知道焦点机制存在）；
   - ℹ️ 按钮 title「查看关联概念与自测题」。
4. **阅读视图知识树**（NoteBlocks tree-view）区块标题右侧加「全部展开/收起」小按钮（对齐导图能力）。
5. **课程导图对话框**：Esc 关闭；lessons===0 显示空态卡（「该课程还没有可用笔记，生成笔记后自动出现在导图中」）替代空画布。

**测试**：mindmap（caret 圆点类名断言替换三角断言/面包屑常驻/title）、note-blocks（树批量展开）、course-map-dialog（Esc/空态）。

### 批4 错误反馈体系（P1）

**目标**：错误不再稍纵即逝；失败操作留痕可重试。

1. **Toast 升级**：error 类**常驻+手动关闭**（×按钮）；success/info 维持自动消失但也加关闭按钮；同屏上限 3 条（超出合并为「还有 N 条通知」）；类型图标（lucide Check/AlertTriangle/Info）。
2. **QA 失败内联**：失败的问答在对话流中渲染为错误气泡（红边框+原因+「重试」按钮重发该问题），不再只靠 toast。
3. **QA busy Enter**：busy 时 Enter 不再静默——输入框上方 inline 提示「上一条还在回答中…」。
4. **openPath 结果检查**：失败 toast（含原因，如「目录尚未创建」）。
5. **设置加载失败显式化**：refreshProviders/refreshSettings 失败→设置页对应区块显示错误行+「重试」按钮。

**测试**：use-toasts（error 常驻/关闭/上限）、qa-panel（失败气泡+重试+busy 提示）、settings 错误态、misc（openPath）。

### 批5 表单与设置细节（P1）

1. **ManualAdd**：仅成功后清空输入（失败保留）；busy 禁用+「添加中…」；Enter 提交；按钮文案「添加课程与课时」；placeholder 补示例格式。
2. **设置页**：expired 显示「已于 X 过期」；主题 select 在 settings 未加载时禁用（防闪变）；libraryRoot 占位「加载中…」；迁移完成后在账号块下方**常驻**提示条「资料库已迁移，重启应用后生效」（重启前不消失）；缓存「保存」按钮 dirty 检查（值未变禁用）。
3. **LessonChip**：无兄弟课时时降级为纯文本胶囊（去 hover/cursor，修死端）。

**测试**：manual-add、settings-panel、lesson-chip 各补用例。

### 批6 笔记阅读细节（P1/P2）

1. **概念卡时间戳**：点击滚动定位到时间线对应条目（at 值匹配），修死端；时间戳按钮仅在 refs>1 时呈现可点击态（收敛双入口）。
2. **图片放大对话框**：标题改人类可读（所属时间线/概念条目+时间戳，ref 降为次要信息）；单「关闭」按钮；遮罩点击关闭（查看型弹层统一）；打开时锁 body 滚动。
3. **缩略图徽标**：title 补全语义（「笔记引用的画面」/「未引用时就近选取的关键帧」），文案改「引用画面/临近画面」。
4. **QuizCards**：展开态答案下方弱化提示「点击收起」。
5. **展开键稳定化**：引文/翻面展开集合以内容稳定 id（at+ref）为键，防重新生成后串卡。
6. **NoteLibrary**：按课程分组（可折叠组：课程名+条数+教师），行内课程名与课时名视觉分离；v 徽标 title「第 n 次生成」；无效日期回退「—」。
7. **QA 时间统一**：最近追问列表改相对时间（与对话流一致）。
8. **PrintHandout**：自测题改为题目区在前、答案区集中小节末尾（保留自测交互的纸面价值）；「课堂画面/方法论」空小节不渲染。

**测试**：note-blocks、note-library、qa-panel、print-handout 对应用例。

### 批7 打磨杂项（P2，可裁）

1. MdLite 内联标题 h3→h4（不与页面骨架竞争）。
2. EmptyState 支持 actions 数组，WelcomeGuide 收敛为其变体（删两套实现）。
3. ErrorBoundary：加「复制错误详情」「打开日志目录」按钮（联动已有能力）。
4. testProvider 测试 busy 禁用按钮（并发保护）；saveProvider 部分失败时也 refreshProviders+toast 说明「Provider 已保存，能力 X 绑定失败」。
5. Dialog 背景 body 滚动锁（若批6 未覆盖全部弹层则此处统一）。
6. busy 视觉约定梳理：统一「文案…+禁用」模式并记录进 AGENTS/样式注释。

---

## 四、决策点（请 Andiii 裁决）

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| D1 | B站主入口形态 | A=侧栏顶部「导入 B站视频」按钮+全功能对话框；B=侧栏固定卡片（不折叠不弹窗，占侧栏常驻空间）；C=TopBar 按钮 | **A**——与「刷新课程」并列最直白；对话框给二维码/预览足够空间；侧栏零常驻负担 |
| D2 | TopBar 形态 | A=双会话徽标并列（东大/B站各管各的登录态，点击即操作）；B=保留「登录 CAS」按钮原样+仅加 B站小徽标 | **A**——「并列关系」最直接的表达就是两个同构徽标；也顺手解决会话状态无常驻位 |
| D3 | 折叠圆点形态 | A=实心圆（折叠）+空心圆环（展开），保状态区分；B=纯实心圆点（最简，状态区分交给计数胶囊的有无） | **A**——空心/实心一眼可辨，计数胶囊继续承担数量信息 |
| D4 | 错误 toast 策略 | A=error 常驻+手动关闭；B=延长 15s+hover 暂停 | **A**——错误是必须读完的内容，读完再关；实现也简单 |
| D5 | 本轮范围 | A=批1-6 全做+批7 列遗留；B=只做批1-4（核心）；C=批1-7 全做 | **A**——批5/6 都是高频摩擦且改动小；批7 碎、收益边际，列遗留不阻塞 |

## 五、明确不做（本轮记录）

- MdLite 完整 markdown（链接/表格渲染）——回答以纯文本为主，拍平可接受；需要时另立项。
- NoteLibrary 全局全文搜索（分组已解决主要痛）。
- Dialog 完整焦点陷阱（本轮只统一 Esc+滚动锁；完整 a11y 另立项）。
- 侧栏可折叠、路由库/多窗口、导图换 markmap/d3（既有决定维持）。
- QA 跨课时历史常驻入口（recent 已覆盖无课时态）。
- 课程树 Chevron 箭头改圆点（树形折叠用箭头是跨应用惯例，与导图不同域）。

## 六、验收方式

1. 每批：`npm run lint && npm run typecheck && npm test` 全绿，测试数只增不减；关键行为契约（failed 刷新/进度卡可见性/双徽标）落钉住测试。
2. 批1/批3 完成后：ui-shots.mjs 更新探针（B站对话框入口、双徽标、导图圆点+分组工具栏），真实库截图双主题核验（`.tmp-audit-shots/` 留档模式沿用）。
3. 全部完成后：Andiii 装机走查清单——①未登录态首屏（引导双路径+双徽标）②B站导入全程在对话框内完成（解析→扫码→导入）③全局任务视图重试可见进度 ④导图圆点+下钻提示 ⑤错误 toast 手动关闭。
