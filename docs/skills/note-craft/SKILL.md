---
name: note-craft
description: SEU Summary 笔记系统的工艺规范——数据契约、证据对齐、五视图投影、视觉纪律、PDF 排版与测试要求。凡改动笔记生成/展示/导出链路的会话必须先读本文件。
version: 1.0.0
---

# SEU Summary 笔记工艺（Note Craft）

> 2026-09-04 由 Note Revolution 计划沉淀。方法论转化自官方 document-skills（pdf 的矢量铁律/分页质量门/色彩纪律、pptx 的反 AI 味清单），实现事实以本仓库代码为准。

## 0. 数据契约（单一事实源）

一个结构化 JSON 驱动全部视图——**绝不生成多份独立总结**。

```
Note {
  overview, methodology          ← LLM 按 markdown 组织（## 小节 + - 列表）
  knowledgeTree: TreeNode        ← 思维导图的唯一数据源
  timeline: [{at, title, detail, refs[], evidence[]}]
  concepts: [{term, definition, refs[]}]
  formulasAndSteps: [{kind: formula|code|operation, content, explanation, refs[]}]
  examCues[], questionsAndGaps[]
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

- 布局：`src/shared/notes/mindmap-layout.ts` 纯函数（左根、叶子按行、父居中、贝塞尔连线、CJK 宽度估算、折叠路径集）。**屏幕交互版（MindMap.tsx）与 PDF 静态版（PrintHandout）共用同一布局函数**——几何只有一个事实源。
- 交互：节点点击折叠，折叠徽标显示隐藏后代数。

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
