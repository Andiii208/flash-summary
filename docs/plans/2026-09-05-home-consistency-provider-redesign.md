# 2026-09-05 首页一致性修复与 Provider 面板重设计方案

状态：**已批准（Andiii 2026-09-05「都按你推荐的来」），五批全部落地**——fcb21c4（批1）/ 7944dc4（批2）/ 6aa31b1（批3）/ 171de44（批4）/ 90e8476（批5）。四门禁 531/531；CDP 几何探针验收通过：任务/追问空态 head→卡片均 14px、manual-fallback 左缘 14px、goHome 后笔记空态卡片+工具栏隐藏、Provider 新布局截图核验。装机验收待 Andiii。
范围：渲染层 UI/UX 整改；不改 IPC 契约、不改数据库 schema、不改收割/登录导航流程。

## 一、问题清单（全部经代码审查 + CDP 几何探针 + 截图实证）

Andiii 报告 4 项，复核全部成立；排查中另发现 3 项同域问题（P5–P7）。

### P1 侧栏「手动添加（后备）」左缘错位（报告）

实测（CDP `getBoundingClientRect`）：`.sidebar-head h2`（「课程」标题）左缘 **14px**，`.manual-fallback summary` 左缘 **12px**，差 2px。
根因：侧栏文本元素统一补了 2px 水平内边距（`style.css` 中 `.sidebar-head`、`.tree-meta` 均有 `padding: 0 2px`），唯独 `.manual-fallback` 没补。

### P2 追问空态卡片与标题的间距 ≠ 任务页（报告）

实测：任务页「任务」标题 → 空态卡片垂直距离 **14px**；追问页「追问」标题 → 「从一条追问开始」卡片 **24px**。
根因：`.empty-state` 自带 `margin: 10px 0 16px`（style.css:1115）。任务页里它是 `.task-panel`（普通文档流）的直接子元素，与 `.page-head` 的 14px 下边距**合并取大者**= 14px；追问页里它被包进 flex 容器 `.qa-log`，flex 中 margin **不合并**，14 + 10 = 24px。

### P3 首页（起始态）笔记 tab 不原始（报告，核心抱怨）

现象：回到首页/冷启动后打开笔记 tab，显示的仍是之前某节已解析课时的笔记；且笔记板块没有任务/追问那样的空态卡片。三个独立根因：

- **3a** `clearLesson()`（app.tsx:838）只清 `currentLesson`/`qaEntries`/`attachmentManifest`，**不清 `note`**。点品牌回首页后 `lesson=null` 但 `note!=null`，NoteViewer 走 `note != null` 分支（NoteViewer.tsx:200）照常渲染旧笔记正文——同时导出/重新生成按钮因 `currentLesson===''` 已隐藏，呈现为半残状态。
- **3b** 冷启动恢复：UI 快照（含 `currentLesson` + `tab`）存 **localStorage**（app.tsx:66）。实测启动即恢复 `{"currentLesson":"1690406-L0","tab":"notes"}`——应用每次打开直接落在上次的课时和笔记页，不存在「干净的首页」。
- **3c** 笔记空态没有 EmptyState 卡片：只有一行 `.msg` 淡字 + 库列表行（截图 `.ui-shots/13-sidebar-bottom.png`）。任务页是「空态卡片 + 全部任务列表」，追问页是「空态卡片 + 最近追问列表」，笔记页缺卡片，三者不一致。

### P4 Provider 面板不便配置（报告，截图 `.ui-shots/15-settings-provider.png`）

- **信息架构**：预设下拉显示「OpenAI」、名称输入又显示「OpenAI」，重复两遍；ASR 转写/多模态总结/文本问答三个术语裸奔无解释；「尚未配置 Provider」空态卡片排在表单**下方**（状态倒置）。
- **结构性缺陷**：整个表单只有一个模型输入框，保存时把勾选的全部能力绑到**同一个模型**（use-config-domain.ts:66-72 循环 bind 传同一个 `input.model`）。勾「ASR 转写」+ 模型 `gpt-4o` 可以直接保存成功——hint 文字虽提醒 ASR 需要专门模型，但表单结构诱导踩坑。而数据层本就支持一能力一模型（`capability_bindings` 表按能力一行、`providers:bind` IPC 按能力单绑），纯 UI 没暴露。
- **运维缺失**：已配置 Provider 行只能删除不能编辑（改 Key/换模型须删掉重来）；「测试连接」空 Key 可点、必失败。

### P5 笔记空态下五视图切换工具栏照常渲染（新发现）

探针实测：无笔记时 `.note-toolbar` 仍渲染，「详细笔记/标准总结/要点/方法论/思维导图」五个 tab 全部可点——没有内容可切换，误导用户。任务/追问页空态均无此类残留控件。

### P6 设置页「任务缓存」输入框不回填（新发现）

SettingsPanel 的 `cacheDraft` 仅在 mount 时刻取 `props.settings?.cacheDir` 初值（useState 一次性快照），effect 只跟随 `chosenCacheDir`。settings 是 mount 后异步加载的——当设置 tab 为初始 tab（持久化恢复）时，输入框**一直显示空白**，用户会误以为没有配置缓存目录。

### P7 「测试连接」空 Key 可点（新发现，并入 P4 整改）

`canTest` 只校验 baseUrl + model，空 API Key 时可点击，必然失败，报错对用户无指导性。

## 二、整改方案（五批提交）

### 批 1 首页原始状态（P3a + P3b + P5）

1. `app.tsx` `clearLesson()` 补 `setNote(null)` —— 回首页/点面包屑清课后不再残留旧笔记正文。
2. UI 快照持久化从 localStorage 挪到 **sessionStorage**（仅 `seu-summary.ui-state.v1` 一项）：
   - 语义正好匹配两个场景：收割/登录导致的主窗口导航往返（同源同会话）**照常恢复**（批C 特性保留）；冷启动（新会话）拿到空快照 → 回到干净首页（本方案要的行为）。
   - `HARVEST_SEQ_KEY`、`JUMP_SKIP_KEY` 留在 localStorage（跨启动去重与偏好，语义不变）。
   - 取舍说明：窗口关闭后上下文即丢——收割/登录流程从不关窗，现状成立；若未来收割挪独立窗口需重审。
3. NoteViewer：`note == null` 时不渲染 `.note-toolbar`（五视图 tab、上一节/下一节、引用命中徽标、导出按钮组整体隐藏）；空态 = 卡片 + 库列表。
4. 测试（数只增不减）：
   - `app-shell.test.tsx`：`localStorage` 钉住测试同步改 sessionStorage；**新增**「sessionStorage 为空时冷启动落在任务 tab 且无选中课时」断言。
   - **新增**「goHome 后笔记 tab 显示空态而非旧笔记」钉住（组件级：NoteViewer 收 `note=null, lesson=null` → `.empty-state` 存在、`.note-toolbar` 不存在）。

### 批 2 间距与对齐统一（P1 + P2）

1. `.manual-fallback` 补水平 2px（`padding: 12px 2px 0`）→ summary 左缘对齐 14px 文本轴。
2. `.empty-state` 垂直 margin 收编为 0，间距交给容器：页头→卡片统一由 `.page-head` 的 14px 下边距提供；卡片与后列表之间由 `.qa-log` 的 gap / `.subheading` 的 margin-top 提供。`.welcome-guide` 与 `.empty-state` 共用选择器需拆开，侧栏引导卡保留自身 margin。
3. 验收：重跑探针，任务/追问两页 head→卡片距离一致（14px），manual summary 左缘 = 14px。

### 批 3 笔记空态卡片（P3c）

对齐任务页同构：**EmptyState 卡片 → h3 小节标题 → 列表行**。

1. `note == null && lesson == null`：EmptyState（「尚无笔记」语义保留）+ `h3.subheading`「全部笔记（最近 200 条）」+ NoteLibrary 行；删除现在的裸 `.msg` 行（标题进 subheading，与任务页「全部任务（最近 50 条）」同款）。
2. `lesson != null && note == null`：保留现有「「第N节课」尚无笔记 → 去创建任务」卡片（批E 已做对的部分），下方「或打开其他笔记」库列表不变。
3. 测试：`note-viewer.test.tsx` 对应断言更新 + 新增空态卡片/标题断言。

### 批 4 Provider 面板重设计（P4 + P7，克制版）

原则：只动 `ProviderPanel.tsx` + `use-config-domain.ts` 的 UI 组织，**不动 `providers:save`/`providers:bind` IPC 与数据库**（bind 本就按能力单绑）。

区块内顺序重排为：**能力说明 → 已配置列表（或空态卡片）→ 添加/编辑表单**。

1. **能力说明**固定一行三条，讲清能力 → 管线阶段的映射：ASR 转写（把录音转成文字，转写阶段）；多模态总结（看课件截图写笔记，总结阶段）；文本问答（回答追问，追问页）。
2. **按能力拆模型输入**：勾选某能力后，该能力出现独立的模型输入框，占位示例按能力区分（ASR → `whisper-1 / mimo-v2.5-asr`；多模态 → `gpt-4o / deepseek-chat`；文本 → `deepseek-chat`）。保存循环 bind 时传各自模型—— hook 里把 `input.model` 改为 `input.models: Record<capability, string>` 即可，bridge 签名不变。
3. **预设即名称**：选非「自定义」预设时隐藏名称输入（预设已含名称/BaseURL/默认对话模型），消除「OpenAI」显示两遍的冗余。
4. **Provider 行增强**：名称 + baseUrl 小字 + 每能力绑定徽标（`能力:模型`）+ 无 Key 警示 + 「编辑」按钮（回填表单并展开表单区）+ 删除（沿用现有确认对话框）。
5. **测试连接**：API Key 为空时禁用，占位提示「填写 API Key 后可测试」。
6. **状态前置**：未配置时空态卡片在上、表单默认展开；已配置后表单折叠进 `details`（「添加 Provider」），列表在上。
7. 测试（`tests/components/misc.test.tsx` 中现有 Provider 测试基础上新增）：每能力模型输入渲染断言、bind 调用携带各自模型断言、空 Key 禁用测试按钮断言。

### 批 5 设置页缓存输入回填（P6）

SettingsPanel 加 effect：`props.settings?.cacheDir` 到值/变化时回填 `cacheDraft`（选简单方案：直接覆盖——`refreshSettings` 只在设置变更后触发，覆盖无竞争）。
测试：新增「settings 后到时缓存输入回填」组件断言。

## 三、执行与验收纪律

- 每批一个 Conventional Commit（批1 fix(renderer)、批2 fix(ui)、批3 feat(notes)、批4 feat(settings)、批5 fix(settings)），提交前 `npm run lint && npm run typecheck && npm test` 全过。
- 视觉验收：重跑 `node scripts/ui-shots.mjs` 与根目录诊断脚本 `.ui-shots-extra.mjs`（验收后删除该临时脚本），核对：
  - 任务/追问 head→卡片 gap 均为 14px；manual summary 左缘 14px；
  - 冷启动落任务 tab 空态；goHome 后笔记 tab 为「卡片 + 全部笔记列表」；
  - Provider 新布局截图（浅色/深色各一张）；
  - 收割/登录导航往返后侧栏展开态与课时恢复（sessionStorage 语义验证）。
- `.ui-shots/` 下的新增截图不入 Git（沿用现有忽略规则）。

## 四、不做什么（边界）

- 不改 IPC 契约、数据库 schema、任务管线能力解析（`qaCapability` text 优先回退 multimodal 的逻辑保持）。
- 不做「重启后回到上次位置」的显式恢复入口——本版语义定为**冷启动 = 干净首页**；若以后想要，另立方案加「继续上次」入口。
- 不动 WelcomeGuide、收割/登录流程、思维导图与五视图渲染。
