# 装机实测整改第二轮 + 笔记反馈润色

- 日期：2026-09-07 · 状态：**已批准（Andiii「全部按照你推荐的方式」D1=A/D2=A/D3=A/D4=A/D5=A/D6=A）**
- 前置：双源并列批1-6 已落地（691/691）；本方案 = Andiii 装机 0.7.0 实测六问题 + 全量扫描补充发现的整改。
- 元结论：六报中三处是 2026-09-07 批1-6 的**回归或半成品**（toast 点击、弹窗位置、轴系统），两处是历史存量（PDF、胶囊），一处是新功能需求（反馈润色）。

---

## 一、现场问题与根因（六报全实锤）

| # | 现象 | 根因 | 位置 |
|---|---|---|---|
| 1a | error toast 不自动消失 | **设计行为**（批4 拍板「常驻+手动关闭」，替代读不完的 6.5s）——不修，但它的唯一出路「手动关闭」被 1b 弄死 | use-toasts.ts:36 |
| 1b | **点 × 关不掉** | `.toast-area { pointer-events: none }` 后从未在 `.toast`/`.toast-close` 恢复 `auto`，整块 toast 对鼠标透明，点击穿透；jsdom 不做 CSS 命中测试所以组件测试全绿 | style.css:1174 |
| 1c | 同一错误弹 3 条 | 入队**无去重** + 常驻 + 关不掉 + FIFO 上限 3——「恰好 3 条」就是上限本身；原计划的合并计数方案被 FIFO 简化替代后未补去重 | use-toasts.ts:31-34 |
| 2 | 退出确认弹窗顶对齐 + **黑色横栏** | Dialog 渲染在 `<header class="topbar">` **内部**，而 topbar 的 `backdrop-filter: blur(10px)` 使其成为 fixed 后代的包含块 → `.dialog-backdrop` 的 `inset:0` 不再相对视口而是相对 46px 高的顶栏：**黑栏=遮罩被压扁成一条**，顶对齐=`place-items:center` 在这条带子里居中。全仓 5 处 Dialog 仅此一处渲染进 topbar | TopBar.tsx:102-113、style.css:177、682-689 |
| 3 | 笔记/追问空态卡不对齐 | 笔记页空态卡与笔记库挂在 `.note-body`（**680px 阅读列**）内，其余页签都在 `--content-max` 860px 轴上 → 窄 180px；且 `.note-viewer` 在 CSS 中**零规则** → 页头破轴全宽，笔记页并存「页头全宽/工具栏 860/正文 680」三条右缘 | style.css:1517-1522、375；NoteViewer.tsx:216 |
| 4a | 长标题：详细笔记两行、思维导图一行铺满全窗 | 导图破格 `max-width:none` 打在祖先 `.note-body` 上，**masthead（大标题）被连带破格**；破格本意只该给 SVG 画布。且 masthead 平时 680 而工具栏 860，本就不同轴 | style.css:1523-1524、NoteViewer.tsx:217-222 |
| 4b | 右上角课程胶囊不美观 | 胶囊在 `.page-head`（全宽）右端，离 680 内容列脱节；440px 帽+双端省略；「详细笔记里像纯文本、导图里像胶囊」实为 passive/switchable **状态降级**差异，非视图分支 | style.css:378-403、LessonChip.tsx:28,58 |
| 5 | PDF 铺满整页、字面 `**`、极丑 | ① `formulasAndSteps.content/explanation`、examCues、quiz 问答、concepts.definition、timeline.detail 等**九类字段纯文本插值不解析 markdown**，而模型在这些字段里自由输出了 `**加粗**`（prompt 只约束 overview/methodology 用 Markdown）→ 字面 `**`；**屏幕端同字段同样显示字面 \*\*，是系统性缺口非 PDF 独有**。② 版式：`.ph-doc` 无行宽约束（行宽≈186mm 全幅）、页边距仅 12mm、公式/操作用 Consolas 且 `display:inline` 把多步操作折成一长行、所有小节标题同 15pt 无梯度、无页眉 | PrintHandout.tsx:87,89,108,114,131,140,69,181；summarize.ts:27；print.css:35-43,87-96,188；pdf-export.ts:30 |
| 6 | （新功能）笔记末尾反馈润色 | 见批5 设计 | — |

## 二、扫描补充发现（Andiii 未报，一并列出）

1. **`.toast-action` 按钮（「查看笔记/去任务页/去选课」）从 M1-3 起就点不动**——与 1b 同根因（pointer-events），一直无人报告。
2. **屏幕端九类字段同样显示字面 `**`**（与 PDF 同根因，批4 一起修）。
3. **版本上限 10 是「设计声明与实现漂移」实锤**：F6 整改声称「saveNoteVersion 后 DELETE 保留 10 版」，`grep DELETE FROM notes` 全仓零命中、无钉住测试——版本无限累积。润色功能会加速版本增长，必须顺带补上。
4. `regenerate` 无同课时幂等守卫：双击并发可撞 `UNIQUE(lesson_id,version)`（现靠 renderer regenBusy 单薄阻挡）；润色接入时一并补 handler 侧标记。
5. BiliImportDialog / CourseMapDialog 打开时**背景仍可滚动**（共享 Dialog 有滚动锁，两个自绘弹层没有）——批7 遗留 #5 的实底。
6. 批7 遗留打磨 6 项（MdLite h3 竞争层级 / EmptyState 与 WelcomeGuide 两套实现 / ErrorBoundary 直出技术信息无复制日志按钮 / testProvider 可连点+saveProvider 部分失败不刷新 / 弹窗滚动锁 / busy 视觉三态并存）+ 旧遗留（ManualAdd 无回车提交、课时行截断无 title、资料库迁移按钮无 busy 防护、死令牌清理）。

---

## 三、整改批次

### 批1 Toast 修复（问题 1）——`fix(toast)`

- `style.css`：`.toast` 恢复 `pointer-events: auto`（容器 none 保持，不挡下方页面）。顺带复活 `.toast-action`（补充发现 1）。
- `use-toasts.ts`：入队**同文本去重合并**——相同 `kind+message` 的既有 toast 不重复入队，改为 `count+1` 并刷新其位置；ToastArea 显示 ×N 计数徽标。error 常驻语义不变（批4 D4 已拍板）。
- 测试：去重/合并纯函数化进 `use-toasts` 可测路径；组件测试补「重复 toast 合并计数」「dismiss 移除」；真实点击穿透 jsdom 测不了，验收走 CDP 几何/命中探针（ui-shots 增 toast 探针）。

### 批2 弹窗出 topbar + 滚动锁统一（问题 2 + 补充 5）——`fix(dialog)`

- `TopBar.tsx`：改返回 Fragment——`<header>` 与 `<Dialog>` 成为兄弟（Dialog 祖先链上不再有 backdrop-filter，`fixed; inset:0` 回归视口，居中+全屏遮罩一并恢复，黑栏随之消失）。z-index 60 > topbar 10，遮罩正常盖住顶栏。比 portal 更简单，JumpConfirmDialog 有「渲染在骨架外」先例。
- `BiliImportDialog.tsx` / `CourseMapDialog.tsx`：补 body 滚动锁（对齐共享 Dialog 的做法）——批7 #5 就此收口一半（焦点陷阱仍列遗留）。
- 测试：TopBar 组件测试断言 Dialog 不在 header 子树内；真实居中走 CDP 几何探针（backdrop 尺寸=视口）。

### 批3 笔记页轴系统统一（问题 3+4）——`fix(notes-layout)`

- 轴口径（D2，推荐 A）：**页头/页签工具栏/空态/笔记库统一 860px，正文阅读列保持 680px**（34-38 字/行的可读性是 V4 实测结论，不动）。
- `NoteViewer.tsx`：masthead 移出 `.note-body`（置于 note-toolbar 之后、note-body 之前）——五视图共用、恒 860 同轴，导图视图不再连带破格；`.note-body` 只装正文内容与画布。
- `style.css`：`.note-viewer { max-width: var(--content-max) }`（页头破轴收口）；空态卡/`.note-library`/`.subheading` 脱离 680 列（随 masthead 移出与容器豁免，二选一以 diff 小者）；导图破格保留但只作用于画布层。
- LessonChip：随页头回 860 轴；视觉微调（底色/边框对比度、缩窄 max-width）。passive/switchable 双形态是功能语义（能否切课）保留，仅调观感。
- 导图视图层叠拥挤：masthead 回轴后与 mindmap-toolbar 形成稳定两级（860 页头区 → 全宽画布区），加 crumbs 提示行与工具栏的间距收敛。
- 测试：`note-viewer.test` / `app-shell.test` 中 `.note-body .empty-state` 两处断言同步新结构；CDP 宽度探针验收「任务=笔记=追问 空态卡右缘同轴」「masthead 宽度不随视图变化」。

### 批4 PDF 版式重做 + 全字段内联 Markdown（问题 5 + 补充 2）——`feat(pdf)`

- 渲染层（治本+兼容旧笔记）：`md-lite.ts` 的 `parseInline` 导出复用，新增 `InlineText` 组件（`**bold**`/`` `code` `` 内联渲染，单字段单行）；PrintHandout 九处纯文本插值改走 MdLite（多行块）或 InlineText（行内）。屏幕端 `NoteBlocks` 同字段同步替换（字面 `**` 一起消失）。
- 生成层（治源）：`summarize.ts` SYSTEM_PROMPT 明确「除 overview/methodology 外所有字段为纯文本，禁止 markdown 标记」；归一层不清洗正文（渲染层已兜底，双保险即可）。
- 版式（D3，推荐 A=重做）：
  - 页边距 12mm→18mm（printToPDF margins 0.7in），`.ph-doc` 内容宽约束 ≈165mm 居中，正文 10.5→11pt、行距 1.75→1.85；
  - 小节标题梯度：h2 15pt→16pt 加墨绿侧条+节前留白翻倍，节内 h3 12pt；节 `break-before: auto` 但标题+首段防拆；
  - 操作步骤 MdLite 有序列表化（多步不再折成一长行）；公式行去 Consolas、改浅底框块；代码块维持等宽 `pre`；
  - 页眉加课程·课时小字（footerTemplate 同通道），页脚页码保留；封面排版微调（标题字号/留白比例）。
- 测试：print-handout 组件测试更新；InlineText/解析单测；真实库导出 PDF 样张人工验收（Andiii）+ SEU_PDF_PATH 自动化出样张留档。

### 批5 笔记反馈润色（问题 6 + 补充 3/4）——`feat(notes)`

- **D4=A（独立通道）**：`src/main/notes/polish.ts` 新文件——读最新 note_json + 截断转写（复用 qa 的 24k 上限）+ 反馈 → 润色 SYSTEM_PROMPT（原笔记 JSON + 用户反馈 → 输出同 NoteSchema JSON）→ `chatJson` → `parseNote` → `dropUnknownEvidence` → `saveNoteVersion`（版本 +1，全链路复用，五视图/导出零改动）。
- IPC `notes:polish`：守卫复制 regenerate 两道（队列 current + tasks 表非终态）+ **handler 侧同课时幂等标记**（补 4 的洞，regenerate 一并受益）；不入 SerialTaskQueue（qa:ask 先例）。
- 模型绑定（D5，推荐 A）：multimodal（与生成同源），**带截断转写**——「补充细节/举例子」需要素材，纯原文润色改不动内容。
- shared：`feedback-tags.ts` 常量（篇幅过短 / 不够细致缺例子 / 重点不突出 / 啰嗦重复 / 术语未解释 / 其他），renderer 与 prompt 共用单一事实源。
- renderer：`FeedbackSection` 挂笔记末尾（五视图可见，导图视图除外）：标签 chips 多选 + 可选补充文本 + 提交（busy 禁用）；App.tsx 照 `regenerateNote` 模式加 `polishBusy` + callback + toast「已生成第 N 版润色笔记」+ `loadNote` 刷新。
- 顺带补漂移：`saveNoteVersion` 后 DELETE 保留最近 10 版（F6 兑现）+ 钉住测试。
- 测试：polish 纯函数与 IPC 守卫单测（FakeIpc 模式）；桥面登记 smoke 清单；真实库润色一轮人工验收。

### 批6 打磨收纳（可裁，D6）——`chore(ui)`

批7 遗留 6 项 + 旧遗留精选，全为小改：MdLite 内联标题 h3→h4；testProvider busy 禁用 + saveProvider 部分失败刷新+toast；ErrorBoundary 加「复制详情/打开日志」；EmptyState 吸收 WelcomeGuide；busy 视觉约定写入样式注释；ManualAdd 回车提交；课时行 title；迁移按钮 busy 防护。

---

## 四、决策点

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| D1 | toast 重复弹出的处理 | A=同文本合并为一条+×N 计数徽标；B=同文本静默丢弃后来者；C=只修点击不去重 | **A**——错误次数本身是信息（预检连触 3 次=3 个入口都有问题），且常驻+合并后视觉只剩一条 |
| D2 | 笔记页轴口径 | A=页头/工具栏/空态/库 860 + 正文保持 680 阅读列；B=全部 860 含正文；C=全部 680 | **A**——正文行宽是可读性实测结论；对齐问题出在页头层不在正文层 |
| D3 | PDF 力度 | A=版式重做（边距/行宽/字号梯度/操作列表化/页眉）；B=只修字面 `**` 最小改 | **A**——「极其丑陋」的主诉是版式不是星号；只修星号治不了铺满整页 |
| D4 | 润色接入方式 | A=独立 notes:polish 通道；B=扩展 regenerate 签名 | **A**——语义清晰（重生成≠定向修订），不把一个 handler 拆两种分叉；版本/守卫/测试全复用 |
| D5 | 润色的模型与素材 | A=multimodal 绑定+带 24k 截断转写；B=multimodal 纯原文润色（更快更省）；C=text 能力绑定 | **A**——「不够细致/缺例子」必须基于课程内容改，光改原文措辞改不出细节 |
| D6 | 批6 范围 | A=批1-5+批6 全做；B=批1-5，批6 只收滚动锁/ManualAdd 回车/课时行 title 三个最小项；C=只做批1-5 | **A**——本轮主诉就是「彻底找出来改掉」；批6 全是小改，摊在一起一次收口 |

## 五、门禁与验收

- 每批 `npm run lint && npm run typecheck && npm test` 全绿，测试数只增不减；批5 后 smoke 桥面登记新通道。
- 批1-3：ui-shots/CDP 探针（toast 命中测试、backdrop 全视口、三页签空态同轴、masthead 恒宽）+ 双主题截图留档。
- 批4：SEU_PDF_PATH 样张 + Andiii 人工过目。
- 批5：单测 + 真实库润色一轮（Andiii 点一次）。
- 收尾：PROGRESS/CHANGELOG 同步；每批独立 Conventional Commit。

## 六、风险与明确不做

- masthead 移出 `.note-body` 动 DOM 结构：PrintHandout 独立组件不受影响；两处测试断言需同步（已知）。
- prompt 收紧不影响旧笔记：渲染层解析兜底，旧数据字面 `**` 同样消失。
- D1 合并去重以「同 kind+同文本」为键：不同错误各占一条，不吞信息。
- 维持「明确不做」：版本切换 UI、笔记在线编辑器、侧栏折叠、导图换库；LessonChip passive/switchable 双形态语义保留。
