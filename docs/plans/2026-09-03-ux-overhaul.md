# SEU Summary UX 深审与整改方案 v2（完整版，待审批）

> 2026-09-03 深夜第三版。前两版诊断过于表层，本版基于**全量代码深审**（渲染层 13 组件、任务管线 queue/serial-queue/orchestrator、媒体层 download/ffmpeg/audio-split、33 个 IPC 通道、849 行 style.css、DB schema）+ **三条用户旅程模拟**（首次使用 / 异常路径 / 回访用户）。
> 状态：**计划，未获批准不动代码**。已落地的前置工作：可用性整改 10 提交（四门禁 301/301 + smoke 19/19）、v0.2.2 已装机。

---

## 一、深审发现清单（按严重度分级，全部带代码证据）

### A 类：功能性行为缺陷（用户感知「功能是坏的」）

**A1 任务取消不可靠 —— 三层问题（比上轮诊断更深，上轮部分不准确）**

| 层 | 证据 | 现象 |
|---|---|---|
| ① 语义吞没 | `orchestrator.ts:249-251`：makeDownload 的 catch 把 AbortError 转成 `下载视频失败: process failed...` | 下载中点取消，ffmpeg 确实被杀（execFile 接了 signal），但任务显示为**普通失败**而非「已取消」，进度事件 kind 丢失——用户看到的是一个莫名错误 |
| ② 三阶段无信号 | `ffmpeg.ts:98` extractAudio、`ffmpeg.ts:128` extractKeyframes、`audio-split.ts:38` cutChunk 的签名**均无 signal 参数**，orchestrator 调用处也不传 | 音频提取（分钟级）、关键帧提取、ASR 分片切割期间点取消**完全无效**，要等本阶段自然跑完 |
| ③ 循环不检查 | `orchestrator.ts:96`：ASR 分片循环仅在重试间隙检查 signal，成功路径不检查；`download.ts:47` downloadToFile（PPT）无 signal | 长循环阶段取消响应以「片」为单位（120s+），PPT 下载不可停 |

用户结论「必须跑一遍才可以」= ①+②+③ 的叠加，**完全成立**。

**A2 历史记录不可读**：`ipc.ts:467-471` tasks:list 只 SELECT `lesson_id`——用户看到 `1691584-L0`；lessons.title / courses.name 就在库里，没 JOIN。

**A3 历史不可删**：无 tasks:delete 通道，UI 无删除入口，50 条封顶滚动。

**A4 「我的课程/同课推荐」发现性为零**：星标是卡片右上小图标、无引导；同课依赖 subjCode 数据（登录+刷新后才有）。功能存在但对用户**等于不存在**。

**A5 已提取课程无聚合**：courseTree 只按 fetched_at DESC 排序；notes/tasks 表知道用户处理过什么，界面不用。

### B 类：体验断层（旅程断裂点）

- **B1 主窗口跳走无过渡**：抓课时/登录让整个窗口导航去平台页，事前只有一个 3.5 秒 toast——用户以为应用崩了（尤其抓课时：点一个小按钮，整个应用消失变成学校网站）。
- **B2 首次引导断链**：WelcomeGuide 三步（登录→配 Provider→选课），只有第一步有按钮；第 2/3 步无承接，登录成功后引导直接消失。
- **B3 任务完成无去向**：succeeded 后只有一条 toast，不跳笔记页签，用户不知道成果在哪。
- **B4 等待无形状**：810MB 下载只有百分比——无已下载/总大小、无速度、无预计剩余。`recordStage` 其实知道字节数但不上报。
- **B5 关窗语义不明**：关 X 后任务在主进程继续跑，重开会恢复视图——但关窗时**没有任何告知**，用户以为杀了任务。
- **B6 错误文案开发者视角**：`ERR_CONNECTION_CLOSED (-100) loading 'https://...'` 直接上屏。
- **B7 会话过期重试绕**：过期 → toast 提示重登 → 登录成功 → 用户要**自己回历史列表找任务**点重试。
- **B8 Provider 表单门槛**：手填 baseUrl/model，无常见预设（OpenAI/DeepSeek/MiMo/硅基流动）、无「测试连接」。
- **B9 原生 window.confirm**（ProviderPanel.tsx:64）删除确认，与整体 UI 割裂。

### C 类：视觉与工程

- **C1** 849 行手写自创 CSS，组件状态（hover/focus/disabled/loading）各处手感不一——「丑/AI 味」的工程根源。
- **C2** 长列表无虚拟化：2000 门课全量真实 DOM，越用越卡。
- **C3** 搜索无防抖（636 门课每键全量过滤）。
- **C4** toast 单通道承载一切反馈，错误 6.5s 后消失无处回看。
- **C5** 页签 ARIA 不完整、空态两套样式（遗留 12 条未清）。

---

## 二、设计原则（用户视角，所有 Track 遵守）

1. **「我的学习」是主语，全校目录是字典**——界面按「你最近在做什么」组织，不按「数据库有什么」罗列。
2. **每个等待都有形状**——进度 = 大小 + 速度 + 阶段；跳转 = 事前预告 + 回来确认。
3. **取消是承诺**——点了 2 秒内停，且如实显示「已取消」（不是伪装的失败）。
4. **错误说人话**——场景 + 下一步动作；技术原文进 tooltip 和日志。
5. **历史是资产**——读得出课名、看得到失败原因、删得掉、清得空。

---

## 三、Track 1 —— 信息架构：「我的学习」（解 A4/A5/B2/B3）

### 1.1 数据层（无新迁移，一条聚合查询）
`ipc.ts` courseTree 改为 JOIN 聚合，每课程附带：
```
noteCount（notes 表）、taskCount、lastTaskAt、lastTaskState、hasExtracted = noteCount>0
```
渲染层 `bridge.ts` CourseTreeInfo 扩展同名字段。

### 1.2 侧栏重构（`Sidebar` 新组件，替换 app.tsx 内联结构）
```
┌ 搜索框（防抖 300ms，C3 一并修）
├ ★ 我的学习（常驻，默认展开）
│   ├ 已提取（noteCount>0，按 lastTaskAt 倒序，徽标显示笔记数）
│   ├ 我的课程（星标；空态文案：「点任意课程卡的 ☆ 标记你的课，同课程其他老师的班次会排到这里」）
│   └ 同课推荐（折叠，仅当钉选课程有同 subjCode 班次；空则整组隐藏）
├ ▸ 全部课程（636）（默认折叠，原生分组头）
│   └ 现有 CourseTree（虚拟滚动，C2 一并修）
└ 手动添加（后备，收纳进「⋯」菜单降级存在感）
```
- 选中「已提取」里的课程 → 展开直接定位到笔记。
- **B2 修复**：WelcomeGuide 改为带完成态的三步 checklist（登录✓ → Provider 状态实时显示 → 首个笔记生成后整卡消失）；登录成功自动展开「我的学习」。
- **B3 修复**：任务 succeeded → toast 带动作「查看笔记」按钮（toast 支持 action）。

### 1.3 课表探测（2026-09-04 结论：取消）
用户实测：平台线上的「我的课表」与真实上课安排**有出入**，从登录信息拉课表不可行。星标语义随之定为「**我的收藏**」（纯手动收藏），同课推荐基于收藏课程。本节探测工作不再执行。

## 四、Track 2 —— 任务系统：可停、可读、可管（解 A1/A2/A3/B4/B5/B6/B7）

### 2.1 取消链路三层修复（A1）
1. **AbortError 语义归位**：orchestrator 各阶段 catch 首先判 `signal?.aborted` / `err.name==='AbortError'` → 返回 `{status:'failed', kind:'cancelled', error:'任务已取消'}`；queue.ts cancelTask 兜底不变。测试钉住：取消后 DB error_kind='cancelled' 且进度事件 kind='cancelled'。
2. **ffmpeg 全阶段接信号**：extractAudio / extractKeyframes / cutChunk 增加 `signal?: AbortSignal` 参数并传给 run()（run 已支持）；orchestrator 三处调用传 `ctx.signal`。
3. **循环检查**：ASR 分片 for 循环每片开头 `if (signal?.aborted) return cancelled`；downloadToFile 增加 signal（fetch 传 + 循环间检查），PPT 下载传入。

**验收**：任意阶段点取消 ≤2s 生效，状态显示「已取消」，重试从取消阶段恢复（现有 firstStageFor 语义保留）。

### 2.2 历史记录重做（A2/A3）
- tasks:list SQL JOIN：`tasks t JOIN lessons l ON t.lesson_id=l.id JOIN courses c ON l.course_id=c.id`，返回 `courseName / lessonTitle`；ID 退 tooltip。
- 新通道 `tasks:delete`（单条，连带 task_stage_outputs + 缓存目录）与 `tasks:clearFinished`（清终态）；`bridge.ts` + preload 同步；UI：行内删除（悬停显示）+ 顶部「清空已完成/失败」。
- 状态筛选 chips：运行中 / 已完成 / 失败 / 已取消。
- **B6 错误人话映射表**（`shared/errors.ts` 纯函数 + 测试）：ERR_CONNECTION_* →「网络连接被中断——请检查校园网或代理规则」；401 →「登录已过期」；超时 →「网络过慢或服务不可用」……原文保留在 title/日志。

### 2.3 运行中反馈增强（B4/B5/B7）
- TaskProgressInfo 扩展 `detail?: string`（下载阶段：「已下载 412MB / 810MB · 2.1MB/s」——downloadToFile/ffmpeg stallGuard 轮询里已有尺寸信息，上报即可）。
- **B5**：关窗时若有运行任务 → 自定义确认对话框（Track 3 组件）：「任务将在后台继续，下次打开自动恢复视图 / 立即取消任务」。
- **B7**：会话过期 → 登录成功后 toast：「会话已恢复，N 个失败任务可重试」带跳转动作。

## 五、Track 3 —— 组件体系与视觉（解 C1-C5/B8/B9）

**方案：Tailwind CSS v4 + shadcn/ui 风格自持组件**（组件代码进仓库、无运行时依赖、CSP 不受影响、双主题走 CSS 变量→Tailwind 语义色映射）。

- 3.1 基建：`@tailwindcss/vite` 接入 electron-vite（renderer 侧），现有 CSS 变量平移为 Tailwind 主题令牌；新旧共存按批切换。
- 3.2 组件集（`src/renderer/ui/`）：Button / Card / Badge / Tabs / Toast(带 action) / Dialog(替代 window.confirm) / DropdownMenu / Tooltip / ScrollArea / EmptyState / Skeleton / VirtualList。
- 3.3 四批替换（每批四门禁+截图给你看）：
  - **批 A** 侧栏（与 Track 1 同步：我的学习 + 课程树 + 虚拟滚动）
  - **批 B** 任务中心（与 Track 2 同步：运行卡 + 历史 + 筛选）
  - **批 C** 笔记四视图 + 追问
  - **批 D** 设置 + Provider（预设模板下拉 + 测试连接按钮 + Dialog 确认）
- 3.4 组件测试从 class 断言迁到语义断言（role/aria/testid）。

## 六、分期交付（每期结束都可装可用）

| 期 | 内容 | 提交量 | 里程碑验收 |
|---|---|---|---|
| **M1 行为修正** | Track 2 全部 + Track 1 数据层（courseTree 聚合） | 8-10 提交，+30 测试 | 任意阶段 2s 取消且如实显示；历史有课名可删可清；错误说人话 |
| **M2 我的学习 + 新组件 A/B** | Track 1 UI + Tailwind 基建 + 批 A/B | 6-8 提交 | 打开即见「我的学习」三组；侧栏/任务中心新观感截图确认 |
| **M3 收尾** | 批 C/D + 防抖/虚拟化/ARIA/确认框 + 课表探测结果落地 | 6-8 提交 | 全量截图验收 → **v0.3.0** 发布 |

## 七、风险与对策

- Tailwind v4 × electron-vite 4：官方 vite 插件路径，风险低；**兜底**：若构建冲突则退回手写 CSS 深打磨方案（Track 2/1 完全不受影响——这也是先做 M1 的原因）。
- AbortError 语义修复涉及 20+ 既有任务测试：逐个核对，测试数只增不减。
- 虚拟滚动 × 搜索/展开联动：VirtualList 自持实现，先覆盖「全部课程」组（我的学习组条目少不虚拟化）。
- 主窗口跳走（B1）受架构限制（第二渲染器故障）：能做的是预告强化 + 回来确认 + 抓课时按钮文案明确「将打开学校播放页」；根治需等你机器环境修复后再评估独立窗口。

## 八、决策点（请逐条拍板）

- **D1 组件方案**：Tailwind v4 + shadcn 风格自持（推荐）／继续手写 CSS／preact-compat + React 库（不推荐：兼容层+体积+CSP 三重风险）。
- **D2 「我的学习」位置**：侧栏常驻聚合区（推荐）／独立主区页签。
- **D3 取消深度**：全阶段 2s 即时中断（推荐，M1 一次做完）。
- **D4 历史删除**：物理删除+缓存清理（推荐）／仅隐藏。
- **D5 分期节奏**：M1→M2→M3 每期给你装一版（推荐）／一口气做完再验收。

## 九、仍需你配合

1. **登录一次**已装 v0.2.2（写入课程元数据，也是 M2「同课推荐」的数据前提）；
2. **课表接口探测**约 10 分钟（M3 前任意时间）；
3. M2/M3 各一次**截图验收**（我装好新版后截图给你确认观感）。
