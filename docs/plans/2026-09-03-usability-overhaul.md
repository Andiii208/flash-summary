# 可用性整改方案 —— v0.2.1 用户实测反馈（待审阅）

> 2026-09-03 晚，Andiii 实测安装版 v0.2.1 反馈「不可用」。本文档给出根因取证与分阶段修改方案。
> 状态：**已批准（「都按照你说的去做」），A/B/C 代码已全部落地**（提交 ed30f1c…，四门禁 301/301 + smoke 19/19）；Phase C 的「课表/我的课程」活体探测需用户登录配合，待安排。

## 一、诊断结论（全部有代码/日志/DB 实锤）

### 症状 1：安装版一打开就提示「已登录」

**根因：开发版与安装版共用同一份 userData。**

- `package.json` 顶层 `name: "seu-summary"`，`productName` 只写在 `build` 配置块内（非顶层字段）。Electron 的 `app.getName()` 读顶层 `productName || name`，因此**安装版的应用名也是 `seu-summary`**，userData = `%APPDATA%\seu-summary`，与 `npx electron .` 完全相同。
- 现场证据：`%APPDATA%` 下只有 `seu-summary` 一个目录（无 `SEU Summary`）；今天 17:53 安装版的活动（Preferences / Session Storage / school-session）全部写入该目录。
- 开发时代今天 11:21 收割的 session.bin 被安装版直接读到，而 `sessionState()`（`src/main/app-context.ts:299`）**只判断 session.bin 是否存在，不校验 JWT 有效期** → 显示「已登录」。

### 症状 2：课程还是开发时的那几门，「剩下的课程抓不下来」

**根因 A（设计缺陷）：课程列表只抓全校列表的第 1 页。**

- `SchoolClient.listCourses()`（`src/main/school/client.ts:86`）只请求 `group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=500`。
- t-1 实为**全校历史课程大列表（648 页 × 500 条/页 ≈ 32 万条）**。资料库现有 636 门课 = 历次抓样累加（5+56+74+1+500，`fetched_at` 分批可查证）。**你自己的课程大概率根本不在前 500 条里——「剩下的课程」从未被抓取过，不是抓取失败。**
- 有课时目录的只有 1691584（8 节）、1690625（4 节）两门 = 开发测试的那两门。

**根因 B（环境故障，当日偶发）：平台被网络层断连。**

- 今日日志 17:52–17:53：`ERR_CONNECTION_CLOSED` / `ERR_CONNECTION_RESET` 连续 10+ 次，抓课时（3 次）与登录全部失败；而 14:56 同机收割成功 → 代理层状态变化所致。
- 已知复发症状：ClashMI **订阅更新会覆盖丢失 `DOMAIN-SUFFIX,seu.edu.cn,DIRECT` 规则**（fake-ip DNS 172.19.x.x 接管即断连）。

### 症状 3：退出后点登录，「没跳到学校平台」

**直接原因**：主窗口导航到 `cvs.seu.edu.cn/jy-application-resourcemanage-ui/` 全部 `ERR_CONNECTION_CLOSED`（症状 2 根因 B 的同一网络故障），平台页从未显示。

**设计缺陷放大了感受（即使网络正常也会踩）**：

1. 登录失败的错误 toast 只在「发起登录的那个 renderer」里弹（`src/renderer/app.tsx:361-383` 的 login 回调），但主窗口导航会**卸载 renderer**，回调已死 → 失败完全静默。
2. 平台页加载期间 / 失败后窗口**零指示**（无 loading 页、无错误页），用户视角 = 白屏没反应。
3. 无会话有效期概念：过期 session 静默当作 logged_in。

## 二、修改方案

### Phase A：可用性止血（P0，无需活体会话，可立即开工）

| # | 改动 | 落点 | 要点 |
|---|---|---|---|
| A1 | **dev/安装版数据隔离** | `src/main/index.ts` | `!app.isPackaged` 时 userData 改为 `<userData>-dev`（`%APPDATA%\seu-summary-dev`）；安装版沿用 `%APPDATA%\seu-summary`。你已退出登录（session.bin 已删），安装版当下即干净态，**无需迁移逻辑** |
| A2 | **会话三态** | `app-context.ts`、`session-store.ts`、TopBar、设置页 | 解析 JWT exp claim → `logged_in / expired / logged_out`；TopBar 徽标区分「已过期」；设置页显示会话保存/过期时间；mount 仍不发网络请求（保持 U1 决策，exp 为本地判定） |
| A3 | **退出登录彻底化** | `app-context.ts` logout | 除 session.bin 外，清 defaultSession cookie 罐（`.seu.edu.cn`）+ sessionStorage，下次登录走真实 OAuth 往返 |
| A4 | **登录失败可见性** | `app-context.ts`、`ipc.ts`、`app.tsx` | main 侧记录一次性 `lastLoginOutcome`（对称于 justLoggedIn），fresh mount 消费 → toast 成功/失败（带错误码与排查提示）；平台页加载失败快速失败并回 UI |
| A5 | **网络健壮性与诊断** | `index.ts`、`net-diagnostics.ts` | ① 启动时 `setProxy({ mode:'system', proxyBypassRules:'*.seu.edu.cn' })`——系统代理场景校园域名强制直连（TUN 场景仍需 Clash 规则，README 已收录）；② 登录/刷新前 preflight：dns.lookup 检测 fake-ip（172.19.x.x）→ toast 明确文案「代理接管了校园域名，请检查 Clash DIRECT 规则」 |

### Phase B：课程列表完整性（P0 短期）

| # | 改动 | 要点 |
|---|---|---|
| B1 | `listCourses` 分页拉取 | `pageIndex=1..N` 循环（默认上限 4 页 = 2000 条，可配），从首页响应的 `pageCount` 得知全校总量；IPC 返回进度 |
| B2 | 刷新进度与数据边界明示 | 「刷新课程」显示 x/y 页；侧栏注明「已加载全校前 N 条 / 共 X 门」；搜索仅覆盖已加载课程（UI 文案说明） |
| B3 | 兜底路径文档化 | ManualAdd（手动课程/课时 ID）已在，README 补「平台页面 URL 取 ID」说明 |

### Phase C：课表接口 + 选课信息对齐官网（P1，需活体探测）

**探测先行**（方法论已有：`--seu-trace-keep-window` + net-trace + F12 协作；需你登录一次配合）：

1. 官网选课/课程视图的 XHR 清单（端点、分页、term 过滤参数）——「跟官网一致」的数据源；
2. 「我的课程/课表」候选端点逐一验证：`group_subject_vod_list` 其他分组（t-2…）、`subject_vod_list/new`、`list/recentWatchRecord`、`resources_tree_me`、门户 unify-portal 课表模块；
3. t-1 记录 `courTimes / clroName / orgaNames / subjCode` 真实格式样本（现解析层直接丢弃，`api-parse.ts:92-114`）。

**落地**（按探测结果裁剪）：

| # | 改动 | 要点 |
|---|---|---|
| C1 | 迁移 007 | courses 加 `subj_code / classroom / cour_times`；新表 schedule_rows（星期/节次/周次/教室/教师）或 courses.is_mine |
| C2 | 课程树「我的课程」置顶分组 + 徽标 | 来源=课表接口；**降级方案**：探测无果则手动收藏（pin），核心价值不丢 |
| C3 | 课程卡片显示时间/教室/教师 | courTimes + clroName + teacNames，与官网字段对齐 |
| C4 | 「同课程其他老师」推荐 | 按 subjCode（或 subjName）聚合教学班，我所在课程的其他教学班优先展示——对应你的原始需求 |

### Phase D：质量与发布

- 每项改动配测试（解析纯函数 / 迁移 / IPC 三态 / 组件）；测试数只增不减，四门禁 + smoke 19/19 + 红线审计（courTimes 等无敏感值，仍跑日志扫描）。
- `v0.2.2` 按 `scripts/release.md` 清单发布；**验收判据**：安装版全新首启 → 未登录态正确 → 登录成功（含失败可见）→ 刷新课程显示进度与总量 → 我的课程置顶 + 时间/教室展示 → 收割一门**从未抓过的**新课全链 succeeded。

## 三、需要你配合 / 拍板的点

1. **现在就能做**：确认 ClashMI 的 `DOMAIN-SUFFIX,seu.edu.cn,DIRECT` 规则还在——PowerShell 执行 `nslookup dncvsvod.seu.edu.cn`，返回 `172.19.x.x` = fake-ip = 规则丢了（订阅更新覆盖），需重插。
2. **决策点 1**：dev 隔离用「userData 加 `-dev` 后缀」（推荐，零迁移）？
3. **决策点 2**：课程列表走「我的课程优先 + 全校限量分页」，不做 648 页全量（推荐）？
4. **决策点 3**：Phase C 若课表接口探测不出，接受降级（手动收藏 + t-1 时间字段展示）？
5. Phase C 探测需你登录一次平台并配合抓包（约 10 分钟）。

## 四、执行顺序与规模预估

A1→A5 一批提交（预计 5-7 个提交，+15 测试左右）→ B1→B3（3 个提交）→ **探测会话** → C1→C4（视探测结果 4-6 个提交）→ D 发布。全程 Conventional Commits，push 前 `git status` 仅含本阶段文件，PROGRESS.md 同步台账。
