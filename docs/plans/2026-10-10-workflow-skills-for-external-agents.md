# 2026-10-10 工作流 Skill 化：把核心能力蒸馏给「不下载 app」的同学 方案

> 状态：**方案待审**（未动任何代码、未建任何文件）。日期：2026-10-10。
> 触发：Andiii「我想为这个项目再添加两个或者几个 skill，把这个软件的核心功能、核心工作流提炼总结出来，让不太愿意下载或不方便下载的同学直接使用 skill 配合自己的 agent 完成整个工作流。skill 的设计不要太复杂，要具有可 DIY 性，不要求 100% 复刻软件的全部功能。我也可能看到计划后毙掉这个想法，没关系」。
> 本方案是**纯文档资产**（markdown skill 包），不改动任何产品代码、不动产品边界。若批准，按 AGENTS「声明层纪律」先在 spec §9 登记再落地。

## 0. 结论速览

**可行，而且比外露方案便宜得多——但价值点要选对。**

- 本产品的真正护城河不是「能下载视频」（那是 plumbing，且 SEU 源涉及校园网 + 登录态 + 平台条款，本就不该进 skill），而是 **note-craft 那套「转写稿 → 结构化课程笔记」的工艺**：五阶段管线、数据契约、写作规约、核验纪律。这套东西**本来就是提示词层的知识**，蒸馏成 skill 是零适配成本。
- 建议做 **2 个 skill**：`flash-lecture-notes`（转写稿 → 结构化笔记，核心）+ `flash-lecture-qa`（基于笔记的带引证追问）。**刻意不做第 3 个「视频抓取/下载」skill**——那是合规红线区（凭据、平台风控、批量抓取三条全撞），用户自备转写稿是刻意的安全边界，不是缺憾。
- **可 DIY 性用三层实现**（改配置 → 改规约 → 改结构），全部通过「编辑纯文本文件」完成，不写代码、不装依赖。SKILL.md 入口控制在 150 行以内，默认路径最短：**给一段转写稿，出一份 Markdown 笔记**，其余全是可选模块。
- Skill 不绑定任何模型/Provider（不碰 key、不发请求，全部由宿主 agent 完成），因此对所有 agent 通吃；最保守的用法是把 SKILL.md 直接当系统提示贴给任何 agent——**零安装路径**。
- 与 2026-09-17 的「能力外露」计划（`docs/plans/2026-09-17-agent-capability-exposure.md`，待审未执行）是**互补关系**：外露是把 app 的能力接给 agent（重，要回环服务 + MCP + 凭据边界裁决）；skill 是把方法论给 agent（轻，一个 markdown 包）。两者都受 note-craft §14「单一事实源」纪律约束。

## 1. 核心工作流提炼（从代码实证，不是拍脑袋）

软件的完整链路在 `src/main/tasks/orchestrator.ts`（六阶段）与 `docs/skills/note-craft/SKILL.md`（工艺规范）。按「能否脱离 app 运行」逐段盘点：

| 环节 | 代码位置 | 能否进 skill | 处置 |
| --- | --- | --- | --- |
| SEU 平台收割（登录/课程树/播放页） | `main/auth/*`、`main/school/*` | ❌ 不能也不应 | 凭据 + 校园网 + 平台条款三红区。skill 只接受**用户自备的转写稿/字幕** |
| B 站导入（字幕优先/ASR 兜底） | `main/bilibili/*` | ❌ 不进 | 抓取本身有风控/付费边界（DISCLAIMER §2/§3）。用户用自己顺手的工具拿字幕 |
| 本地视频 → 音频 → 转写 | `main/media/*`、providers ASR | ❌ 不进 | 需要 ffmpeg + ASR key，属安装行为，与「不下载 app」目标互斥 |
| **转写清洗**（去语气词/修口语/统一术语） | `shared/notes/transcript-clean.ts` | ✅ 能 | 蒸馏成 prompts.md 的「备料阶段」规约 |
| **结构化生成**（shape 8 条 + quality 规约 → Note JSON） | `main/notes/summarize.ts:47-84` | ✅ 能 | **skill 的核心**：prompt 模板 + schema 契约原样蒸馏 |
| **核验与一次有界返修**（ref-verify / noteHealth） | `shared/notes/ref-verify.ts`、`health.ts` | ⚠️ 降级 | 代码核验变成**自检清单**（agent 逐条自审），纪律不变、机制降级——如实写进 skill 的「已知边界」 |
| **投影**（五视图 / Markdown / Obsidian / Anki / 导图 SVG） | `shared/notes/views.ts`、`obsidian.ts`、`anki.ts`、`mindmap-svg.ts` | ✅ 能 | Markdown + markmap 导图代码块为默认；Obsidian/Anki 配方进 references/exports.md（可选模块） |
| **追问**（上下文=转写+笔记，答案带引证） | `main/notes/qa.ts` | ✅ 能 | 第二个 skill |
| 队列/断点续跑/DPAPI/自动更新 | `main/tasks/*`、`auth/*`、`update.ts` | ❌ 不需要 | app 运行时关注点，skill 场景不存在 |

**提炼结论**：skill 版覆盖「转写稿进 → 结构化笔记出 → 基于笔记问答」这条主链，砍掉全部获取侧与运行时。这与 Andiii「不要求 100% 复刻、不要太复杂」的要求正好同向。

## 2. Skill 设计

### 2.1 清单与命名

| Skill | 干什么 | 输入 → 输出 |
| --- | --- | --- |
| `flash-lecture-notes` | 核心：一段带时间锚的转写稿 → 一份结构化课程笔记（时间线 / 概念卡 / 方法论 / 考点与缺口 / 金句 / 思维导图） | 转写稿（.txt/.md/.srt 均可）→ 单文件 Markdown |
| `flash-lecture-qa` | 追问：只基于给定的笔记（+转写稿）回答，答案必须带引证，笔记没说的明说没说 | 笔记文件 + 问题 → 带引证的回答 |

命名带 `flash-` 前缀：与用户机器上其他 agent 的泛名 skill（如 `lecture-notes`）防撞；安装时也可自行改名（DIY 第一层的延伸）。

### 2.2 文件结构（刻意保持扁平）

```
skills/                                  # 顶层新目录（对外分发；与 docs/skills/ 内部开发规范区分）
├── README.md                            # 是什么 / 怎么装 / 怎么 DIY（含改造示例）
├── flash-lecture-notes/
│   ├── SKILL.md                         # 入口 ≤150 行：何时用、五阶段、铁律、指向 references
│   ├── CONFIG.md                        # 【DIY 第一层】语言/详细度/模块开关/命名规范
│   └── references/
│       ├── schema.md                    # 【DIY 第三层】笔记契约：字段 + 每字段写作规约（唯一事实源）
│       ├── prompts.md                   # 【DIY 第二层】生成/返修 prompt 模板（占位符化）
│       ├── selfcheck.md                 # 自检清单：替代软件的 ref-verify/noteHealth 代码核验
│       └── exports.md                   # 可选导出配方：Obsidian frontmatter / Anki cloze / markmap / HTML 讲义骨架
└── flash-lecture-qa/
    └── SKILL.md                         # 含一小节「配置」（这个 skill 足够小，不单列 CONFIG.md）
```

v1 **零脚本、零依赖、纯 markdown**——最大化跨 agent 可移植性（任何能读文件的 agent 都能用）。

### 2.3 SKILL.md 入口样例（flash-lecture-notes，示意篇幅与结构）

```markdown
---
name: flash-lecture-notes
description: 把一段课程转写稿（带 [mm:ss] 时间锚）变成结构化课程笔记：时间线、概念卡、
  方法论、考点、金句、思维导图。当用户说「总结这节课 / 这个视频 / 这份转写」时使用。
version: 1.0.0
---

# 课程笔记生成

## 何时用 / 不用
- 用：用户给出课程/讲座/公开课的视频转写稿或字幕，想要结构化笔记。
- 不用：需要登录学校平台或抓取视频的场景——凭据与平台边界不在本 skill 范围，
  请用户自备转写稿（这是刻意边界，见文末声明）。

## 先读配置
按 CONFIG.md > 用户口头要求 > 本文件默认 的优先级取参数。

## 五阶段（每阶段都可跳过或替换，细节在 references/）
1. 备料：确认转写稿带时间锚；没有就先补锚或按段编号。清洁口语（去语气词、统一术语）。
2. 生成：按 prompts.md 的模板 + schema.md 的契约产出笔记。
3. 自检：按 selfcheck.md 逐条核（摘引可核验 / 时间戳不越界 / 概念卡自足）。
4. 返修：只一次，只改自检失败的字段；再自检不通过就保留原稿并文末标注。
5. 投影：默认单文件 Markdown（内嵌 markmap 导图代码块）；可选导出见 exports.md。

## 铁律
- 单一事实源：所有内容只从 schema.md 的契约生成，不得另写一份「另一版总结」。
- 宁空勿编：字段没有依据就留空。
- 降级而非报错：没有视觉素材/时间锚缺失也照常出笔记，文末标注降级项。
- 声明：本 skill 与东南大学、哔哩哔哩无任何隶属关系；不用于付费/充电内容；不批量抓取。
```

### 2.4 与软件行为对齐的刻意保留

- **五阶段管线**（备料→生成→自检→返修→投影）与 note-craft §0 同构，用户两边拿到的手感一致。
- **「一次有界返修」**：软件的返修是代码兜底的；skill 版靠 prompt 纪律，仍在自检清单里写明「只修一次，不过就保留并标注」——防 agent 无限自迭代烧 token。
- **降级而非报错**：软件的视觉素材（关键帧/PPT）进不了 skill，时间线条目照样出，文末标「本文无配图」——和 app 里「断供可见化」同一精神。

## 3. 可 DIY 性设计（Andiii 特别强调的点）

分三层，**改哪层不动哪层**，全部是编辑纯文本：

| 层 | 文件 | 能改什么 | 适合谁 |
| --- | --- | --- | --- |
| L1 配置 | `CONFIG.md` | 输出语言、详细度（concise/standard/detailed）、模块开关（quiz / anki / mindmap / 金句）、文件命名规范 | 所有用户，零门槛 |
| L2 规约 | `references/prompts.md` | 写作风格、口吻、学科倾向、生成/返修 prompt 全文（占位符 `{{TRANSCRIPT}}` 等） | 想调味道的用户 |
| L3 结构 | `references/schema.md` | 增删字段（如加「课堂金句卡片」、去掉 `examCues`） | 高阶用户；exports.md 的自检/导出配方只读 schema，改结构时照着改一处即可 |

**三个改造示例**（会写进 skills/README.md，让用户 5 分钟上手）：

1. **改成英文输出**：`CONFIG.md` 改 `language: en` 一行——L1。
2. **只要要点、不要时间线**：`schema.md` 删 `timeline` 段 + `prompts.md` 删对应产出段——L3，流程一行不动。
3. **加一个「金句卡片」模块**：`schema.md` 加字段 + `selfcheck.md` 加一条核验 + `exports.md` 加一段投影——L3 扩展的标准姿势。

**防复杂化机制**：SKILL.md 每个阶段标注「可跳过/可替换」；references 互相只通过 schema.md 引用（单一事实源），用户永远不需要同时改两个文件才能保持自洽。

## 4. 明确的边界（诚实清单，写进 skill 自己的「已知边界」节）

| 软件有 | skill 版 | 为什么 |
| --- | --- | --- |
| 代码级核验（ref-verify/noteHealth） | 自检清单（agent 自审） | 提示词层没有代码执行；靠纪律 + 宿主 agent 能力 |
| 关键帧/PPT 配图 | 无图，文末标注 | 素材获取不在边界内 |
| PDF 讲义（printToPDF） | 给 HTML/Markdown 讲义骨架配方，PDF 交给用户 agent 的文档 skill | 不重造排版栈 |
| 五视图切换 | 一个 Markdown 文件含全部小节；要「只要要点」用 L1/L3 裁 | 单文件比多视图更适合 agent 工作流 |
| 自动更新 | 无（git pull 即更新） | skill 是文档，版本跟着仓库 tag 走 |
| SEU/B 站登录抓取 | 无（用户自备转写稿） | 凭据/平台条款红线，见 §1 |

## 5. 合规与声明层（AGENTS 纪律，不许跳过）

1. **spec §9 先行**：批准后先在 spec「User-facing disclosure layer」增补一条——「Skill 分发通道」：说明 skill 是方法论文档、不含任何抓取/凭据能力、与 app 同源的非官方无隶属声明、随仓库版本分发。**先 spec 后落地**。
2. **skill 自带声明**：每个 SKILL.md 末尾固定四句（非官方无隶属 / 不碰付费充电内容 / 不批量抓取 / 用户自备素材自担其责）——与 `DISCLAIMER.md` 同源措辞，不新造法律术语。
3. **许可**：skill 是仓库资产，随仓库许可分发；蒸馏自 note-craft 的内容在 SKILL.md 注明「方法论版本 v2.1.0，来源 docs/skills/note-craft」。
4. **不上报**：skill 不含任何网络调用，天然满足「不向开发者发送任何数据」。

## 6. 与「能力外露」计划的关系（防重复提案）

`docs/plans/2026-09-17-agent-capability-exposure.md`（待审未执行）解决的是「装了 app 的人，让 agent 调用 app」。本方案解决「没装 app 的人，让 agent 直接用方法论」。**两条通道都消费 `shared/notes/*` 投影**——若外露计划将来落地，note-craft §14 的单一事实源纪律同样适用于 skills/（改 schema 要意识到两个消费面）。本方案不预设外露计划的生死，互不阻塞。

## 7. 实施分批（若批准）

| 批 | 内容 | 验收 |
| --- | --- | --- |
| 批 1 | spec §9 增补「Skill 分发通道」条目；`skills/` 目录 + `skills/README.md`（是什么/怎么装/三个 DIY 示例） | neat-freak 式核对：spec/README/AGENTS 与文件事实一致 |
| 批 2 | `flash-lecture-notes` 全套（SKILL.md + CONFIG.md + 4 references），从 note-craft 蒸馏 | 用一个真实脱敏转写稿样例跑通：产出符合 schema；自检清单能抓住人造缺陷（故意植入一条错引用/越界时间戳，agent 能标出） |
| 批 3 | `flash-lecture-qa` | 同一样例：问一个笔记里有的（带引证答出）+ 一个没有的（明说没有，不编） |
| 批 4 | 主 README 增「不想下载 app？用 skill 配合你的 agent」一节（安装路径：Claude Code `~/.claude/skills` / ZCode skills 目录 / 零安装=直接贴 SKILL.md） | README 与 skills/README 不出现两个现役答案 |
| 批 5 | 轻量一致性测试（`tests/skills-dist.test.ts`：断言 `skills/*/SKILL.md` 存在、frontmatter 可解析、name 与目录名一致、SKILL.md 行数 ≤ 150） | 四门禁全绿，测试数只增不减 |

## 8. 风险与如实边界

- **质量取决于宿主 agent**：没有代码核验兜底，弱模型可能出自检不过的稿。缓解：自检清单写成可机械执行的问句；返修只一次。
- **双通道方法论漂移**：note-craft 将随产品继续演进，skills/ 有变旧风险。缓解：SKILL.md 注明方法论版本；note-craft §14 会师点补一行「改投影/契约时顺带核对 skills/」。
- **「整个工作流」的预期管理**：skill 版是从「转写稿」开始的工作流，不是从「课程链接」开始。想从链接开始的用户仍需要 app（或自己解决抓取）。README 会把这句话放在显眼处，避免用户误会后失望。

## 9. 决策项（请 Andiii 裁）

| # | 决策 | 选项 | 推荐 |
| --- | --- | --- | --- |
| D1 | 做不做（本想法整体生死） | A. 批准按批实施 / B. 毙掉，仅留档 | ——（等你裁） |
| D2 | skill 数量 | A. 2 个（notes + qa）/ B. 3 个（再加 video-source 抓取辅助）/ C. 只做 notes | **A**。B 撞合规红线（凭据/风控/批量三条），C 损失追问这块完整体验 |
| D3 | 是否进 spec §9 声明登记 | A. 进（声明层纪律要求）/ B. 不进 | **A** |
| D4 | 放置与分发 | A. 顶层 `skills/` + README 一节 + 随仓库分发 / B. 只放 docs 下不进门面 | **A**——不进门面就没有「给不方便下载的同学」这个效果 |
| D5 | 命名 | A. `flash-lecture-notes` / `flash-lecture-qa` / B. 其他（等你定） | **A**（防撞且带品牌） |
