---
name: note-craft
description: SEU Summary 笔记系统的工艺规范——数据契约、证据对齐、五视图投影、视觉纪律、PDF 排版与测试要求。凡改动笔记生成/展示/导出链路的会话必须先读本文件。
version: 2.0.0
---

# SEU Summary 笔记工艺（Note Craft）

> 2026-09-04 由 Note Revolution 计划沉淀。方法论转化自官方 document-skills（pdf 的矢量铁律/分页质量门/色彩纪律、pptx 的反 AI 味清单），实现事实以本仓库代码为准。
>
> **2026-09-17 v2.0.0**：按 plan `docs/plans/2026-09-17-note-quality-upgrade.md` 重写为
> 「五阶段 + 每阶段门禁」，补写 PPT×关键帧融合，修订方法论参照（现 §15）并新增外部方法论
> 吸收登记。定位经 Andiii 裁定收窄为**「把总结做好」**——**不做学习/教学功能**（见 §13）。

## 0. 工艺五阶段（先看这张图，再看细节）

```
素材      转写（带 [mm:ss] 时间锚）+ 视觉（PPT×关键帧融合）
  ↓ 门禁：素材两路都能降级（PPT 常为空、关键帧可被风控拒绝）
生成      SYSTEM_PROMPT = 形状规约 8 条 + 内容质量规约 9.x
  ↓ 门禁：JSON 解析成功
核验      dropUnknownEvidence（全量证据集）+ verifyNoteRefs（摘引/时间可核验）
  ↓ 门禁：warnCount 可计算
返修      noteHealth(warnCount>0) → **一次**有界返修，不发图
  ↓ 门禁：返修稿的 warnCount 必须**下降**，否则保留原稿
投影      五视图 / markdown / PDF / Obsidian / Anki / 导图 SVG
```

**两条贯穿始终的纪律**：
1. **门禁只用于内部提质，绝不用于拦截交付**。返修失败、核验失败都**照常出笔记**
   （降级为现状 + 体检徽标提示）。生成失败弹窗比一份及格的笔记更糟。
2. **降级而非报错**。任何一路素材/核验不可用，都退到下一档而不是让整份笔记失败。

## 1. 数据契约（单一事实源）

一个结构化 JSON 驱动全部视图——**绝不生成多份独立总结**。

```
Note {
  overview, methodology          ← LLM 按 markdown 组织（## 小节 + - 列表）
  knowledgeTree: TreeNode        ← 思维导图的唯一数据源；节点可带 terms（锚定 concepts term，归一层丢弃编造项）
  timeline: [{at, title, detail, refs[], evidence[]}]
  concepts: [{term, definition, example?, refs[]}]   ← 批2 起 example 可选（宁空勿编）
  formulasAndSteps: [{kind: formula|code|operation, content, explanation, refs[]}]
  examCues[], questionsAndGaps[]
  quiz[], conceptLinks[]         ← 关联线 from/to 必须解析到 term 或节点标题，否则整条丢弃
  transcriptRefs[], evidence[]
}
```

- 定义：`src/shared/notes/schema.ts`（zod + 归一层：coerceAt 时间戳、normalizeEvidence kind 修复、**ref 格式过滤**、JSON 修复）。
- 投影：`src/shared/notes/views.ts`（`projectNote` 纯文本层 + `projectNoteBlocks` 块层）。
- **改 schema 必须同时考虑**：归一层、两个投影、markdown 导出、PrintHandout、obsidian、anki、四组测试。
- **新字段一律可选带默认值**：旧笔记必须零迁移加载（`terms` / `conceptLinks` / `example` 都是这个手法）。
- **长转写走全域抽稀**：`sampleTranscriptLines`（polish / qa 共用）在超预算时按行抽稀，**覆盖整节课的首中尾**——此前是 `slice(0, 24000)`，45 分钟以上的课后半段对模型完全不存在。
- **prompt 条款**：形状 8 条 + 质量 9.1–9.11。其中 **9.11「去 AI 味」**（批6）三条：**去路标**（禁「值得注意的是/综上所述/本节主要介绍」——它们在语音转写里根本不存在，出现即模型加的）、**具体优先**（定义与 detail 必须落到本讲的具体数字/参数/演示结果）、**不均匀化**（讲得多的地方写得多，禁止为了整齐而填充）。动条款必须动 `tests/note-prompt-quality.test.ts`。
- **工艺版本**：`CURRENT_PROMPT_VERSION` / `CURRENT_SCHEMA_VERSION`（`shared/notes/schema.ts`）。
  **改 prompt 或 schema 时必须同时 +1**——存量升级入口靠它识别「旧工艺产出但侥幸没 warn」
  的笔记（见 §8）。

## 2. 证据对齐（三层机制，不许绕过）

模型输出的 evidence.ref 必须能解析到真实附件。三层、逐级降级：

1. **发送端标注**：`buildUserParts` 在每张图前发 `[图片 N/M] 类型 | 证据ID：ppt:<页>或kf:<id> | 时间：N秒`，收尾指令要求原样引用。改 prompt 时不得删除标注或「禁止编造」指令。
2. **归一端过滤**：`EVIDENCE_REF_PATTERN = /^(ppt:\d+|kf:[\w.-]+)$/`，编造的散文 ref 直接丢弃（不报错、不渲染死链）。
   **few-shot 里给的值必须能过这条正则**——2026-09-17 之前示例写的是 `kf:<证据ID>`（`<`/`>` 不在字符类里），
   **示范的正是它要禁止的东西**，等于没教。见 `tests/note-prompt-quality.test.ts` 的钉住断言。
3. **渲染端兜底**：`bindTimelineImages`（`src/shared/notes/evidence.ts`）——ref 精确匹配 → timeline.at 就近关键帧（容差 `NEAREST_SECONDS = 90`）→ 无图纯文字卡。旧笔记无需重跑即可获得配图。

**两个口径不许合并**（2026-09-17）：
- **合法性判定**用**全量**证据集（`dropUnknownEvidence` 的入参）——绝不把模型没看到但真实存在的 ref 当编造删掉。
- **遵循度指标**（`evidenceHitRate` 徽标）用**发送集**——否则一节 100 帧只发 20 张时命中率上限恒为 0.2，徽标永远报警、指标不可行动。

### 2.1 PPT × 关键帧融合（2026-09-17 新增，改这一块必读）

**事实**（代码已核实，改动前先复核）：
- 关键帧抽自 `screen/PPT stream '1170195-5'`（`media/streams.ts`），**带时间**（文件名内嵌秒），保真度低（JPEG 截图）。
- 平台 PPT 来自 `/v1/course/ai/ppt?courseId=`（`school/client.ts`）——注意是 **courseId 而不是 lessonId**：
  deck 是**整门课**的，`orchestrator` 把它按同一个 lesson_id 存进**每一节课**；且 PPT 页**没有时间**
  （`attachments` 里 `ppt:N` 的 at 原本写死 null）。
- 平台 PPT 的获取是 best-effort、失败静默吞掉；真实课程常见空返回，此时**实际素材 = 关键帧**。

**融合三规则**（`shared/notes/visual-fusion.ts`，纯函数；解码在 `main/notes/visual-hash.ts`）：
1. **交叉去重**：关键帧与某张 PPT 页近乎相同 → 留 PPT 页（更清晰），该帧不再发；与任何 PPT 页都不匹配的关键帧**全部保留**（板书/现场演示/软件操作是 PPT 里没有的信息）。跨源阈值(3)**紧于**帧内去重(5)，免得「带讲者标注的幻灯片」被误判为冗余。
2. **给 PPT 反推时间**：匹配上的关键帧带时间、PPT 页有顺序 → 给 PPT 页分配单调递增时间轴，`ppt:N` 从此可作带时间的证据。**推断值必须标 `atInferred` 且 caption 写「约 N 秒」**，不得与实测时间混同。
3. **预算法**：只发本课时真正用到的 PPT 页（课程级 deck 必须靠匹配筛选）；超预算两边均分且互让余量，**绝不因冗余砍 PPT**。

**降级与保守方向**：一张都没匹配上 ≡ 匹配无信息 → 退回按页序采样全部 PPT（不静默丢通道）；
解码失败时关键帧照发（少发图是回归）、PPT 在有命中的情形下不发；PPT 为空时行为与融合前逐字一致。

## 3. 五视图投影规则

`VIEW_IDS = detailed | standard | key_points | methodology | mindmap`。

| 视图 | 内容策略 |
|---|---|
| 详细笔记 | 概览(md) → 树 → 时间线卡片流(图+引文) → 概念卡(含 example) → 公式分块 → 考点/缺口 → 课堂画面图集 |
| 标准总结 | 概览 + 树 + 前 8 概念 + 考点速览 |
| 要点 | 考点卡 + 缺口卡 + 前 5 时间线 |
| 方法论 | methodology(md) + operation/code 步骤（排除 formula） |
| 思维导图 | 整幅交互 SVG |

- 空 section **必须省略**（不渲染空标题）。
- 投影是纯函数，放 `src/shared/notes/`，测试在 `tests/notes-views.test.ts`。

## 4. Markdown 渲染（md-lite）

- 解析器：`src/shared/notes/md-lite.ts`——受支持集：`##` 标题、`-`/`*`/`1.` 列表、`>` 引用、`**粗体**`、`` `行内码` ``、**表格**（`| a | b |` + 分隔行）、**行内公式 `$...$` 与块级 `$$...$$`**、空行分段。
  - 公式定界符**两侧不贴空格**（`$x$` 是公式，「花了 $5 和 $10」不是）——避免误吃货币符号。
  - 未闭合的 `$$` **必须降级为普通段落**：先前瞻找闭合再消费，绝不吞掉后面整篇内容。
- **铁律：只产 token 数组，绝不产 HTML 字符串**。渲染层（`MdLite.tsx`）输出 Preact JSX，XSS 面为零。
  - **公式不破例**：不用 `katex.renderToString()`（产 HTML 串、逼出 innerHTML），
    而是 `katex.render(tex, ref容器)` —— 容器由 Preact 创建，字符串从不经过我们的手。
  - 畸形 LaTeX 降级显示原文，一份笔记不该因一条公式写错而整块渲染失败。
- 判断字段是否 markdown：`looksLikeMarkdown`（含表格判据 `hasTable`，**判据只有一份**，从 md-lite 导出）；纯散文投影为 paragraph 块。
- **代码块**：屏幕端与 PDF 讲义共用 `components/CodeBlock.tsx`（此前各写一遍 `<pre><code>`，PDF 端连底色都没有）。行号规则只有一个事实源：**≥3 行才编号**，且行号走 **CSS 计数器**——不进入文本节点，复制出去的代码不带行号。

## 5. 思维导图

- 布局：`src/shared/notes/mindmap-layout.ts` 纯函数（左根、叶子按行、父居中、贝塞尔连线、CJK 宽度估算、折叠路径集、可选 terms 副行 `showTerms`、可选跨节点关联线 `links`——折叠端点不渲染）。**屏幕交互版（MindMap.tsx）与 PDF 静态版（PrintHandout）与 SVG 导出（mindmap-svg.ts）共用同一布局函数**——几何只有一个事实源；缩放/平移是 viewBox 变换，不碰几何。
- 交互（Map Expansion 2026-09-05）：视图内子工具栏（层级控制=collapsedSetForMaxDepth 纯函数 + 标题搜索：命中高亮/展开祖先/滚动定位，与回忆模式互斥）、Ctrl+滚轮指针锚点缩放 0.4-3x、空白拖拽平移、节点点击折叠（caret+后代计数胶囊）、ℹ️ 浮层（关联概念+锚定 quiz 翻面+跳详细笔记）、双击下钻焦点模式（面包屑返回，折叠集全路径空间 fullToRel/relToFull 映射）、回忆模式（depth≥2 同色遮罩逐个揭示）、导出 SVG。
- 课程级：`notes:courseTree` 聚合各课最新版树（`mergeCourseTree` 纯函数，第N节课序复用 course-order），模态 CourseMapDialog；**不跨课时概念链接、不进 PDF**。
- **关联线几何**（2026-09-17）：跨列走层级贝塞尔（与树边同形）；同列/重叠走**两者之间竖走廊的正交折线**——此前的中心直线必然穿过两个节点框。只保证不穿端点矩形（全局路由成本远超收益）。
- **关系模式**（2026-09-17）：同一视图内的**第二种呈现**——把 `conceptLinks` 当主结构画成概念关系图（`shared/notes/relation-layout.ts`，纯函数）。刻意**不新增第六视图**：spec §5 修订批注① 把五视图钉死了，模式切换是纯呈现层改动。
  - 布局确定性：按链接建联通分量 → 分量内节点**按 term 排序**均匀排在圆上（半径随节点数增长）→ 分量按「节点数降序 + 首 term」左到右排列。无迭代、无随机、无 d3，因此可测、可回归、截图稳定。
  - 边**不受 ≤5 条限制**（这正是关系模式要解决的问题）；端点裁剪到盒边界；无向去重（A→B 与 B→A 只画一次）；解析不到的概念/自环一律不进图（归一层之后的二次防线）。
  - 关系词就是「命题」的关系项——§8 的**命题审计**保证它不是名词填充。两者是配套的：审计管数据质量，关系模式管可见性。
  - 没有可解析的关系边时**不显示**切换按钮（按下去只会看到一张空图）。

- **导图导出**：SVG 走 main 侧 `treeToSvg`（`notes:exportSvg`）；**PNG 在渲染层光栅化**（`renderer/rasterize-svg.ts` + `CodeBlock` 同级的共享渲染件）——`treeToSvgDocument` 是纯函数，渲染层直接用它产 SVG 再画进 canvas，于是 SVG 文本不必经 IPC 往返、main 不需要任何图像编码器（零新依赖），main 只解码 base64 + **校验 PNG 魔数** + 落盘。默认 2× 缩放，先铺纸白底。测试缝 `SEU_PNG_PATH`。
- **边收集是索引而非全量扫描**：按父路径建一次 Map（原实现对每个节点全量 `filter` + 逐段比 `path`，课程级导图会明显吃 CPU）。性能门禁见 `tests/mindmap-layout.test.ts`。

## 6. PDF 讲义（printToPDF）

> 2026-09-17 从 v1.1.0 原样保留——这一节的四条铁律都是实跑踩出来的，删掉会重犯。

- **架构铁律**：主窗口 `webContents.printToPDF`——不开第二个 BrowserWindow（本机存在第二渲染器永不 commit 的环境故障，PROGRESS 有案），零新依赖。
- **DOM 铁律**：`#print-root` 必须是 `.app-shell` 的**兄弟节点**——print.css 在打印媒体下 `display:none` 整个 shell，嵌套在里面会被连带隐藏（真实踩坑：空白 23KB PDF）。
- **时序铁律**：导出流程 = dialog → 渲染 handout → `waitForImages`（每张 img decode 完成）→ exportPdfWrite → 清空 root。图片未 decode 完就打印 = 空白图。
- 排版规则（转化自 pdf skill）：A4；卡片/标题+首段 `break-inside: avoid`；H2 `break-after: avoid`；导图整页 `break-before: page`；封面 `break-after: page`；正文 ≥10.5pt；打印强制纸白（暗色主题下也白）；`printBackground: true` + 页码页脚；**矢量输出验证**：文本 ops > 0、字体子集嵌入、图片 DCT 数 = 附件数。
- 2026-09-17 补：`print.css` 此前**没有任何表格与 `<pre>` 规则**（表格退化成无边框、代码块像普通文字），已补纸白底；公式经 KaTeX 输出 HTML+MathML，满足矢量铁律。
- 测试缝：`SEU_PDF_PATH` 环境变量绕过原生保存对话框（e2e 专用，勿在产品路径删除）。

## 7. 视觉纪律（转化自 pptx/pdf skill，违反=返工）

- **三角色色彩**：BACKGROUND（表面）→ PRIMARY（靛蓝 accent）→ 琥珀/红仅作考点/缺口语义色。全文档 ≤5 色、同色系分层（透明度/深浅），禁彩虹。
- **低饱和填充**：节点/卡片底色必须浅（--*-soft 令牌）；高饱和只允许出现在小标签/描边。
- **禁止**：彩色边条/accent stripe、标题装饰下划线、emoji 图标、每页超过 3 个装饰元素、3 字体以上。
- 层级靠**字号/字重/留白**，不靠加框加线。

## 8. 体检与存量升级

- `noteHealth(note, hitRate?, transcriptHitRate?)`（`src/shared/notes/health.ts`）→
  `{ warnCount, grade: good|fair|weak, findings: [{field, level: warn|info}] }`。
  - **检查项与 prompt 规约一一对应**：概览 ≥150 字 + `##` 小节；概念定义均长 ≥60 且非循环定义、
    **概念为空报 warn**；时间线**为空报 warn**、detail 复读标题或为空报 warn、**detail <60 字报 warn**；
    知识树分支数/层数/标题长度；quiz 非空但 <5 题；证据命中率 <60%；转写摘引可核验率 <60%；
    概念关联 label 命题审计。
  - **历史教训（2026-09-17）**：`conceptFindings`/`timelineFindings` 曾在数组为空时直接 `return []`，
    于是一份**概念与时间线全空**的笔记只要概览够长就评 `good`——体检形同虚设。
    而且**测试套件本身建在这个洞上**：courseHealth 的 `RICH_NOTE` 夹具名为「丰富」，实际是
    knowledgeTree 零子节点、timeline/concepts/quiz 全空。**必填分节缺失必须是 warn**。
  - **`example` 缺失只报 info**：讲者没给例子时省略该字段是正确行为（宁空勿编），
    报成缺口会逼模型编例子。
  - **容忍部分形状**：渲染层会在 mock/降级路径下传缺字段的笔记，`noteHealth` 绝不能因此抛错
    （曾导致 app-shell 整个 shell 崩溃）。
- **归一化丢弃计数可见**（2026-09-17）：`parseNoteWithDiagnostics` 额外回报 `quiz` / `conceptLinks` / `transcriptRefs` / `evidence` / `treeTerms` / `timelineEvidence` 各被归一层丢了**几项**，生成 toast 里显示「N 项格式不合法已丢弃」。
    起因：这些字段的非法项此前全被静默丢弃，用户只看到「内容有点少」，体检也只会说「空」——**区分不了「模型没写」与「写了但被拦下」**，而这是两种完全不同的问题。
    实现刻意用「原始数组长度 vs 归一化后长度」的**差分**，而不是给每个 zod transform 加计数器：判定谓词只有一份（在归一层里），这里不复制它们——复制就会漂移。
- **存量升级**：`notes:courseHealth(courseId)` IPC + 笔记库课程组「升级旧笔记」对话框。
  默认勾选口径 = **`warnCount > 0` 或 `promptVersion < CURRENT_PROMPT_VERSION`**（2026-09-17 扩）；
  确认后逐课串行 `notes:regenerate`（复用转写零下载）。
- 真实库基线（2026-09-08，升级前）：1690406-L0 v1=fair(warn2)/1690625-L0 v3=fair(warn2)/bili-P3 v2=fair(warn1)；
  **升级后（同日真机 e2e：副本+安装版 Local State 缝+真实 MiMo 重生成）三课全部 good(0 warn)**——
  内容抽检：概览 147→705 字、概念定义均 45→109-134 字含芯片实例、考点 0→3 条具体化、ASR 错词纠正（74151）。

## 9. Obsidian 结构化导出（2026-09-08，plan docs/plans/2026-09-08-obsidian-export.md）

- **投影单一事实源**：`src/shared/notes/obsidian.ts`（projectObsidianNote / projectConceptIndex / projectVaultIndex）——只产 markdown 字符串；附件只列名不读字节，main 侧 `src/main/notes/obsidian-export.ts` 负责落盘与复制。
- **文件布局**：`<vault>/Flash Summary/<课程名>/<课时名>.md` + `attachments/<lesson_id>-<原文件名>`；`_概念.md`（课程概念聚合，同名 term 归一归并，导出自动重建勿手改）；`_index.md`（全库结构约定，从 manifest 重建）。
- **SR 卡纪律**：概念卡 `[[term]]::definition` **单行**；quiz 多行「问 / ? / 答」；牌组 = 行内 `#flashcards/<课程tag>/<课时tag>`（**frontmatter tags 插件不识别，必须行内**）；tagSafe 清洗空格与非法字符。
  - 2026-09-17：概念卡的 example **并进同一行**（`definition 例：…`）而不是换成多行 `?` 形态——`::` 是单行语法，保持插件已验证的形态不变。
- **幂等**：migration 010 `obsidian_exports`（lesson_id 主键）——同课时覆写、改名清旧文件、vault 切换不误删；`_index.md` 明示「直接改写会在下次导出被覆盖」。
- **红线**：导出物零直链零密钥，B站只放公开 bvid；附件只带走笔记实际引用的（D4=A）。
- **测试缝**：`SEU_OBSIDIAN_PATH` 绕过 vault 目录选择（一次性覆盖，不落 settings）。

## 9.5 笔记库列表契约与「不静默截断」纪律（2026-09-18，plan docs/plans/2026-09-18-note-library-reachability.md）

- **契约**：`notes:list` / `tasks:list` 返回 `ListPage<T> = { items, total, limit }`（`src/shared/bridge.ts`）。**总数必须由数据给**——界面标题里不许出现硬编码的「最近 200 条 / 最近 50 条」：上限改了文案不会跟着改，被截断时也从不告诉用户（整改前就是这个状态）。
- **过滤在主进程**：关键词走 SQL（`notes:list({ keyword })`），**不要**在渲染层过滤已取回的那一页——那等于对页外的数据撒谎（用户搜「某节课」搜不到，而那条笔记其实存在）。
- **搜索口径 = 列表可见字段**：课程名 / 教师 / 课时名。教室、学期、课程号这些**列表里看不见**的字段不参与匹配（搜到了却看不见命中的词会被当成 bug）。注意这与课程侧相反——课程树里教室/学期是可见的，所以 `courseMatchesQuery` 搜它们是对的。
- **分页**：默认页长（笔记 200 / 任务 50）之上再用 `limit` 按页加长，底部「显示更多（还有 M 条）」，取完不给按钮。**不做虚拟滚动**（M3-2 约定）。
- **验收工具**：`node scripts/ui-probe.mjs --note-search=词`（量标题/命中行数/分组）、`--paging`（首屏→点击→取完）、`--seed-notes=N`（往**副本库**注入合成课时把列表撑过页长——真实库只有个位数笔记，不造材验不到分页）。

## 10. Anki 导出

- `src/shared/notes/anki.ts` 纯投影 → TSV（Anki 原生文本导入，每行一卡、制表符分列）。
- 两种卡：概念卡（term → 定义，**2026-09-17 起背面带 example**）、自测题卡（问 → 答）；来源列固定为课时标题。
- 字段内**禁止制表符/换行**（会撑开行），`sanitizeField` 折叠为空格。

## 11. 测试要求（纪律红线）

- 每批提交四门禁全绿：`npm run lint && npm run typecheck && npm test` + `npm run smoke`。
- 测试数**只增不减**；不许 skip/删断言/mock 被测关键路径。
- 新增视图/块类型必须带：投影测试（notes-views）、渲染测试（note-viewer / print-handout）、纯函数直测（md-lite / mindmap-layout / evidence / ref-verify / visual-fusion）。
- IPC 新通道：FakeIpc + `vi.mock('electron')` 模式（样板 `tests/notes-ipc.test.ts` / `tests/notes-pdf-ipc.test.ts`），并在 `scripts/smoke-cdp.mjs` 的桥面清单登记。
- **新增 migration 要同步改两处硬编码**：`tests/db-migrations.test.ts` 的版本数组、`scripts/smoke-cdp.mjs` 的迁移计数断言。
- **测试夹具必须真的合规**：一条规约收紧后，旧夹具若靠「检查太浅」通过，就要把它升级为
  真正合规的范本，而不是放宽新检查（2026-09-17 的 `RICH_NOTE` / `validNote` 都是这样改的）。
- 真实数据验证：改渲染/导出后必须跑 `node scripts/ui-shots.mjs`（真实库副本隔离）+ DOM 计数探针；PDF 导出跑完整按钮流 e2e 并检查产物结构（页数/图数/矢量文本）。
- **真实数据验收工具**（全部只读或副本隔离，绝不碰真实库）：
  - `node scripts/ui-shots.mjs [outDir]` —— 真实库**一次性副本**启动真实构建，走查各视图并截图（可见性走查）。
  - `npx vite-node scripts/note-ref-audit.ts` —— **只读**真实库，用新核验逻辑跑各笔记的转写锚，输出可核验率 / at 越界 / 邻域违例的真数字。
  - `node scripts/note-pdf-verify.mjs` —— 往**副本**注入一份含 LaTeX 公式/表格/例子/关联的样例笔记，走真实「导出 PDF 讲义」按钮流，扫 PDF 字节确认 **KaTeX 字体子集已嵌入（= 公式是矢量文本而非图片）**，并顺带核验迁移在真实库副本上生效。
  - `node scripts/note-regen-e2e.mjs --keep` —— 在**副本**上跑真实重生成（真实模型）：库副本 + 真实 userData 的 `Local State`（DPAPI 缝）→ 逐课调 `window.seuSummary.notes.regenerate`。**单课上限必须大于两次串联的聊天超时**（生成 + 返修，而 `CHAT_TIMEOUT_MS=600_000`/次）——脚本取 25 分钟，否则你观察到的只是自己被掐断，不是应用的结果。
  - `npx vite-node scripts/note-fusion-verify.ts` —— 造一份**忠实素材**（把关键帧 JPEG 另存为 PNG 当「平台 PPT 页」，现实中两路拍同一块屏幕）后直接调 main 的真实 `loadSummarizeInputs`，核验「撞图关键帧被丢弃 + PPT 页拿到 `atInferred` 时间」。**真实库 ppt_pages 恒为 0，真 PPT 素材不存在，必须造材。**
  - `node scripts/note-coursemap-verify.mjs [--page=4] [--no-import]` —— 课程级导图验收：在副本上真实导入同一门课**另一个分P**（导入只建课时行，**跑管线要另发任务**），等第二份笔记生成后打开课程导图并截图 + 量几何。**真实库每门课只有 1 节有笔记时，跨课时合并是空操作，必须先造出第二节课。**
  - 教训：**「渲染器写了」不等于「渲染得到」**。批4 的 KaTeX 一度是空转的——规则 4 禁止一切 Markdown 标记，把 formula 的 content 也禁了，模型永远不会写 `$...$`；批4 的表格一度只在 detail 视图验，而表格其实在方法论视图。**新增渲染能力必须配一条真实数据的 DOM 探针**。
- **组件测试环境缝**：`tests/components/setup.ts` 补 `document.compatMode`——happy-dom 不实现它，
  而 KaTeX 在**模块加载时**据此判定并永久禁用渲染。真实渲染进程 `index.html` 第一行就是
  `<!doctype html>`，所以这是测试环境缺口，不是产品问题。

## 12. 已知边界（改动前先想）

- ASR 时间戳粒度 = 120s 分片起点（精对齐受限，证据对齐靠三层机制补偿）。**B站字幕是秒级**——两种粒度的核验邻域阈值按源分档，不要一刀切。
- 本地视频已删、平台播放页无时间参数——时间戳跳转视频**明确不做**。
- 笔记无在线编辑器；版本历史全量留存但 UI 无版本切换。
- 平台 PPT 是**课程级**端点、可能空返回；PPT 页的时间是**推断值**（见 §2.1）。
- **B站源**：transcripts.provider = `bilibili-subtitle`（字幕直插，秒级 `at`）或 `openai-compatible`（ASR 兜底）；提示词经 `sourceHeader` 注入「B站视频」语境行，SEU 行为零变化；证据只有 `kf:`（流被风控拒绝时 evidence 可为空，属合法态）。
- 笔记库 `notes:list` 有 `LIMIT 200` 上限且无搜索——已知缺口，属「笔记库」而非「笔记总结」，待单独处理。

## 13. 定位边界：不做学习/教学功能（2026-09-17 Andiii 裁定）

**产品定位是「把总结做好」。** Andiii 原话：「我不喜欢教学，把总结做好就够了」。

**明确不做**（下一个会话不要再提，除非用户主动要求）：
- 检索练习题型学（题型配比 / 禁是非题 / 会话内排序 / 诊断性作答解析）
- 自测钩子化、Cornell Cue 自测化、`TreeNode.cues`
- `Concept.misconception`（其价值主要来自「错误侦测题素材」）
- 间隔重复调度器（FSRS/SRS）、掌握度追踪、错题本、今日队列、学习进度可视化
- Anki 卡型扩张（Cloze 挖空 / 图像遮挡卡）
- 「个人思考」等用户自写输入区
- quiz 的任何升级——**quiz 维持现状（5-8 题 Q/A），本方案不动它**

> 2026-09-08 那份完整的「复习闭环」方案（`docs/plans/2026-09-08-notes-experience-overhaul.md`）
> 已被 Andiii 否为「太重了，和最初想法背道而驰」。被否的是**重量**，不是诊断
> （那份文档 §一 的 Dunlosky 效用分级分析仍然有效，保留作调研存档）。
> **若将来要重开学习科学线，应当单独立项，不要并进笔记质量方案。**

## 14. 与外部 Agent 能力外露方案的会师点（2026-09-17 写死，勿绕）

背景：`docs/plans/2026-09-17-agent-capability-exposure.md` 计划把本产品的「视频源 →
总结文档」能力经回环服务 + stdio 桥接外露给 ZCode / Codex / WorkBuddy 等外部 Agent，
工具面里有两个**读**工具：`note_get(lessonId, format)` 与 `document_export(lessonId, format)`。

**硬约束（改这两条链路前必读）**：

1. **外露通道返回的 markdown 必须过同一套 `shared/notes/*` 投影**——`note_get` 的
   markdown 走 `noteToMarkdown`，导出走 `obsidian.ts` / `anki.ts` / `mindmap-svg.ts`，
   一个字节都不许另写一份。理由：本文件 §0 的「一个 JSON 驱动全部呈现」是产品的地基；
   外露通道如果自建投影，就会长出**第二事实源**，此后五视图/PDF/Obsidian 修好了而
   Agent 拿到的那份没修——同一份笔记在两条通道上内容不一致，而用户无从发现。
2. **`document_export` 必须复用现有的导出投影，不得为了「无对话框」另实现一套**。
   无头变体只允许改**落盘与返回路径**这一层（写 `exports/` 并返回绝对路径），
   内容生成仍然调 `shared/notes/*`。
3. **凭据边界**：工具只返回文档与任务状态，**绝不返回** cookie / JWT / API Key
   （与 `DISCLAIMER.md` §4、AGENTS「反馈通道只给入口、不上报」同源）。
4. **声明层先行**：外露是**新的用户可见承诺**（批量边界、风控提示），按 AGENTS
   「声明层纪律」必须先进 spec §9 与 `DISCLAIMER.md` 再落实现——那份方案的批 0
   就是干这个的，不许跳过。

**回归防线**：任何改动 `shared/notes/` 投影的批次，都要意识到它有**两个消费面**
（应用内五视图/导出 + 外露通道）。改动后除四门禁外，应顺带确认
`tests/concept-example.test.ts` 一类「全链路投影」用例仍覆盖新字段——那正是
「新字段有没有在每个出口都落地」的机械保证。

## 15. 方法论参照（GitHub 调研）

### 15.1 外部方法论吸收登记（2026-09-17）

| 来源 | 仓库许可 | 吸收了什么 | 处置 |
|---|---|---|---|
| `FerroxLabs/wayland`（教育类目 140+ skill） | 仓库 AGPL-3.0，但文件 frontmatter 写 `license: Apache-2.0`、author 为第三方 → **冲突 + provenance 不明** | `concept-mapping` 的「**命题结构 + 命题审计**」（→ §7 的概念关联审计）；`note-synthesis` 的「表观矛盾不要人为消解」 | **只参考方法论、自写文本**。仓库许可冲突未澄清前不得搬运文本 |
| `majiayu000/claude-skill-registry` | MIT | `cornell-notes` 的「Cue 是**按小节**组织的关键问题」这条结构洞察 | 可吸收，保留声明 |
| `LeoYeAI/openclaw-master-skills` | MIT | `lecture-notes-master` 的「递归原子分解 + 每个原子笔记必须充实」（→ `Concept.example` 的论据） | 可吸收，保留声明 |
| `LjyYano/skill-pack` | Apache-2.0 | `video-to-note` 的「字幕优先 / ASR 兜底」管线形态（与本产品同构，属独立先例） | 可吸收，保留声明 |
| `https-deeplearning-ai/sc-agent-skills-files` | **无声明** | 未吸收（教学向） | 不可搬运 |

**若将来确要吸收第三方文本**：先澄清 provenance，再在 `THIRD-PARTY-NOTICES.md` 登记 +
许可文本进 `LICENSES/`（AGENTS 硬规定）。

### 15.2 已评估不采纳（含教学向，防止重复提案）

- 教学向（见 §13 的整份清单）：`active-recall-practice`、`generating-practice-questions`、
  `flashcard-generation`、`anki-card-creator`、`spaced-repetition`、`feynman-technique`、`exam-prep-plan`。
- `note-synthesis` 的「汇聚/扩展/张力/矛盾」四分类**未采纳为概念关联的 label 体系**：
  那套是**跨来源**综合的分类，而本产品严格限定单课时内的概念关系（跨课时概念链接是既定
  不做的边界）。单课时只有一份来源，「汇聚」无从谈起——照搬会是**类别错误**。保留了既有的
  单课时关系词表，只补「必须真是关系」这条审计。
- `tapestry/learn-this`（URL→提取→行动计划）：编排类，方法论视图已承载该职责。
- qiaomu 的多源抓取/NotebookLM 上传管线：与「本地优先、自有管线」定位冲突。

### 15.3 Cornell 5R ↔ 五视图映射（视图设计的理论锚点）

先例：`KenWuqianghao/Obsidian-Cornell-Notes-Generator`（LLM 从 lecture transcript 生成 Cornell 时间线笔记，与本产品场景同构）；生态参照 `latazadehomero/cornell-marginalia`、`TfTHacker/cornell-notes-learning-vault`。

| Cornell 结构 | 本产品对应 | 设计含义 |
|---|---|---|
| Notes 栏（课堂详录） | 详细笔记视图（时间线卡片） | 详录以时间为主轴，正是时间线卡片的形态依据 |
| Cue 栏（关键词/自测问题） | 要点视图（考点/缺口卡） | Cue 的本质是「挂在小节上的关键问题」——**2026-09-17 起只作为结构参照，不做自测化**（§12） |
| Summary（页底总结） | 标准总结视图 | 总结必须是**合上详录后能独立读懂**的封闭叙述 |
| Reflect / Review | 方法论 + 疑问与缺口 | 反思层永远不与详录混排—— methodology 单独成视图的依据 |

### 15.4 Zettelkasten 原子化（概念卡的原则）

参照 `01110100chony/optimized-study`（Obsidian Zettelkasten + Claude 苏格拉底式，STEM 深度学习）。原则：概念卡**一卡一概念、自足可读**。当前 `concepts[]` 已是原子卡；2026-09-17 起补 `example` 让「自足」落到**具体实例**上（而不只是定义够长）。


