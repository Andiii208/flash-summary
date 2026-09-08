# 笔记体验质变：从「生成器」到「复习驾驶舱」（Notes Experience Overhaul）

- 日期：2026-09-08 · 状态：**已否（2026-09-08 Andiii：「太重了，和最初想法背道而驰——只想提升笔记体验，不是做成很重很复杂的桌面软件」。方向改为 Obsidian 结构化导出，见 `docs/plans/2026-09-08-obsidian-export.md`）**
- **本文档保留作调研存档**：§一/§三 的竞品机制、学习科学分级、技术选型核实结论（ts-fsrs/FTS5/jieba/flashcards prompt 纪律）仍然有效，未来若重启复习闭环可直接复用；§四 批次设计作废。
- 触发：用户实测反馈「笔记功能比较平平无奇，觉得整个软件用处不大」。
- 前置：装机整改第二轮六批已落地（720/720，0.7.1）；本方案 = 笔记体验的系统性升级，不修 bug，只造价值。
- 调研基线：本仓库全链盘点（Explore 代理）+ 竞品体验调研（NotebookLM/RemNote/Anki/Obsidian/MarginNote/Readwise/flomo 等）+ 开源生态与学习科学调研（三代理，2026-09-08 实时核实 star/许可/维护状态）。

---

## 一、诊断：为什么「平平无奇」——三个层面的实锤

### 1.1 学习科学层面：产品押注在实证最弱的技术上

Dunlosky et al. 2013《Improving Students' Learning With Effective Learning Techniques》（*Psychological Science in the Public Interest*，被引 3000+）对十种学习技术的分级：

| 技术 | 评级 | 本产品现状 |
|---|---|---|
| 练习测试 practice testing | **高效用** | quiz 字段已生成，但**翻面即终点**——无作答记录、无调度 |
| 分散练习 distributed practice | **高效用** | 完全没有 |
| 精细提问 / 自我解释 | 中效用 | questionsAndGaps 是**死数据**（生成后无任何交互） |
| 总结 summarization | **低效用** | **这就是产品的主业**（五视图全是「读」的形态） |

用户的直觉「用处不大」与文献完全一致：**AI 替用户总结 ≠ 用户学会**。生成效应（generation effect）的红利属于「自己生成」的人——我们的用户跳过了全部认知加工，得到一份低效用形态的成品。**笔记必须从「学习的终点」变成「检索练习的触发材料」，产品的记忆保持价值才能成立。**

### 1.2 竞品机制层面：生成之后的世界我们一件都没做

跨产品共性规律（NotebookLM/Anki/RemNote/Readwise/flomo/MarginNote 一致验证）：让笔记从「一次性生成物」变成「持续学习伙伴」的五类机制——

| 机制 | 竞品代表 | 本产品 |
|---|---|---|
| **到期队列**：打开即知「今天学什么」 | Anki due 队列 / RemNote Exam Scheduler / Readwise Daily Review / flomo 每日回顾 | ❌ 打开软件没有任何「今天该做的事」 |
| **检索而非重读** | MarginNote「You learn by recalling」/ Anki 翻卡 | ⚠️ 仅导图回忆模式 + Quiz 翻面，无闭环 |
| **同一对象多次变身** | MarginNote 高亮→导图节点→闪卡；NotebookLM 来源→播客/闪卡 | ⚠️ 五视图已是多变身，但止于「看」 |
| **可回溯的信任链** | NotebookLM 内联引用 / MarginNote 卡片回跳原文页 | ⚠️ 证据三层机制在，但引用命中 0/8 未收口，用户几乎只见「临近画面」 |
| **可见的复利** | Anki 统计 / flomo 记录 / 得到周报 | ❌ 零统计零进度感 |

**反面对照一句话**：我们完成了 transform（一次），五类机制全部属于生成之后（revisit/retrieve/compound）——恰好是所有竞品重注押下的地方。

### 1.3 现状盘点层面：十二条空白（Explore 代理全链核实）

高相关的十条（另两条工程债见 §7）：①Quiz 无作答记录/错题本/复习调度；②questionsAndGaps 死数据；③概念无跨课时关联（「这门课反复出现的概念」无承接）；④笔记库只有最近 200 条且无搜索无筛选，老笔记不可达；⑤版本全量留存但永远只见最新版——润色 v+1 直接替换，无对比无回退；⑥生成不可配置（深度/风格不可调，只能抽卡式「重新生成」）；⑦概念卡/Quiz 有错不能改（错卡被练熟比没卡更糟）；⑧evidence 引用遵循度 0/8（1.3b 挂账未决策）；⑨conceptLinks label 偏噪声；⑩复习/追问不互达（卡不懂不能一键问）。

---

## 二、战略：核心主张与取舍

### 2.1 一句话主张

**把产品从「笔记生成器」升级为「复习驾驶舱」**：生成的笔记是燃料，产品的日常价值 = 回答「今天学什么」+「学得怎么样」+「考前怎么办」。用户从「生成完就走」变成「每天打开做队列」。

### 2.2 价值链设计（学习科学 → 功能映射）

```
课程视频 → 笔记(触发材料) → Quiz/概念卡(检索练习, 高效用)
                              ↓
                    FSRS 调度(间隔重复, 高效用)
                              ↓
              今日队列 → 作答评分 → 回源(necessity: 答错→回到那分钟的画面)
                              ↓
              统计仪表盘(可见复利) + 考前冲刺(期末周驱动)
```

每一环都有实证背书或竞品验证，全部落在**本地优先、无云端、Windows only** 的边界内。

### 2.3 明确不押的方向（调研后放弃，防功能蔓延）

- **音频播客（Audio Overview 平替）**：podcastfy 等纯 Python 栈 + TTS 只有云端选项，与 Electron 嵌入和本地优先均冲突——列 backlog 不做。
- **flomo 式被动触达**：需要移动端/推送体系，桌面单机没有通道；替代=首页到期卡把入口做薄。
- **社交/社区/共享卡组**：与「本地优先、单用户」红线直接冲突。
- **全量双链图谱**：单人课程笔记体量下复利有限（Obsidian 的价值感建立在数千条笔记上），只做「跨课时高频概念」轻量聚合。
- **全笔记编辑器**：维持不做，但解禁「卡片纠错」（见 D6）——错卡被 FSRS 练熟比没卡更糟。
- **时间戳跳转视频**：维持硬约束不做（视频已删、播放页无时间参数）；回源=时间线卡+关键帧画面（本地方案，已有一半链路）。

> 附注：这套「视频→结构化笔记→FSRS 自适应复习」的闭环叙事，对挑战杯项目材料也是一个更强的故事。

---

## 三、技术选型（2026-09-08 核实）

| 选型 | 结论 | 依据 |
|---|---|---|
| 间隔重复算法 | **ts-fsrs v5.4.2**（MIT，纯 TS 零原生依赖） | 776★、周下载 15 万、FSRS-6 与 Anki 23.10+ 同源；Card 全标量可直映 SQLite 列；Node≥20 满足。SM-2 无任何理由选（srs-benchmark：FSRS 代际碾压） |
| 中文全文搜索 | **better-sqlite3 自带 FTS5 + @node-rs/jieba** | FTS5 在 better-sqlite3 编译选项中默认启用（docs/compilation.md 原文）——零新增搜索依赖；unicode61/trigram 对中文均不可用（连整串/两字词落空），jieba 是唯一现实解；@node-rs/jieba v2.0.2 有 win32-x64-msvc 预编译（napi-rs，N-API 模块 Electron 免 rebuild），nodejieba 需现场编译是装机事故重灾区，排除 |
| 卡片生成 prompt 纪律 | **吸收 anthropics/claude-for-legal 的 flashcards skill**（Apache-2.0） | 一卡一概念/正面必须是问句/无据结论不收卡（`[待核实]` 纪律）——官方级 prompt 成果，改 prompt 即得，零代码成本 |
| 编辑器 | 本方案仅做**字段级纠错**（Dialog 表单），不引入编辑器框架 | Milkdown/CodeMirror 评估留档备用（Milkdown=markdown 单一事实源最契合；BlockNote AI 扩展 copyleft 商业风险排除；Tiptap JSON 模型加转换层排除） |
| 不引入 | minisearch/flexsearch 内存索引 | 数据已在 SQLite，自管持久化属重复建设 |

风险预登记：@node-rs/jieba 虽为 N-API 理论免 rebuild，装包后第一步先在 Electron main 里真实验证分词；失败兜底=renderer 侧 jieba-wasm 分好词再传 main（结构不变，只换分词执行位置）。

---

## 四、批次设计（六批，每批独立提交+四门禁）

### 批1 复习闭环核心——`feat(review-core)` ⭐ 本方案的心脏

**数据层**（migration 010）：

```sql
CREATE TABLE review_cards (
  id INTEGER PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  deck TEXT NOT NULL CHECK(deck IN ('concept','quiz')),
  card_key TEXT NOT NULL UNIQUE,     -- hash(lesson_id + deck + front)
  front TEXT NOT NULL,               -- term 或 question（锚定卡身份，不可编辑）
  back TEXT NOT NULL,                -- definition 或 answer（可纠错）
  term TEXT,                         -- quiz 锚定的 concept term（可空，回源链路用）
  due INTEGER NOT NULL,              -- epoch ms
  stability REAL, difficulty REAL,
  reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,  -- 0 new / 1 learning / 2 review / 3 relearning
  last_review INTEGER, active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE review_log (
  id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES review_cards(id),
  rating INTEGER NOT NULL,           -- 1 Again / 2 Hard / 3 Good / 4 Easy
  reviewed_at INTEGER NOT NULL, elapsed_ms INTEGER
);
CREATE INDEX idx_cards_due ON review_cards(due) WHERE active = 1;
```

- **卡源=双牌堆**（概念卡 term→definition + Quiz question→answer），对齐 Anki 导出已有的两堆先例，概念卡天然是问答题。
- **卡身份=`hash(lesson_id + deck + front)`**——重新生成/润色后，问题没变的卡**保留全部调度历史**，新问题建新卡，消失的卡 `active=0`（孤儿保留，统计史不丢）。
- **对账 `reconcileCards(lessonId, note)`** 纯函数：note 落库（生成/重生成/润色/纠错）后调用；幂等 upsert + 孤儿 deactivate。
- **调度 `src/main/review/scheduler.ts`**：ts-fsrs 默认参数包一层（`answer(card, rating)` → 新卡态 + log 落库）；新卡每日上限默认 20（设置项 `reviews.newPerDay`），队列序 = 到期卡（最旧优先）→ 新卡（按课时序）。

**IPC**（守卫照 notes:polish 先例）：`reviews:dueCount` / `reviews:queue` / `reviews:answer` / `reviews:settings`。

**UI**：
- 新第五页签「复习」（Ctrl+5），**单卡流**（Anki 验证过的形态）：正面 → 空格/点击揭示 → 四档评分按钮（忘了/有点难/记住了/很简单，快捷键 1-4）。
- **回源**：卡上「查看来源」——quiz 有 term 的复用既有「概念卡时间戳定位时间线」链路（term→概念卡→refs→时间线卡+关键帧画面）；「去追问」一键预填 QA 输入框并切页签。概念卡直接跳详细视图锚点。
- 首页「今日复习」卡（N 张到期 → 开始复习）；托盘 tooltip 带到期数。
- 空态分两档：从没生成过笔记→引导生成；有卡无到期→「今天没有到期卡片」+「提前翻看」（浏览模式，不评分不进调度）。
- 状态管理：新建 `useReviewDomain`（照 useToasts/useConfigDomain 先例）——**不喂 App.tsx god hook**（G1 纪律）。

**验收**：reconcile 单测（生成建卡/重生成保留未变卡/孤儿 deactivate/纠错更新 back 不重置调度）；scheduler 包装单测；CardRunner 组件测试（揭示流/四档/快捷键）；IPC 守卫测试 + smoke 桥面登记；ui-shots 复习页截图 + 真实库真实卡队列。

### 批2 统计仪表盘 + 考前冲刺——`feat(review-stats)`

- **统计面板**（复习页签内，全部 review_log 本地计算）：连续复习天数、14 天到期预测柱状、留存率（review 态卡 rating≥3 占比）、课程掌握度（成熟卡占比 = reps≥2 且 state=review 的活跃卡 / 活跃卡）。参考 Anki stats 形态，样式守 note-craft §5 视觉纪律。
- **考前冲刺**：courses 表加 `exam_date` 列（migration 011，课程树课程行可设置）；冲刺视图 = 倒计时 + **弱项优先队列**（stability 升序重排，不改 FSRS 参数——计划叠加层，可逆）+ 配额提示（剩余活跃卡/剩余天数 = 建议每日量）。
- TopBar 复习页签到期徽标（N>0 时）；宽容设计：隔 N 天回来不惩罚不重置（FSRS 天然把拖延折算进下次调度），队列文案「积压 N 张」而非羞辱式红字。

**验收**：stats 纯函数单测（构造 log 序列断言连续天数/预测/留存率）；冲刺排序单测；组件测试；ui-shots 双主题截图。

### 批3 全文搜索 + 笔记库升级——`feat(search)`

- **索引**：`note_search` FTS5 表，**节级行**（lesson_id, kind, idx, tokens）——kind/idx 即跳转锚点；note 落库时删旧插新（只索引最新版）；migration 对存量笔记全量建一遍。索引字段：overview/methodology、timeline(title+detail)、concepts(term+definition)、formulas(content+explanation)、examCues、questionsAndGaps、quiz(question+answer)。
- **查询**：jieba 切查询词 → MATCH；结果按课程/课时分组。
- **UI**：①Ctrl+K 全局搜索浮层（自绘轻层挂 `useModalScrollLock`，↑↓+Enter，Escape 关闭）；②NoteLibrary 顶部搜索框——**全史可达，对冲 notes:list 的 200 条上限**（库列表本身维持「最近 200」快速视图，搜索覆盖全部历史）。
- **跳转**：结果点击 → 打开该课时笔记 → scrollIntoView 到对应 ViewBlock（给块加 id 锚点）+ 短暂高亮。

**验收**：FTS5 可用性探活（批3 第一步）；中文两字词/多词命中单测；版本重建索引幂等单测；Ctrl+K 浮层组件测试；真实库搜「矩阵」跨课程命中 e2e。

### 批4 润色闭环补完 + 死数据激活——`feat(notes-loop)`

- **版本切换（D5 解禁项）**：notes 表加 `version_meta` 列（'generate'|'polish'|'user-edit'|'restore'，历史行 NULL 视为 generate，migration 012）；新通道 `notes:versions` / `notes:version` / `notes:restore`（恢复=复制该版 note_json 落新版本，非破坏性）；工具栏版本下拉（v3 · 今天 14:02 · 润色）→ 历史版只读渲染+顶部横幅「正在查看 v3〔恢复此版本〕〔回到最新〕」。
- **questionsAndGaps 激活**：`gap_resolution` 表（gap_key=hash(lesson+文本), resolved_at）；缺口卡每条加「已解决」勾选（跨版本 hash 对账保留）+「去追问」按钮（预填 QA 输入并切页签）。
- **卡片纠错（D6=A 范围）**：概念卡/Quiz 卡 hover 出「编辑」→ Dialog 表单只改 back（definition/answer），front 锁定（保卡身份与调度史）+「删除此卡」（active=0，可恢复）；走新通道 `notes:editCard`（main 读最新 note→应用 patch→saveNoteVersion(meta='user-edit')→reconcileCards）。

**验收**：版本只读/恢复 IPC 单测；gap 对账单测；编辑卡片落新版本且 reconcile 不重置调度史单测（front 不变 card_key 不变）；组件测试；smoke 桥面登记。

### 批5 课程级学习组织——`feat(course-hub)`

- **课程仪表盘 CourseHubDialog**（对齐 CourseMapDialog 模态先例，入口=课程树课程行按钮）：每课时行（卡数/掌握度/最近复习时间）、考试倒计时与冲刺入口、课程级「复习这门课」按钮（队列过滤 courseId）。
- **高频概念**：全课程 term 归一化（trim）聚合，「出现在 N 个课时」降序，点击跳对应课时概念卡——「这门课反复出现的概念」这一核心学习诉求的最省承接（**不建概念稳定 ID 基建**，term 文本匹配够用，编造/漂移由 hash 不命中自然淘汰）。

**验收**：聚合纯函数单测（同 term 跨课时归并/大小写空白归一）；Dialog 组件测试；真实多课时库截图。

### 批6 生成质量与可配置——`feat(prompt-quality)`

- **Quiz prompt 纪律**（flashcards skill 转化，写入 SYSTEM_PROMPT）：一卡一概念；正面必须是问句；答案须引用时间戳或概念；无转写依据的结论不得收进卡。
- **evidence 引用收口（1.3b 落地）**：few-shot 示例块（一条带正确 refs 的 timeline 样例）+ 明确「仅有关键帧素材时禁止 ppt: 引用」（G0-2 的 0/8 根因）。
- **conceptLinks label 收紧**：要求关系词形态（导致/依赖/区别于/用于…），禁「参数/提升」类名词。
- **重新生成可配置**：regenerate 对话框加两个选择器——导向（预习通读/日常复习/考前速成）× 深度（简明/标准/详尽）→ prompt 前缀注入；默认值=现状（零变化）。
- **note-craft SKILL.md 同步**：§0 加 version_meta 契约、§7 登记新通道与 reconcile 纪律、§9 增补 flashcards skill 来源与「卡片纠错」工艺。

**验收**：prompt 组装单测（前缀注入/纪律条款存在性）；真实课重新生成一轮人工过目（quiz 形态/evidence 引用命中数对比 1.3 基线）。

---

## 五、决策点

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| D1 | 复习入口形态 | A=第五页签+首页到期卡+托盘数；B=首页即队列（无独立页签） | **A**——复习有统计/冲刺等纵深，值得一个页签；首页卡保证「打开即见」 |
| D2 | 卡源范围 | A=双牌堆（概念卡+Quiz）；B=仅 Quiz | **A**——概念卡天然是问答题，Anki 导出双堆先例；概念卡是「这门课的语言」，不背可惜 |
| D3 | 卡身份策略 | A=hash(lesson_id+deck+front) 跨版本存续；B=note 版本+序号（重生成即失忆） | **A**——版本会因润色/纠错频繁更替，B 会让用户练熟的卡一夜清零，体验灾难 |
| D4 | 评分档位 | A=四档（忘了/有点难/记住了/很简单，FSRS 原生）；B=三档简化 | **A**——四档是 Anki 用户肌肉记忆，ts-fsrs 原生支持，快捷键 1-4 顺理成章 |
| D5 | 版本切换 UI | A=解禁：下拉+只读查看+恢复此版本；B=维持 2026-09-04「明确不做」 | **A**——当时不做的前提是「版本间无有意义差异」；润色功能落地后前提已变（v1 生成/v2 润色/v3 纠错），没有回退=润色闭环缺一条腿 |
| D6 | 编辑范围 | A=仅卡片 back 纠错+删卡（Dialog 表单）；B=维持完全不做；C=全笔记编辑器 | **A**——错卡被 FSRS 练熟比没卡更糟（flashcards skill 原话）；C 的 markdown 编辑器与「regenerate 纯净重生成」冲突且重，不做 |
| D7 | 搜索方案 | A=FTS5+@node-rs/jieba；B=minisearch 内存索引 | **A**——FTS5 已在依赖里默认启用，B 自管持久化属重复建设；A 的唯一风险（Electron ABI）有兜底路径 |
| D8 | 批次顺序 | A=按批1→6（复习闭环最先）；B=搜索提前（先解决可达性） | **A**——本方案的目标是「大幅提升体验」，复习闭环是唯一的分水岭级改动，先立心脏再修血管 |

## 六、门禁与验收（每批）

- `npm run lint && npm run typecheck && npm test` 四门禁全绿，测试数只增不减；新 IPC 通道全部 FakeIpc 单测 + `scripts/smoke-cdp.mjs` 桥面登记。
- 每批 ui-shots 真实库截图（双主题）；批1/批2 加真实卡队列/统计的真实数据验收。
- 批3 第一步先跑 FTS5 + @node-rs/jieba 在 Electron main 的探活脚本，不通则按 §三 兜底换 renderer 分词（结构不变）。
- 批6 真实课重新生成一轮，evidence 引用命中率对比 1.3 基线（0/8）留档。
- 收尾：PROGRESS/CHANGELOG/SKILL.md 同步；每批独立 Conventional Commit。

## 七、风险与工程债

- **新卡洪水**：首次启用时全部历史笔记的概念+Quiz 一起变新卡——靠 `newPerDay` 上限（默认 20）闸门 + 队列「到期优先」自然消化；不做按课程 opt-in（复杂度不值）。
- **版本漂移对账**：reconcileCards/gap_resolution 均幂等 hash 对账，孤儿软删不物理删——统计史完整；错误 front 改动=新卡属正确语义。
- **App.tsx god hook**：复习走独立 useReviewDomain，零增 App.tsx 负债；G1 的 note 域拆分仍是独立欠债，不塞进本方案。
- **@node-rs/jieba ABI**：N-API 理论免 rebuild，但 better-sqlite3 的 Electron ABI 教训在前——批3 首步探活，兜底 renderer 分词。
- **B 站源笔记**：quiz/概念同样存在，复习闭环天然覆盖双源；无字幕 ASR 兜底课的卡照常调度（时间戳粒度 120s 只影响回源精度不影响调度）。

## 八、与既有「明确不做」清单的关系

- **维持不做**：笔记在线编辑器（全量）、时间戳跳转视频、导图换库、云端同步、音频播客、社交化。
- **本方案建议解禁**：版本切换 UI（D5，前提已变）；「卡片纠错」不在原清单但属编辑器的最小子集，以 D6 限定边界。
- 其余原清单项不动。
