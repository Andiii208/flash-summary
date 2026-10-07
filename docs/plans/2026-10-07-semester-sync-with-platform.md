# 课程学期与平台同步（按学期刷新课程）

> 2026-10-07 · Andiii 试用报障：「选择的学期不是网站上的所有学期选项，比如无法选择 2026-2027 第二学期的课程，无法总结第二学期的课程」
> 状态：**已执行完毕**（2026-10-07，Andiii「都按你推荐的去做」→ D1-D7 全取推荐侧；提交 `daf6eb1` 批1 / `0510d58` 批2 / `d8d7664` 批3 + 批4 记账；门禁 lint 0 / typecheck 0 / test 1632·145 / smoke 41/41；未 bump 版本；台账见 PROGRESS.md 首条）。README 配图已按防腐烂纪律整批重跑（13 资产，含管线四坑修复，详见 PROGRESS.md 首条）。

---

## 1. 现象与根因

**现象**：应用的学期筛选（课程浏览页「按学期筛选」、侧栏搜索）只能看到本地已收录课程出现过的学期；2026-2027 第二学期在网站上明明可选，应用里既选不到、也拉不到该学期的课，因此无法总结。

**根因（两层，缺一不可）**：

1. **刷新不带学期参数**：`刷新课程` 只请求 `GET /v1/group_subject_vod_list/t-1?page.pageIndex=N&page.pageSize=500`（`client.ts:courseListPath`）。该接口**默认只返回当前学期**（2026-10-07 实测当前学期 = 2026-2027-1）的课程，其它学期的记录根本不会进本地库。
2. **学期选项是本地汇总，不是平台目录**：`CourseBrowser.tsx` 的学期 select 由本地 `courses.term` 去重生成（`CourseBrowser.tsx:115-118`）——拉不到的学期自然不会出现在选项里。平台上有权威的学期目录接口（`/v1/list/termYear`，网站学期下拉的数据源），应用从未调用。

**次生问题**：`parseCourseList` 的 `term` 只取 `acyeBeginYear/acyeEndYear` 拼出 `2026-2027`（`api-parse.ts:264-270`），**丢掉学期号**；t-1 记录里明明有 `acteName`（"1"/"2"/"3"）。就算两个学期的课都拉下来了，学期筛选器也会把它们合并成同一个「2026-2027」选项。

## 2. 平台事实（活体取证，2026-10-07 21:2x，校园网直连 + 应用会话）

取证方式：以应用自身存储的会话（`%APPDATA%\seu-summary\school-session\session.bin`，DPAPI）直打平台 API，**只读**，未改动任何数据；探针进程与数据均未落仓库。

| 证据 | 结果 |
|---|---|
| `GET /v1/list/termYear` | **200，8 个学期**：`{id, acyeCode, acteTerm(1/2/3), currentTerm, acteBeginDate, acteEndDate}`，如 `{"id":37,"acyeCode":"2026-2027","acteTerm":2,"currentTerm":false}`、`{"id":36,...,"acteTerm":1,"currentTerm":true}`。**2026-2027 第二学期在网站上可选 = 这些记录之一** |
| `t-1?page.pageIndex=1&page.pageSize=500&acteId=37` | **200，pageCount=6，500 条记录全部是 2026-2027 第二学期**，真实课程已在平台（如「光谱学与智能光谱分析系统」「大学物理(B)Ⅱ」，讲次起始 2026-09-20/21）。**学期过滤参数名实锤为 `acteId`** |
| `t-1…&acteId=36` / `&acteId=34` | 200，pageCount=3 / 9，分别只含 2026-2027-1 / 2025-2026-2。按学期拉取可行且量级可控（每学期页数 = 3~9 页 ×500） |
| `t-1…&termId=37`（错误参数名） | 200 但被**静默忽略**，仍返回当前学期 36 → 参数名写错不会报错、只会静默给错数据，测试必须钉住参数名 |
| t-1 记录字段 | 含 `acteId`、`acteName`("1"/"2")、`acyeBeginYear`、`acyeEndYear`、`subjName`、`teacNames[]`、`teclId`、`teclCode`、`clroName`、`courTimes` —— 现有 parser 需要的字段全都有，**只是没拉该学期的数据** |
| `/v1/myself/curriculum?acteId=N` | 也可按学期过滤（每行=一次讲次，655 页），但现有链路 t-1 已满足且已实测 → **不动** |

结论：**不需要新接口，是「已有接口没用全」**——termYear 提供学期全集，t-1 加一个 `acteId` 参数即可按学期拉课。

## 3. 方案总览

四个批次，全部在现有架构内（main/preload/renderer 三进程 + 纯函数 parser），零新依赖：

```
学期目录（平台权威）          按学期刷新（平台数据）
/v1/list/termYear   ──►  学期 select（刷新区）
                              │ 选中 acteId
                              ▼
                     t-1?page.pageIndex=N&page.pageSize=500&acteId=<id>
                              │ upsert（courses.term = "2026-2027-2"）
                              ▼
                 CourseBrowser 学期筛选 / 侧栏 / 卡片副行（统一标签渲染）
```

### 批 1 — main 侧契约（学期目录 + 按学期拉课）

** `src/main/school/api-parse.ts` **
- 新增纯函数 `parseTermList(payload): TermOption[]`，字段：
  ```ts
  export interface TermOption {
    id: number            // acteId，刷新时回传给 t-1
    academicYear: string  // acyeCode，如 "2026-2027"
    term: 1 | 2 | 3       // acteTerm（3 = 小学期/暑期，平台语义如此）
    currentTerm: boolean
    /** 展示标签，如 "2026-2027 第二学期" */
    label: string
  }
  ```
  容错与既有 parser 一致（信封 `{code,data|result,...}`、裸数组、数字型 id 字符串化）。
- `parseCourseList` 的 `term` 改为 `学年-学期号` 规范格式：优先 `acyeBeginYear-acyeEndYear-${acteName}`；无 `acteName` 时回退现状 `YYYY-YYYY`（**存量数据的 term 值保持兼容，不清库不迁移**——旧值本来就只有这一种形态，且刷新后自然被新值覆盖）。
- 新增共享纯函数 `termLabel(term: string): string`（放 `shared/course-display.ts`）：`2026-2027-2` → `2026-2027 第二学期`，`2026-2027`（存量/未知）→ 原样。**同一角色只允许这一处定义**（UI 约定纪律）。

** `src/main/school/client.ts` **
- `listTerms(): Promise<TermOption[]>` → GET `/v1/list/termYear`，复用现有 request/超时/401 分类（学期目录失败**不阻塞**刷新按钮）。
- `listCoursesPaged(options)` 增加 `acteId?: number`，拼进 `courseListPath`（**参数名 `acteId` 由测试钉住**——写错是静默给错数据，见 §2）。

### 批 2 — IPC / 桥面 / 设置

- `ipc.ts` `school:listCourses` handler 接可选 `acteId: unknown`（安全断言：正整数，非数字忽略=当前学期，**不抛错**——学期下拉历史上没有过这个参数）。
- 新 IPC `school:listTerms`（无参）。
- `shared/bridge.ts` + `preload/index.ts`：`listCourses(acteId?: number)`、`listTerms()`。**IPC 契约变更 → 除四门禁外必跑 `npm run smoke`**（AGENTS.md 钉死的纪律）。
- 设置项 `courseRefreshTermId`（settings/store.ts）：记住用户上次刷新的学期，**缺省 = 平台的 currentTerm**（登录后首次由 termYear 回填；未登录/取不到时为空={当前学期}）。
- 页预算（见 D4）：刷新指定学期时 `maxPages = min(platformPages, HARD_CAP)`（`HARD_CAP = 20`，=1 万门，远超实测 3~9 页；`courseListMaxPages` 用户设置仍可覆盖上限语义不变——设置值 = 硬上限）。

### 批 3 — renderer 学期选择

- 侧栏头部「刷新课程」行内新增学期 select（`App.tsx:463-480` 区块）：
  - 选项 = `school:listTerms`（登录态变化时取一次；失败/未登录 → 单项「当前学期」+ 按钮保持可用）。
  - 默认选中 `courseRefreshTermId`，否则平台 currentTerm，否则第一项。
  - 选中即持久化；**刷新按钮点击 = 刷新选中学期**（不改按钮语义，不新增第二种 busy 形态：沿用「刷新中…」+ disabled + 页数进度事件）。
  - login 后的自动刷新（`App.tsx:1382`）沿用当前默认行为（currentTerm）——**不改变登录后首刷体验**。
- meta 行/toast 口径补学期名（`App.tsx:77-83`、`App.tsx:1252`）：`本地已收录 N 门 · 本次刷新 X 门（2026-2027 第二学期） · 平台列表约 Y 门`。沿用「别静默截断」纪律：该学期 0 门时如实说明并提示换学期。
- `CourseBrowser.tsx` 学期 select 与卡片副行：选项值仍取本地 `term` 去重，展示经 `termLabel()`；新数据带学期号后同一学年两个学期自然分开。
- 样式：沿用现有 .btn/.select 基元与刻度 token，不新增token、不新增断点（UI 约定纪律；**不加新视图不新增 README 截图位**，readme-shots 不需要重跑）。

### 批 4 — 测试 + 文档 + 门禁

- **单测**（只增不减）：
  - `parseTermList`：活体样本脱敏 fixture（8 学期结构、currentTerm 标记、id 数字/字符串容错）。
  - `parseCourseList` term 新格式：`acteName:"2"` → `2026-2027-2`；缺 `acteName` → 回退 `2026-2027`。
  - `listCoursesPaged` 拼 URL 断言：默认不含 acteId；`acteId=37` 时 URL 含 `&acteId=37`（**钉住参数名**）；超时/401 分类不回归。
  - IPC：`school:listCourses` 传合法/非法 acteId 的行为。
- **smoke**（契约形状）：`listCourses`/`listTerms` 签名与返回信封。
- **文档**：PROGRESS.md 记一行（含活体取证表）；README 不需要新截图；AGENTS.md 不动（无新红线/约定）；spec 不动（不涉及披露层与产品边界——这是「刷新口径与网站对齐」，非新承诺；若评审认为需要在 spec 记一笔再补）。
- 门禁：`npm run lint && npm run typecheck && npm test && npm run smoke` 全绿后提交（Conventional Commits，分 4 个提交）。

## 4. 决策项（请裁）

| # | 决策 | 选项 | 推荐 |
|---|---|---|---|
| D1 | 学期选项来源 | A. 平台 `/v1/list/termYear` 权威（推荐） B. 本地已收录汇总（现状） | **A**——网站有什么就能选什么，不依赖本地拉到过 |
| D2 | 交互形态 | A. 刷新按钮旁加学期 select，选中即刷新该学期（推荐） B. 新菜单项「按学期刷新」 C. 自动循环刷新全部学期 | **A**——最小改动、和网站「先选学期再看课」心智一致；C 的进度语义复杂且浪费请求 |
| D3 | term 存储格式 | A. 规范 `YYYY-YYYY-N`（兼容存量，推荐） B. 保持 `YYYY-YYYY` 丢学期号 | **A**——不修的话两个学期的课在筛选器里仍合并 |
| D4 | 单学期页预算 | A. 该学期全量拉完 + 硬顶 20 页（推荐） B. 维持默认 4 页 | **A**——实测最大 9 页；B 会静默少拉 |
| D5 | 「全部学期」一键刷新 | A. 不做（记候选） B. 做 | **A**——8 学期 × 最多 9 页请求，进度诚实性与取消语义成本高；真有需要再加 |
| D6 | 是否改用 `/v1/myself/curriculum` | A. 不动，继续 t-1 + acteId（推荐） B. 切 curriculum | **A**——t-1 实测已满足且字段全 |
| D7 | termYear 失败/未登录 | A. 回退「当前学期」单项、刷新按钮仍可用（推荐） B. 禁用刷新直到拿到学期目录 | **A**——不让目录故障升级成不能刷新 |

## 5. 验收标准（给 Andiii 装机走查）

1. 登录后侧栏学期下拉出现平台全部学期，标记当前学期（2026-2027 第一学期）。
2. 选「2026-2027 第二学期」→ 刷新 → 侧栏出现该学期课程（平台现有真实数据，如「大学物理(B)Ⅱ」）；meta 行/toast 写明学期与条数。
3. 课程浏览页「按学期筛选」出现「2026-2027 第二学期」选项且能过滤；cards 副行学期显示为「2026-2027 第二学期」。
4. 重复点刷新、刷新中切学期：连点被 in-flight 守卫挡住（现有形态），无第二种 busy。
5. 四门禁 + smoke 全绿；真机一轮后由 Andiii 确认再 bump 版本（本方案不 bump）。

## 6. 风险与边界

- **平台侧变更**：`acteId`/`termYear` 若改版，parser 有 fixture 钉住 + 失败静默回退当前学期（不白屏、不阻塞）。
- **数据量**：单学期最窄 3 页、最宽实测 9 页；硬顶 20 页防异常膨胀。
- **存量 term 值**：旧行 `2026-2027` 与新行 `2026-2027-2` 会在筛选器并存，属可接受迁移态（刷新过的课自然收敛到新格式）；不做批量 UPDATE 旧行（讲次/笔记不存 term 冗余，没必要）。
- **不做**：不做「我的课程」按用户过滤（平台接口语义未校准，属另一件事）；不动 B 站源；不动笔记/任务链路。

---

*审批通过后按批执行（每批：实现 → 门禁自跑 → 提交），完成后 PROGRESS.md 记账。*
