# Obsidian 结构化导出（Structured Obsidian Export）

- 日期：2026-09-08 · 状态：**已批准，批1-2 已执行（批1=128cd34、批2=3878b07，769/769+smoke 28/28）；批3 真实库样张已过（三课导出/聚合页/索引/SR 卡全验），装机验收（Obsidian+SR 插件实测）待 Andiii**（决策点全按推荐：D1=A / D2=A / D3=B / D4=A）——执行中
- 触发：Andiii 反馈——上一版方案太重、与初衷背道而驰；只想提升笔记体验，唯一想加的功能是**导出至 Obsidian，变成结构化笔记，方便被其他 agent 调用**。
- 前置：装机整改第二轮已落地（720/720，0.7.1）；上一版「复习驾驶舱」方案已归档为调研存档（`2026-09-08-notes-experience-overhaul.md`），本方案是其反题：**app 不加任何新页面/新机制，只加一条导出通道**。

---

## 一、为什么这个方向对

1. **轻**：零新依赖、零新页面、零新学习成本——全部落在既有「导出」轴线上（工具栏 MD/PDF/Anki/SVG 旁再加一个按钮）。
2. **复习闭环免费获得**：Obsidian Spaced Repetition 插件（MIT，2.6k★，FSRS + SM-2 双算法）直接吃 `#flashcards` 卡片——上一版方案里最重的 FSRS 基建，在 vault 里零代码成立。
3. **跨课时概念关联免费获得**：课时笔记里写 `[[傅里叶变换]]`，同名概念在全部课时自动互链、反向链接面板自动聚合——Obsidian 的 wikilink 解析机制天然是「概念稳定 ID」。
4. **agent 友好是天生属性**：markdown 正文 + YAML frontmatter（机器可读元数据）+ wikilink 图 + 稳定文件结构，正是 agent 消费笔记的最佳格式；obsidian-steward 等 agent skill 生态可直接操作 vault。
5. **产品定位随之收窄变清晰**：Flash Summary = 「视频 → 结构化笔记生成器」做到极致，笔记的归宿交给用户自己的系统。数据所有权闭环：导出后是用户的纯文本，app.db 不再是唯一归宿——与本地优先哲学同向。

## 二、目标产物（先看样张）

### vault 目录结构（用户选 vault 根目录，全部文件收在可辨识的子目录里，可整体删除）

```
<Vault>/Flash Summary/
├── _index.md                          # 导航 MOC：全部课程/课时 + 结构说明（agent 可读的 schema 文档）
├── <课程名>/
│   ├── _概念.md                       # 课程概念聚合页：term → 出现在哪些课时 + 各课时定义
│   ├── <课时名>.md                    # 课时结构化笔记（自足，单文件读完整节课）
│   └── attachments/<lesson_id>-<原文件名>.jpg   # 关键帧图片
```

### 课时文件形态（投影规则，`overview/methodology` 仍是仅有的 markdown 字段，其余同现有投影纪律）

```markdown
---
source: flash-summary
course: 信号与系统
lesson: 第3讲 傅里叶级数
lesson_id: "1690625-L0"
origin: seu                  # 或 bilibili（另加 bvid）
version: 3
created: 2026-09-08
---

## 概览
（overview markdown 原样）

## 知识结构
- 傅里叶级数（概念：[[傅里叶变换]]、[[频谱]]）
  - ...（树 → 嵌套列表，terms 转 wikilink）

## 时间线
- **07:35 · 周期信号的分解**：detail……
  - > 引文（07:36）
  - ![[1690625-L0-kf-0007.jpg]]（绑定证据时嵌入）

## 概念
- **[[傅里叶级数]]**：把周期函数表示为……
- **[[频谱]]**：……

## 公式、代码与操作步骤
（同现有 markdown 投影，code 用围栏块）

## 考试与作业提示 / 疑问与缺口
（列表）

## 自测 #flashcards/信号与系统/第3讲
[[傅里叶级数]]::把周期函数表示为……            ← 概念卡（单行 ::）
满足什么条件的信号可以展开为傅里叶级数？        ← quiz 卡（多行，问/ ? /答）
?
狄利克雷条件：绝对可积、有限极值、有限间断点……

## 方法论
（methodology markdown 原样）
```

卡片语法与 SR 插件 README 逐条对齐（已核实）：单行 `Q::A`、多行 `Q` / `?` / `A`、行内 `#flashcards/<课程>/<课时>` 嵌套标签定牌组；frontmatter tags 不被插件识别，故 flashcards 标签必须行内。

### `_概念.md` 聚合页（课程级，导整门课时生成）

按 term 归一（trim）聚合：「傅里叶变换 → 出现于第2/3/5讲」，每条列出各课时定义原文 + `[[课时]]` 链接——「这门课反复出现的概念」的最省承接，且由 Obsidian 反链面板天然补全。

## 三、批次设计（两批开发 + 一批验收，每批独立提交）

### 批1 单课时导出核心——`feat(obsidian-export)`

- **投影纯函数** `src/shared/notes/obsidian.ts`：`projectObsidianNote(note, meta)` → `{ markdown, attachments: [{src, name}] }`。frontmatter + 六段投影 + 概念/树 terms 转 `[[wikilink]]` + SR 卡两形态 + 时间线证据图片嵌入引用。文件/文件夹名 sanitize 复用 `noteExportBaseName` 先例（Windows 非法字符）。
- **IPC `notes:exportObsidian`**（照 exportAnki/exportSvg 先例）：设置项 `obsidianVaultPath`（未设置时先弹目录选择，复用 chooseLibrary 对话框模式）→ 写课时文件 + 复制 attachments → manifest 对账 → toast「已导出·打开所在文件夹」（revealFile 白名单扩展）。
- **migration 013**：`obsidian_exports(lesson_id PRIMARY KEY, vault_path, exported_version, exported_at)` ——幂等重导出：同 lesson_id 覆写同路径；标题变更 → 写新路径并删旧文件；重导出（生成/润色/纠错后）自动更新 `_概念.md`/`_index.md` 派生页（导出动作里顺手重建该课程的派生页，无独立状态）。
- 工具栏「导出 Obsidian」按钮；`SEU_OBSIDIAN_PATH` 测试缝（照 SEU_PDF_PATH/SEU_ANKI_PATH 先例）。
- 测试：投影纯函数单测（frontmatter 字段/wikilink 转换/卡语法/图片清单/树列表化/空 section 省略）+ FakeIpc 守卫 + smoke 桥面登记 + note-craft SKILL.md §0 增补 obsidian 投影契约。

### 批2 课程级导出 + 聚合页 + MOC——`feat(obsidian-course)`

- IPC `notes:exportCourseObsidian`：循环该课程全部课时最新版逐个导出 + 生成 `_概念.md` + 维护 `_index.md`（增量追加/更新本课程条目）。
- 入口：笔记库课程组行 + 笔记工具栏不动之外的课程树课程行（见 D3）。
- `_index.md` 内含结构说明（in-band 文档：目录约定/frontmatter 字段表/卡片约定——给 agent 也是给人的 readme）。
- 测试：概念聚合纯函数（同 term 跨课时归并/空白归一/单课时退化）+ IPC + 真实库整课导出验证。

### 批3 装机验收（轻收尾）——`docs(acceptance)`

- Andiii 装 Obsidian + SR 插件 → 导入真实课 → 复习一轮验证卡可解析、牌组层级正确、wikilink 反链可用；ui-shots 截图；CHANGELOG/PROGRESS 收尾。

## 四、决策点

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| D1 | 概念形态 | A=课时内联+课程级 `_概念.md` 聚合页；B=每概念独立原子文件（Zettelkasten 全量，文件多一个数量级）；C=纯内联不生成聚合页（最轻，聚合全靠 Obsidian 反链面板） | **A**——课时文件自足（读一文件=复习一节课）+ 聚合页直接回答「这门课反复出现的概念」；B 文件爆炸与「轻」诉求相反 |
| D2 | 卡片位置 | A=内联课时文件末尾（`## 自测` 节，RemNote「卡片不破笔记流」哲学）；B=独立 `<课时>-卡片.md` | **A**——自足、少一半文件；B 只在用户嫌复习时翻到笔记嫌吵时有价值，先不做 |
| D3 | 课程级入口 | A=笔记库课程组 + 课程树课程行都放；B=仅笔记库课程组 | **B**——课程树保持干净（双源徽标等已密），笔记库本来就是笔记域的组织面 |
| D4 | 关键帧图片 | A=复制进 vault `attachments/` 并在时间线嵌入；B=不带走图片（纯文本导出） | **A**——时间线的图文互证是笔记质量的一半，且 vault 自足可移植；图片本来就 ≤20 张/课，体积可控 |

## 五、门禁与验收

- 每批四门禁全绿，测试数只增不减；新通道 FakeIpc 单测 + smoke 桥面登记；投影改动遵守 note-craft §7 纪律。
- 批1/批2：`SEU_OBSIDIAN_PATH` 自动化导出断言文件结构/frontmatter/卡语法 + 真实库导出（ui-shots 探针留档）。
- 批3：Andiii Obsidian + SR 插件实测一轮（唯一人工验收项）。

## 六、明确不做

- app 内复习/统计/冲刺（上一版方案已否，不复活）。
- vault → app 回流（导出是单向移交，用户在 Obsidian 的修改不回写）。
- Obsidian URI 跳转、模板自定义、全库一键导出、frontmatter 配置化。
- 现有 Markdown/Anki/SVG/PDF 导出全部保留不动（受众不同：剪贴板/Anki 直接用户/纸面讲义）。

## 七、风险与对策

- **SR 卡语法实测差异**：语法以 README 为准已核实，但真实插件解析是唯一权威——批3 是验收门；若多行 `?` 形态有兼容问题，单行 `::` 是保底（投影纯函数里一处切换）。
- **用户手改导出文件被重导出覆写**：`_index.md` 结构说明里明示「导出文件建议以引用/链接方式加工，直接改写会在下次导出被覆盖」；frontmatter 加 `flash-summary-managed: true` 标记。轻处理，不做合并逻辑。
- **同名课时冲突**：manifest 按 lesson_id 对账，仅文件名冲突时追加 lesson_id 后缀。
- **@无新依赖**：本方案零 npm 依赖，全部为自有代码 + better-sqlite3 迁移。
