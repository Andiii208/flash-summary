---
name: note-craft
description: SEU Summary 笔记系统的工艺规范——数据契约、证据对齐、五视图投影、视觉纪律、PDF 排版与测试要求。凡改动笔记生成/展示/导出链路的会话必须先读本文件。
version: 1.1.0
---

# SEU Summary 笔记工艺（Note Craft）

> 2026-09-04 由 Note Revolution 计划沉淀。方法论转化自官方 document-skills（pdf 的矢量铁律/分页质量门/色彩纪律、pptx 的反 AI 味清单），实现事实以本仓库代码为准。

## 0. 数据契约（单一事实源）

一个结构化 JSON 驱动全部视图——**绝不生成多份独立总结**。

```
Note {
  overview, methodology          ← LLM 按 markdown 组织（## 小节 + - 列表）
  knowledgeTree: TreeNode        ← 思维导图的唯一数据源；节点可带 terms（锚定 concepts term，归一层丢弃编造项）
  timeline: [{at, title, detail, refs[], evidence[]}]
  concepts: [{term, definition, refs[]}]
  formulasAndSteps: [{kind: formula|code|operation, content, explanation, refs[]}]
  examCues[], questionsAndGaps[]
  quiz[], conceptLinks[]         ← 关联线 from/to 必须解析到 term 或节点标题，否则整条丢弃
  transcriptRefs[], evidence[]
}
```

- 定义：`src/shared/notes/schema.ts`（zod + 归一层：coerceAt 时间戳、normalizeEvidence kind 修复、**ref 格式过滤**、JSON 修复）。
- 投影：`src/shared/notes/views.ts`（`projectNote` 纯文本层 + `projectNoteBlocks` 块层）。
- **改 schema 必须同时考虑**：归一层、两个投影、markdown 导出、PrintHandout、四组测试。

## 1. 证据对齐（三层机制，不许绕过）

模型输出的 evidence.ref 必须能解析到真实附件。三层、逐级降级：

1. **发送端标注**：`buildUserParts` 在每张图前发 `[图片 N/M] 类型 | 证据ID：ppt:<页>或kf:<id> | 时间：N秒`，收尾指令要求原样引用。改 prompt 时不得删除标注或「禁止编造」指令。
2. **归一端过滤**：`EVIDENCE_REF_PATTERN = /^(ppt:\d+|kf:[\w.-]+)$/`，编造的散文 ref 直接丢弃（不报错、不渲染死链）。
3. **渲染端兜底**：`bindTimelineImages`（`src/shared/notes/evidence.ts`）——ref 精确匹配 → timeline.at 就近关键帧（容差 `NEAREST_SECONDS = 90`）→ 无图纯文字卡。旧笔记无需重跑即可获得配图。

附件类型事实：平台 PPT API 真实课程空返回，**实际素材 = 屏幕流关键帧**（10s 抽帧 + phash 去重，文件名内嵌秒）。

## 2. 五视图投影规则

`VIEW_IDS = detailed | standard | key_points | methodology | mindmap`。

| 视图 | 内容策略 |
|---|---|
| 详细笔记 | 概览(md) → 树 → 时间线卡片流(图+引文) → 概念卡 → 公式分块 → 考点/缺口 → 课堂画面图集 |
| 标准总结 | 概览 + 树 + 前 8 概念 + 考点速览 |
| 要点 | 考点卡 + 缺口卡 + 前 5 时间线 |
| 方法论 | methodology(md) + operation/code 步骤（排除 formula） |
| 思维导图 | 整幅交互 SVG |

- 空 section **必须省略**（不渲染空标题）。
- 投影是纯函数，放 `src/shared/notes/`，测试在 `tests/notes-views.test.ts`。

## 3. Markdown 渲染（md-lite）

- 解析器：`src/shared/notes/md-lite.ts`——受支持集：`##` 标题、`-`/`*`/`1.` 列表、`>` 引用、`**粗体**`、`` `行内码` ``、空行分段。
- **铁律：只产 token 数组，绝不产 HTML 字符串**。渲染层（`MdLite.tsx`）输出 Preact JSX，XSS 面为零。需要新语法时先扩 parser 测试。
- 判断字段是否 markdown：`looksLikeMarkdown`；纯散文投影为 paragraph 块。

## 4. 思维导图

- 布局：`src/shared/notes/mindmap-layout.ts` 纯函数（左根、叶子按行、父居中、贝塞尔连线、CJK 宽度估算、折叠路径集、可选 terms 副行 `showTerms`、可选跨节点关联线 `links`——折叠端点不渲染）。**屏幕交互版（MindMap.tsx）与 PDF 静态版（PrintHandout）与 SVG 导出（mindmap-svg.ts）共用同一布局函数**——几何只有一个事实源；缩放/平移是 viewBox 变换，不碰几何。
- 交互（Map Expansion 2026-09-05）：视图内子工具栏（层级控制=collapsedSetForMaxDepth 纯函数 + 标题搜索：命中高亮/展开祖先/滚动定位，与回忆模式互斥）、Ctrl+滚轮指针锚点缩放 0.4-3x、空白拖拽平移、节点点击折叠（caret+后代计数胶囊）、ℹ️ 浮层（关联概念+锚定 quiz 翻面+跳详细笔记）、双击下钻焦点模式（面包屑返回，折叠集全路径空间 fullToRel/relToFull 映射）、回忆模式（depth≥2 同色遮罩逐个揭示——提取练习）、导出 SVG。
- 课程级：`notes:courseTree` 聚合各课最新版树（`mergeCourseTree` 纯函数，第N节课序复用 course-order），模态 CourseMapDialog；**不跨课时概念链接、不进 PDF**。

## 5. 视觉纪律（转化自 pptx/pdf skill，违反=返工）

- **三角色色彩**：BACKGROUND（表面）→ PRIMARY（靛蓝 accent）→ 琥珀/红仅作考点/缺口语义色。全文档 ≤5 色、同色系分层（透明度/深浅），禁彩虹。
- **低饱和填充**：节点/卡片底色必须浅（--*-soft 令牌）；高饱和只允许出现在小标签/描边。
- **禁止**：彩色边条/accent stripe、标题装饰下划线、emoji 图标、每页超过 3 个装饰元素、3 字体以上。
- 层级靠**字号/字重/留白**，不靠加框加线。

## 6. PDF 讲义（printToPDF）

- **架构铁律**：主窗口 `webContents.printToPDF`——不开第二个 BrowserWindow（本机存在第二渲染器永不 commit 的环境故障，PROGRESS 有案），零新依赖。
- **DOM 铁律**：`#print-root` 必须是 `.app-shell` 的**兄弟节点**——print.css 在打印媒体下 `display:none` 整个 shell，嵌套在里面会被连带隐藏（真实踩坑：空白 23KB PDF）。
- **时序铁律**：导出流程 = dialog → 渲染 handout → `waitForImages`（每张 img decode 完成）→ exportPdfWrite → 清空 root。图片未 decode 完就打印 = 空白图。
- 排版规则（转化自 pdf skill）：A4；卡片/标题+首段 `break-inside: avoid`；H2 `break-after: avoid`；导图整页 `break-before: page`；封面 `break-after: page`；正文 ≥10.5pt；打印强制纸白（暗色主题下也白）；`printBackground: true` + 页码页脚；**矢量输出验证**：文本 ops > 0、字体子集嵌入、图片 DCT 数 = 附件数。
- 测试缝：`SEU_PDF_PATH` 环境变量绕过原生保存对话框（e2e 专用，勿在产品路径删除）。

## 7. 测试要求（纪律红线）

- 每批提交四门禁全绿：`npm run lint && npm run typecheck && npm test` + `npm run smoke`。
- 测试数**只增不减**；不许 skip/删断言/mock 被测关键路径。
- 新增视图/块类型必须带：投影测试（notes-views）、渲染测试（note-viewer / print-handout）、纯函数直测（md-lite / mindmap-layout / evidence）。
- IPC 新通道：FakeIpc + `vi.mock('electron')` 模式（样板 `tests/notes-ipc.test.ts` / `tests/notes-pdf-ipc.test.ts`），并在 `scripts/smoke-cdp.mjs` 的桥面清单登记。
- 真实数据验证：改渲染/导出后必须跑 `node scripts/ui-shots.mjs`（真实库副本隔离）+ DOM 计数探针；PDF 导出跑完整按钮流 e2e 并检查产物结构（页数/图数/矢量文本）。

## 8. 已知边界（改动前先想）

- ASR 时间戳粒度 = 120s 分片起点（精对齐受限，证据对齐靠三层机制补偿）。
- 本地视频已删、平台播放页无时间参数——时间戳跳转视频**明确不做**。
- 笔记无在线编辑器；版本历史全量留存但 UI 无版本切换。
- QA 追问暂不发图（只有证据 ID 字符串）——升级为多模态时参照本文件 §1。
- **B站源（2026-09-06 接入）**：transcripts.provider = `bilibili-subtitle`（B站字幕直插，秒级 `at`）或 `openai-compatible`（无字幕时 ASR 兜底）；提示词经 `sourceHeader` 注入「B站视频」语境行（措辞用视频/讲者），SEU 行为零变化；证据只有 `kf:`（360P 视频流抽帧，流被风控拒绝时 evidence 可为空，属合法态）；PPT 通道不存在。方案 docs/plans/2026-09-06-bilibili-source-integration.md。

## 9. 方法论参照（GitHub 调研 2026-09-04）

调研范围：`anthropics/skills` 官方仓库、`ComposioHQ/awesome-claude-skills`（74k★ 索引）、定向搜索 note/zettelkasten/cornell。**结论：社区没有可直接照搬的「LLM 笔记生成工艺」skill**——官方仓库的笔记产出类即本文件 §5/§6 已融合的 pdf/pptx；社区力量集中在集成编排与方法论生态。有价值的映射与启发如下：

### Cornell 5R ↔ 五视图映射（视图设计的理论锚点）

先例：`KenWuqianghao/Obsidian-Cornell-Notes-Generator`（LLM 从 lecture transcript 生成 Cornell 时间线笔记，与本产品场景同构）；生态参照 `latazadehomero/cornell-marginalia`（118★）、`TfTHacker/cornell-notes-learning-vault`（65★）。

| Cornell 结构 | 本产品对应 | 设计含义 |
|---|---|---|
| Notes 栏（课堂详录） | 详细笔记视图（时间线卡片） | 详录以时间为主轴，正是时间线卡片的形态依据 |
| Cue 栏（关键词/自测问题） | 要点视图（考点/缺口卡） | Cue 的本质是「自测钩子」——要点卡文案应保持可自测的问句/关键词形态，而非陈述句 |
| Summary（页底总结） | 标准总结视图 | 总结必须是**合上详录后能独立读懂**的封闭叙述 |
| Reflect / Review | 方法论 + 疑问与缺口 | 反思层永远不与详录混排—— methodology 单独成视图的依据 |

未来改 prompt 或视图时先对照此表；破坏映射（如把考点写成陈述句）即违背 Cornell 语义。

### Zettelkasten 原子化（概念卡的原则）

参照 `01110100chony/optimized-study`（Obsidian Zettelkasten + Claude 苏格拉底式，STEM 深度学习）。原则：概念卡**一卡一概念、自足可读**。当前 `concepts[]` 已是原子卡；若未来引入跨课时概念链接（当前明确不做——追问严格限课时），需先给概念稳定 ID，参照本文件 §8。

### 未来候选：练习题生成（Quiz）

`joeseesun/qiaomu-anything-to-notebooklm`（5.9k★）的输出形态清单含 Quiz——比「考点提示」更进一步的自测材料。候选方案：在要点视图增加「自测题」块（LLM 从 concepts+examCues 生成 Q/A 分离的练习题，先答后翻）。未排期；实现时须走 §7 测试纪律与本文件的数据契约扩展流程。

### 已评估不采纳

- `tapestry/learn-this`（URL→提取→行动计划）：编排类，与「学习后转行动」思想同向，但本产品的方法论视图已承载该职责，无需引入编排层。
- qiaomu 的多源抓取/NotebookLM 上传管线：与本产品「本地优先、自有管线」定位冲突。

## 10. 内容质量规约与体检（2026-09-08 质量攻坚批1-4，plan docs/plans/2026-09-08-note-quality-overhaul.md）

真实库探针实证（2026-09-08）：旧 prompt 只管形状，SEU 课概念定义均 35-45 字、考点全空、evidence ref 全为非法散文——「形状对而内容平庸」是「笔记平平无奇」的直接来源。

### 质量规约（prompt 行为契约）

- `SYSTEM_PROMPT = NOTE_SHAPE_PROMPT + NOTE_QUALITY_PROMPT`（`src/main/notes/summarize.ts`）：形状 8 条（2026-09-04 起）+ 质量规约 9.1-9.8。动条款必须动 `tests/note-prompt-quality.test.ts` 的钉住断言。
- 核心条款：概念定义 ≥60 字且「是什么+为什么/用在哪/与什么区分」三选二、禁循环定义；时间线 detail 禁复读 title、必须含具体数字/结论、refs 为忠实摘引；overview ≥150 字 ## 小节；考点具体到「考什么怎么答」且**宁空勿编**；转写同音错词结合关键帧纠正为正名（月华→鸢尾花 已实证）；evidence few-shot + 仅关键帧素材时禁 ppt: 引用（G0-2 的 0/8 根因收口）；conceptLinks label 关系词白名单。
- POLISH 同步质量下限（第 6 条），保守修订纪律不变。

### 转写清洗（load 时派生）

- `src/shared/notes/transcript-clean.ts` 纯函数：标点/串尾语气词压缩（左边界刻意不设界——中文无以呃/嗯/啊为词内语素的词）、近空段（<5 字）剔除、相邻段精确+bigram Dice ≥0.85 去重（短段仅精确等防 B站字幕误杀）。
- summarize/polish/qa 三消费点统一走清洗后文本；**原始 segments 落库不动**（refs 摘引需要原文）。

### 体检与存量升级

- `noteHealth(note, hitRate?)`（`src/shared/notes/health.ts`）→ `{ warnCount, grade: good|fair|weak, findings: [{field, level: warn|info}] }`：warn=重新生成可改进；info=诚实空节说明（宁空勿编，不拉低评级）。NoteViewer 工具体检徽标+findings 面板。
- `notes:courseHealth(courseId)` IPC + 笔记库课程组「升级旧笔记」对话框（默认勾选 warn>0，逐课串行复用 notes:regenerate，零下载）。
- 真实库基线（2026-09-08，升级前）：1690406-L0 v1=fair(warn2)/1690625-L0 v3=fair(warn2)/bili-P3 v2=fair(warn1)——升级后对比留待现场验收（需退 Clash TUN，大请求经代理会挂起）。

## 11. Obsidian 结构化导出（2026-09-08，plan docs/plans/2026-09-08-obsidian-export.md）

- **投影单一事实源**：`src/shared/notes/obsidian.ts`（projectObsidianNote / projectConceptIndex / projectVaultIndex）——只产 markdown 字符串；附件只列名不读字节，main 侧 `src/main/notes/obsidian-export.ts` 负责落盘与复制。
- **文件布局**：`<vault>/Flash Summary/<课程名>/<课时名>.md` + `attachments/<lesson_id>-<原文件名>`；`_概念.md`（课程概念聚合，同名 term 归一归并，导出自动重建勿手改）；`_index.md`（全库结构约定，从 manifest 重建）。
- **SR 卡纪律**：概念卡 `[[term]]::definition` 单行；quiz 多行「问 / ? / 答」；牌组 = 行内 `#flashcards/<课程tag>/<课时tag>`（**frontmatter tags 插件不识别，必须行内**）；tagSafe 清洗空格与非法字符。
- **幂等**：migration 010 `obsidian_exports`（lesson_id 主键）——同课时覆写、改名清旧文件、vault 切换不误删；`_index.md` 明示「直接改写会在下次导出被覆盖」。
- **红线**：导出物零直链零密钥，B站只放公开 bvid；附件只带走笔记实际引用的（D4=A）。
- **测试缝**：`SEU_OBSIDIAN_PATH` 绕过 vault 目录选择（一次性覆盖，不落 settings）。
