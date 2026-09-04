# SEU Summary UX 深审二期整改方案（待审批）

> 2026-09-04。来源：六问题批 A-E 落地后的第二轮全量深审（渲染层 13 组件 + IPC 面 + 首用/日常主线/异常路径三旅程），发现 23 项。Andiii 已圈范围：**A 档 7 条全修 + B 档 6 条全修 + C 档顺手带掉**。
> 状态：**计划，未获批准不动代码**。基线：master bfd4718（四门禁 424/424 + smoke 22/22）。

---

## 一、问题清单（编号沿用深审报告）

### A 档：主流程反人类

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| A1 | Provider 没配齐时任务跑到 summarizing 才失败，30 分钟白等 | `createAndRun`（app.tsx:789）无前置校验 | 创建前校验 `providers.bindings` 覆盖 asr+multimodal（text 可选），缺哪样提示哪样并引导去设置 |
| A2 | 任务成功后无「查看笔记」去向，toast 3.5s 消失即断线 | onProgress succeeded 只 toast（app.tsx:584） | toast 带「查看笔记」动作；「全部任务」已完成行加「笔记」按钮（selectLesson + 切笔记页） |
| A3 | 任务页显示原始课时 ID「已选课时：1690625-L4」 | TaskPanel.tsx:81 | 传 `lessonContext`，显示「课程名 · 课时标题」 |
| A4 | 课时乱序（第5,4,3,8,7,6节；节数≥10 字典序更乱） | courseTree SQL `ORDER BY started_at, l.id`（ipc.ts:352）+ 平台目录最新在前 | shared 纯函数 `orderLessonsByNumber`（解析「第N节」升序，无数字排尾部）在 renderer 应用 |
| A5 | 中文输入法按回车选字 = 意外提交半截问题 | QaPanel.tsx:52 `onKeyDown Enter` 直接 submit | `e.nativeEvent.isComposing === true` 时 return |
| A6 | 追问答案不渲染 Markdown，原始符号上屏 | QaPanel `<p>{e.answer}</p>` | 换 `MdLite`；`.qa-a` 的 `white-space: pre-wrap` 移到 MdLite 内部块，避免双重换行 |
| A7 | 选中课时但无笔记时误显全局笔记库（批B回归） | NoteViewer 空态只看 `note == null` | 区分：`lesson != null && note == null` → 顶部「『第N节课』尚无笔记 — 去创建任务」按钮 + 下方保留笔记库（带小标题「或查看其他笔记」） |

### B 档：显著摩擦

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| B1 | 任务不能排队，串行等待期无法规划下一节 | app.tsx:790 `if (running) return`；而后端 `SerialTaskQueue.enqueue` 本就是 FIFO（serial-queue.ts:14） | 放开 UI；排队上限 3；**同一课时不允许重复排队**（防重复下载）；进度卡之外，「全部任务」pending 行显示「排队中」 |
| B2 | 抓目录/登录让整个窗口变成学校页面 30-60s，提示一闪而过 | harvestLessons（app.tsx:722）/login（app.tsx:616）只有 toast | 跳转前 Dialog 说明预期（「窗口将跳转学校页面，完成后自动返回，约需 30-60 秒」）；带「不再提示」勾选存 localStorage；收割与登录共用 |
| B3 | 同一 API Key 要重复录 3 遍（asr/multimodal/text 各存一次） | ProviderPanel capability 单选（ProviderPanel.tsx:76） | 能力改多选 checkbox（至少一项）；save 一次 + 循环 bind N 次；toast 汇总「已绑定 2 项能力」 |
| B4 | 笔记页无课时间导航，换一节要回侧栏重找 | NoteViewer 工具栏 | 同课程内按节数「上一节/下一节」按钮（orderLessonsByNumber 后取邻），首末禁用 |
| B5 | 运行中任务在「全部任务」列表无法取消 | HistoryList 行只有重试/删除 | 非 terminal 且 id === 运行/排队任务的行显示「取消」（tasks:cancel(taskId)，后端对未运行任务已支持标记取消） |
| B6 | 已有笔记的课时再点「创建并运行」无提示，误触重跑 45 分钟 | createAndRun 无检查 | 该课时已有笔记时按钮下方提示「已有笔记 vN：只更新内容请用笔记页『重新生成』；重新运行将重新下载处理」（不阻断，仅提示） |

### C 档：小瑕疵（全收）

| # | 问题 | 修法 |
|---|---|---|
| C1 | 进度卡不标所属课时 | TaskStatusCard 加课时名一行（progress.taskId → 从 globalHistory 查课时名） |
| C2 | 追问输入不支持换行 | input → textarea（Enter 提交 / Shift+Enter 换行，同样守 isComposing） |
| C3 | 证据图集图片不能点击放大（时间线缩略图可以） | gallery figure 包 zoom Dialog，复用 TimelineCards 的 zoom 状态模式 |
| C4 | 退出登录无确认（误点清空全部上下文） | TopBar 与 SettingsPanel 两处入口均加 Dialog 确认 |
| C5 | 设置页路径截断后无悬浮全文 | `.settings-path` 加 title |
| C6 | 手动添加错的课程无法删除 | 新 IPC `school:removeCourse`：**仅当该课程无任何笔记与任务**时允许（全部表 ON DELETE CASCADE 到 courses——有数据的课程删除会连带删笔记，必须拒绝）；CourseRow 仅在 `lessons.length===0 && noteCount===0` 时显示删除按钮，端点再校验一次 |
| C7 | 界面无版本号 | `AppSettingsInfo` 加 `version`（main 侧 `app.getVersion()`），设置页 footer 显示 |
| C8 | 首次登录后引导断链（WelcomeGuide 第 3 步无承接） | justLoggedIn 的「登录成功」toast 带动作「去选课」→ 展开全部课程组 |
| C9 | 选课→切任务页→点创建三步流程 | **决策点 3**：推荐「选中课时后智能切页签」——点已处理课时 → 笔记页；点未处理 → 任务页（selectLesson 内根据 hasNote setTab）；备选：保持现状 |
| C10 | 缓存目录要手敲路径 | 新 IPC `settings:chooseCacheDir`（复用 chooseLibrary 的 openDirectory 模式），「浏览」按钮 + 输入框并存 |

---

## 二、批次划分（5 批，每批独立提交 + 四门禁 + smoke）

### 批 1：任务链路纠错（A1、A2、A3、B6、C1）
- app.tsx：`createAndRun` 前置校验（A1）；succeeded toast 加「查看笔记」动作（A2）；`openTaskLesson(lessonId)` 复合回调（selectLesson + setTab('tasks')/setTab('notes')）传 TaskPanel；`lessonContext` 传 TaskPanel（A3）。
- TaskPanel：`已选课时` 可读名（A3）；已有笔记提示（B6，需要 noteCount 信息——从 lessonContext 扩展或 globalHistory 推断，实现取简）；进度卡课时行（C1，从 globalHistory 按 taskId 查）。
- 全部任务行「笔记」按钮（A2，succeeded 行）。
- 测试：createAndRun 校验分支、提示文案、按钮接线（task-panel / app-shell 组件测试 +）。

### 批 2：输入与阅读体验（A4、A5、A6、A7、B4、C2、C3、C5）
- shared/course-order.ts：`orderLessonsByNumber(tree)`（正则 `第\s*(\d+)\s*节` 提取，升序，无号排尾、稳定）；app.tsx `orderedTree` 后应用（A4）。
- QaPanel：isComposing 守卫（A5）；答案 MdLite（A6）；textarea + Shift+Enter（C2）。
- NoteViewer：空态区分 + 「去创建任务」按钮（A7，需 onGoTasks 回调）；「上一节/下一节」导航（B4，需要 lessonId 邻居——app.tsx 从排序后 tree 计算 prev/next 传入）。
- NoteBlocks：图集点击放大（C3）；`.settings-path` title（C5）。
- 测试：orderLessonsByNumber 纯函数、QaPanel IME/渲染、NoteViewer 空态/导航。

### 批 3：排队与跳转预期（B1、B2、B5）
- app.tsx：`createAndRun` 放开 running、排队计数上限 3、同课时去重（查 globalHistory pending/running 同 lesson_id）；`cancelTaskById(taskId)` 新回调。
- TaskPanel：pending 行「排队中」徽标、运行/排队行「取消」按钮（B5）；进度卡不变（仍只显示 current）。
- 跳转确认 Dialog（B2）：`confirmPlatformJump(kind: 'harvest' | 'login', then)` helper（localStorage `seu-summary.jump-confirm.skip` 记「不再提示」）；harvestLessons 与 login 两处接入。
- 测试：排队计数/去重、取消按钮、Dialog 跳过逻辑。

### 批 4：Provider / 设置 / 引导（B3、C4、C6、C7、C8、C10）
- ProviderPanel：能力多选 checkbox（B3）；app.tsx saveProvider 循环 bind。
- `school:removeCourse` IPC + CourseRow 条件删除按钮（C6，双端校验无笔记/任务）。
- `settings:chooseCacheDir` IPC + 浏览按钮（C10）；`AppSettingsInfo.version` + footer 版本号（C7）。
- 退出确认 Dialog ×2 处（C4）；justLoggedIn toast「去选课」动作（C8）。
- 桥/类型/preload/smoke 登记同步；测试：removeCourse 拒绝有数据课程、chooseCacheDir 缝、多能力绑定循环。

### 批 5：流程压缩与收尾（C9 + 文档）
- C9 按决策点 3 结论实施（推荐：selectLesson 按 hasNote 智能切页签）。
- CHANGELOG / PROGRESS / README 对齐；neat-freak 一致性检查。

## 三、验收

- 每批：`npm run lint && npm run typecheck && npm test`（测试数只增不减）+ 涉桥批次跑 `npm run build && npm run smoke`。
- 批 2/3/5 加 ui-shots 真实库截图自检（课时排序、笔记导航、排队状态）。
- 终验：冷启动不选课时看笔记库 → 点一条已处理笔记直达笔记页（C9）→ 笔记页「下一节」翻到未处理课时 → 任务页显示可读课时名 → 未配 Provider 时创建被前置拦截（A1）→ 配齐后排队第二个任务（B1）→ 完成toast「查看笔记」直达。

## 四、明确不做（本轮边界）

- 不做任务并行执行（仍是串行队列，只放开排队）。
- 不做笔记在线编辑/版本切换 UI（既有遗留）。
- 不做有数据的课程删除（级联删笔记，红线）。
- 不动登录/收割的主窗口导航机制（环境级约束，仅加预期管理）。

## 五、待 Andiii 拍板的决策点

1. **B2 跳转确认**：带「不再提示」勾选（推荐），还是每次都确认？
2. **B1 排队上限**：3 个（推荐，防重复下载堆积），还是不设上限？
3. **C9 选课流程**：智能切页签（推荐：点已处理→笔记页、未处理→任务页），还是保持现状只加笔记库入口？
