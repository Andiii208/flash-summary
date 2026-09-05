# SEU Summary v0.4.1 全面设计审查整改方案（待审批）

> 2026-09-05。来源：Andiii 要求对 v0.4.0 做全面设计审查（「看看还有没有设计上的缺陷」），审查已完成并经 Andiii 拍板「都要做」。
> 状态：**已批准（2026-09-05）——七个决策点全按推荐裁决**：①Tray 最小实现+任务完成后自动恢复窗口；②批准删除 pipeline.ts 的测试数例外（记录 PROGRESS）；③electron-updater 本轮不做；④不购签名证书；⑤关键帧 pts 精确化做；⑥缓存配额默认 20GB；⑦qa.course_id 保留列+加索引。基线：master 360c8a1（v0.4.0，四门禁 463/463 + smoke 22/22）。
> 取证方式：三路并行深查（任务管线 / 数据层 / 安全与外部交互）+ 渲染层全文走读（app.tsx 1758 行）+ 全部 P0 与关键 P1 亲自核验代码行号。
> 目标版本：**0.5.0**（含迁移重做与渲染层结构重构，属 minor 量级）。

---

## 〇、审查总结与元观察

审查结论：骨架健康（串行队列+阶段状态机+stage 交接、shared 单一事实源、安防意识上乘），但存在 **4 条 P0、约 20 条 P1、15+ 条 P2**。本方案覆盖全部发现，按依赖与风险分八批。

**元观察（贯穿所有批次的整改原则）**：三路审查独立发现了同一个模式——**设计声明与实现漂移**：

| 声明处 | 声明内容 | 实际 |
|---|---|---|
| session-crypto.ts:21 | JWT "encrypted at rest" | jwt 明文进 JSON |
| orchestrator.ts:120 | 直链"never into the lessons table" | legacy 路径（:199）明写 |
| PROGRESS 关键决定 | bridge"通道均只读，风险可接受" | providers:save / setCacheDir / exportPdfWrite 都是写通道 |
| cache-clean.ts:9 | "running/queued task id are always kept" | 生产调用（app-context.ts:117）传默认空集，护栏未接线 |
| notes/schema.ts:53 | quiz"no unanchored questions" | normalizeQuiz 不校验 concept→term |

**整改纪律：凡本方案修改的行为契约，必须同时落一条钉住该契约的测试**（这是审查发现的根因解法，不是额外负担）。

---

## 一、批次总览与实施顺序

| 批 | 主题 | 规模 | 依赖 |
|---|---|---|---|
| A | 安全红线收口（8 小项） | 小 | 无 |
| B | 恢复语义与管线韧性（P0-1 核心） | 大 | 无 |
| D | 队列与生命周期不变量 | 中 | B |
| C | 资料库位置与迁移重做（P0-2 核心） | 中大 | D（迁移前置检查需要队列成员） |
| E | IPC 面与导航收口 | 中 | 无（与 C 并行可） |
| F | 数据契约与增长护栏 | 中 | 无 |
| G | 渲染层结构（拆 hook + ErrorBoundary） | 大 | 建议最后（纯重构需全部测试护航） |
| H | 收尾与验证（死代码/转储/更新/pts） | 小 | 各批残留 |

实施节奏：**A → B → D → C → E → F → G → H**。每批独立提交（Conventional Commits），批内 `npm run lint && npm run typecheck && npm test` 全过再进下一批；每批结束更新 PROGRESS.md。测试数只增不减（唯一例外见决策点 2）。

---

## 二、批 A：安全红线收口（全部小改，半天量级，红线收益最大）

### A1 JWT 加密落盘（P0-3）

- `src/main/auth/session-crypto.ts`：`encryptSession` 对 `jwt` 同样走 `cryptor.encryptString`，序列化结构变为 `{ ...rec, cookies: sealA, jwt: sealB }`（jwt 为 undefined 时保持 undefined）；`decryptSession` 对应解密两个字段。
- **旧格式兼容**：读到 `jwt` 解密失败（旧明文）时按明文使用并记一条日志（脱敏后），下次 `persistSession` 自然转加密——不强制用户重登。
- 测试：①serialize 输出不含明文 jwt（加密字段全覆盖断言）；②decrypt 往返；③旧明文 jwt 文件可读且不抛。

### A2 legacy 路径直链不入 lessons 表（P0-4b）

- `src/main/tasks/orchestrator.ts:199`：legacy JSON 路径的 `stream_urls_json` 改存 `sanitizeStreamUrl(...)` 后的值；完整签名 URL 改走 `recordStage`（与 V1 路径同构：`{ lessonId, teacherStreamUrl, screenStreamUrl }`），使 downloading_video 的 fallback 链不因脱敏而断。
- 测试：legacy 路径执行后 lessons 表 URL 无 auth_key（`?` 后无 `auth_key=`），stage output 保留完整 URL。

### A3 任务终态清除直链（P0-4a）

- `src/main/tasks/queue.ts`：`markSucceeded` / `markFailed` 执行后追加 `DELETE FROM task_stage_outputs WHERE task_id = ? AND stage = 'fetching_course'`（仅删该行，其余阶段产物保留供 B1 降级判断）。
- 失败任务重试时 downloading 缺 URL → 由 B1 的降级机制回 fetching_course 重收割。**与 B1 是配套设计，先 A3 后 B1 的中间态（重试多收割一次）可接受**。
- 测试：任务 failed/succeeded 后 fetching 行为空。

### A4 脱敏收口：redact 增强 + 三条旁路接上（P1）

- `src/main/logger.ts` `redact()`：①`authorization: Bearer <token>` 整段命中（现 `\S+` 只吃掉 "Bearer" 一词）；②cookie 值匹配延伸到分号（`[^;\s]*`，多对 cookie 不漏）；③模式列表补 `jwt[-_]?token`。
- **DB/UI 旁路**：`src/main/tasks/queue.ts` `markFailed` 与 `runTask` catch 的「执行异常」路径，error 入库/入 IPC 前过 `redact()`（redact 是无依赖纯函数，可直接 import；ffmpeg stderr 会回显含 auth_key 的输入 URL，这是审查确认的真实泄漏路径）。
- **net-trace 旁路**：`src/main/auth/cas-login.ts` `traceLine` 统一过 redact；`url.slice(0, 60)` 改为「origin+path，query 只记 key 名」（对齐 traceSession 的标准）；net-trace.log 纳入 7 天轮转。
- 测试：redact 单测补 Bearer/多对 cookie/jwt-token 三例；一条「ffmpeg 错误消息入库后无 auth_key」的集成断言。

### A5 cookie 回灌保留 HttpOnly（P1）

- `src/main/app-context.ts:191-202` `injectSessionCookies`：`jar.set` 补 `httpOnly: true`。
- 设计取舍：收割侧 `cookies.get` 只拼了 name=value 丢掉了原始 flag，逐 cookie 保真需改 SessionRecord 结构。**简化裁决**：回灌一律 httpOnly（平台 SPA 靠 sessionStorage JWT 鉴权、不依赖页面 JS 读 cookie，误标无害；main 侧请求走 header 注入不受影响），注释写明理由。
- 测试：inject 后 `cookies.get` 断言 httpOnly === true。

### A6 providers:save 空 key 保留旧值（P1）

- `src/main/providers/store.ts` 保存逻辑：`apiKey === ''` 且 provider 已存在 → 保留旧 key 列值（编辑名称/绑定时不再毁 key）；新建 provider 空 key → 校验报「API Key 必填」。
- 测试：空 key 保存后 `providers:list` shape 不变、解密值不变。

### A7 SchoolClient 请求超时（P1）

- `src/main/school/client.ts`：所有 fetch 包 `Promise.race([fetch, 30s 超时 throw])` + `AbortSignal.timeout` 双保险（memory 有「Electron main fetch 走 Chromium 栈 AbortSignal 可能不生效」的存疑记录，race 保证调用方必返回；**用真实 HTTP 集成测试钉住超时生效**——本地慢响应服务器，断言 30s 内返回 session_expired/网络错误类）。
- 对齐 probe 的 6s 预算口径：listCourses 等长请求给 30s，probe 类保持现值。

### A8 logout 清理彻底化（P2 升级项，安全相关）

- `src/main/app-context.ts` `clearBrowserSessionState`：补 `persist:seu-cas` legacy 分区的 cookies/localStorage 清理；`logout` IPC handler 改 await（渲染层 `logout` 回调同步 await 桥调用后再清本地态）。
- 测试：两个分区 cookie 罐均被清（fake session 断言）。

---

## 三、批 B：恢复语义与管线韧性（P0-1，核心卖点修复）

### B1 阶段产物校验 + 自动降级恢复（P0-1 主修）

新增纯函数 `resolveResumeStage(db, taskId, failedStage): Stage`（放 `src/main/tasks/stages.ts` 或新文件 `resume.ts`，可测），`ipc.ts firstStageFor` 改为调用它。降级规则（从失败阶段往回探）：

| 想恢复的阶段 | 检查 | 缺失时降级到 |
|---|---|---|
| summarizing | 无前置文件依赖（summarizeLesson 读 db） | 不降级 |
| extracting_visuals | downloading 产物 screenPath 存在（existsSync） | downloading_video |
| transcribing | extracting_audio 产物 audioPath 存在 | extracting_audio |
| extracting_audio | downloading 产物 teacher/screenPath 存在 | downloading_video |
| downloading_video | fetching 产物 URL 存在且「新鲜」（见下） | fetching_course |

- **URL 新鲜度**：fetching stage output 增记 `harvestedAt`；`auth_key` 按时间戳签名（V4.1 实测 8h 有效），取 **6 小时**安全边界，超龄视为过期降级 fetching_course。无 auth_key 的 legacy URL 不做时效判断。
- `stageOutput` helper（orchestrator.ts:85）加 try/catch：`JSON.parse` 失败返回 null → 上层按产物缺失降级（修复 P2-4 死局）。
- **降级时清理失效产物**：回退点之后的 stage output 行删除（`DELETE ... WHERE task_id=? AND stage IN (失效阶段)`），防旧产物误导后续阶段。
- 失败原因人话化：降级发生时进度事件 message 注明「产物已过期/缺失，自动从 <阶段> 重新开始」（反静默，符合 Andiii 诚实原则）。
- 测试：三个 P0 场景各一条——①URL 超龄 → 从 fetching 重跑；②audioPath 被删 → 从 extracting_audio 重跑；③stage output JSON 损坏 → 不炸、正确降级。

### B2 转写分片 checkpoint（P1）

- `makeTranscribe`（orchestrator.ts:329）：`task_stage_outputs` 的 `transcribing` 行改存 `{ segments, doneChunks: number[], totalChunks }`，每片成功即 `recordStage` 更新；全部完成后照旧改写为 `{ chars, chunks }` 摘要并落 transcripts 表。
- 重试时读回 segments/doneChunks：已完成分片直接复用文本（跳过 ffmpeg cutChunk + 上传），从第一个未完成分片续跑。**零 schema 变更**（复用现有表）。
- 测试：第 2/3 片注入失败 → 重试只发 1 次新请求（调用计数断言）、segments 拼接完整、时间戳偏移正确。

### B3 视频下载：完成标记 + 失败重试 + 双流独立断点（P1-4 的务实版）

**不做** HTTP Range 视频下载器（remux 拉流是现实验证过的路径，推倒重来风险大），用三个低成本手段把最坏代价从「×2 全量重下」降到「只重下失败的那条流」：

- **完成标记**：`fetchStreamDefault` 成功后 `teacher.ts → teacher.ok / screen.ts → screen.ok`（rename）；`makeDownload` 重跑时存在 `.ok` 文件即跳过该流。stallGuard kill 留下的不完整文件没有 `.ok`，天然被重下。
- **流级重试**：单流失败重试 2 次（指数退避 5s/15s），复用 transcribeChunk 的重试骨架。
- **取消/降级联动**：B1 的 existsSync 检查改为检查 `.ok` 标记。
- 测试：teacher 成功 screen 失败 → 重试不再调 teacher 的 fetchStream（stub 计数）；`.ok` 文件语义。

### B4 downloadToFile 的 416 修复（P2）

- `src/main/media/download.ts`：Range 请求返回 416 且本地文件大小 > 0 → 视为「已下载完整」返回成功（416 的现实成因就是 offset ≥ size）。
- 测试：416 + 已有文件 → 成功且不 unlink。

### B5 缓存配额与失败残留（P2-1）

- `cleanStaleCache` 增加 `maxTotalBytes`（默认 20GB，设置项 `cacheQuotaGb` 可调）：统计 cache 总量，超配额按 mtime 从旧到新删非运行中任务目录，直到低于配额；运行中/排队任务目录永远跳过（**把 runningTaskIds 参数真正接线**——传 `queue.members()`，D1 落地后自动生效）。
- 删除行为记日志（只记任务 id，不记路径内容）。
- 测试：配额触发删除最旧、跳过运行中。

### B6 磁盘空间预检（P2-3）

- `makeDownload` 开始前 `statfsSync(cacheDir)`：可用空间 < 5GB → 任务失败，错误信息「磁盘剩余空间不足 5GB，请清理后重试」；`shared/errors.ts` 补 ENOSPC 人话映射。
- 测试：注入 statfs 假实现断言拒绝路径。

---

## 四、批 D：队列与生命周期不变量

### D1 队列成员管理与主进程入队校验（P1-7）

- `SerialTaskQueue` 扩展：`queuedIds: Set<string>`；`enqueue` 对重复 id 拒绝（返回 `{ ok: false, error }`）；`members(): string[]`（running + queued）；`current()` 语义不变。
- `ipc.ts tasks:runAsync`：入队前校验——①任务已在队列 → 拒绝「任务已在队列中」；②同 lesson 存在非终态任务（查 db）→ 拒绝「该课时已有任务在排队/运行中」（**排队上限 3 与同课去重从渲染层收进主进程**，渲染层守卫保留作为 UX 预检，主进程为真源）；③渲染层 `launch` 的本地 `setRunning` 等乐观态改由进度事件驱动。
- **出队复核**：`queue.run` 出队时先 `repo.get(taskId)` 复核状态——若已是 `failed`（被取消）或不存在（被删除）则跳过不执行。这是 D3/D5 竞态的根治点。
- 测试：重复入队拒绝、同课去重、出队复核跳过已取消任务。

### D2 tasks:run 通道处置（P1-7）

- grep 确认 renderer 无调用后**删除** `tasks:run` 通道（绕过队列的唯一入口）+ 对应桥面/烟测登记同步清理。若 grep 发现有调用方则改走队列。

### D3 取消 pending 任务不再炸 CHECK（P1-2）

- `TaskRepository.markFailed` 的 `stage` 参数放宽为 `Stage | null`（001 迁移的 CHECK 对 NULL 天然放行：`failed_stage IS NULL OR ...`）；`ipc.ts:698` 对 `state === 'pending'` 的取消传 `null` + error_message「任务已取消」。
- 测试：取消 pending 任务 → state=failed、failed_stage=NULL、可删除。

### D4 「后台继续运行」承诺兑现（P1-1，决策点 1）

**推荐版：Tray 最小实现**
- `src/main/index.ts`：close 且任务运行中时，「后台继续」分支从 `win.destroy()` 改为 `win.hide()` + 创建 Tray（tooltip「SEU Summary — 任务运行中」，点击 restore；右键菜单：打开主窗口 / 退出）；任务全部结束时自动恢复窗口（或仅 Tray 提示，见决策点 1b）。
- `window-all-closed` 在 Tray 存在时不 quit；「退出」菜单项 = cancelRunning + quit（如实中断，不承诺后台跑完）。
- 保守版（若 Andiii 砍掉）：删「后台继续运行」按钮，对话框只留「取消任务并退出 / 返回应用」，detail 文案如实。
- 测试：main 层 Tray 逻辑注入断言（hide 分支、恢复分支）；smoke 覆盖单实例锁不破坏。

### D5 关窗确认与 cancelRunning 覆盖排队集（P2-8）

- `ipc.ts` 的 `isTaskRunning` → `queue.members().length > 0`；`cancelRunning` → abort 运行中 + 对排队任务 markFailed(cancelled)（出队复核保证不执行）。
- 测试：仅排队任务时 isTaskRunning 为 true。

### D6 summarizing 阶段可取消（P1-6）

- `summarizeLesson` 加 `signal` 参数透传到 `client.chat`（ProviderFetchInit 已支持 signal）；`makeSummarize` catch 加 `isCancelled` → `cancelResult()`。
- 测试：summarize 中 abort → 返回 cancelled 而非失败。

### D7 ffmpeg 全调用统一超时/停滞检测（P1-8）

- `src/main/media/ffmpeg.ts`：`extractAudio`、`extractKeyframes`、`cutChunk` 调用处补 `timeoutMs: 30min` + `stallGuard`（与 remux 同规格；cutChunk 120s 音频给 5min）。
- 测试：grep 级验收（全部 runProcess 调用带 timeout）+ 一条挂死注入测试。

### D8 进度百分比语义修复（P2-6）

- `runTask`（queue.ts:105-106）：阶段**开始**事件的 percent 改为上一阶段的 stagePercent（首阶段 0），消除「下载刚开始就 33%」的自相矛盾；细分进度（onChunkProgress/onDownloadProgress）机制不动。
- 测试：更新现有进度序列断言（注意数个既有测试要同步，属修断言不是删断言）。

---

## 五、批 C：资料库位置与迁移重做（P0-2）

### C1 库外引导指针（P0-2 主修）

- 新增 `userData/library-pointer.json`（`{ "libraryRoot": "..." }`）：`createContext` 启动时读它决定 db 位置（无文件/解析失败 → 默认 Documents 路径）。`settings.libraryRoot` 降级为纯显示字段（设置页回显用），真源是 pointer。
- `migrateLibrary` 成功后：写 pointer → `relaunch` 提示（现有 restartRequired 语义不变，但重启后真正生效）。
- **迁移事务化顺序修正**（P1-5）：备份前先在旧库写 settings（记录），备份后在新库**直接补写** pointer 同值，消除「备份内容/指针位置/实际句柄」三处不一致。
- 测试：pointer 读写往返、损坏 pointer 回退默认、迁移后重启 createContext 打开新库（临时目录集成测试）。

### C2 库内路径改相对（P0-2 第二刀）

- **写入端**：orchestrator（ppt/keyframes 落库）、attachments、summarize 全部改存 `attachments/<lessonId>/...` 相对路径。
- **读取端**：统一 `resolveLibraryPath(libraryRoot, p)` helper——`isAbsolute(p)` 则原样用（兼容未迁移旧库），否则 `join(libraryRoot, p)`。
- **存量改写**：迁移时（C3）对新库执行 `UPDATE keyframes SET file_path = <相对化>` / 同 ppt_pages（srcRoot 前缀剥离）；非迁移场景（老库原地升级）在读取端靠 isAbsolute 分支兼容，不强制一次性 UPDATE。
- 测试：相对路径往返、旧绝对路径兼容、迁移改写后附件可解析。

### C3 迁移过程异步化 + 前置守卫（P1-4）

- `migrateLibrary`：attachments 复制从 `cpSync` 改为**按课时目录逐个 `await fs.promises.cp`**（目录数=课时数，天然分批），每批后经回调上报进度（`{ copied, total }` → 复用 school:refreshProgress 式事件或新通道，设置页显示「迁移中 12/80 …」）。
- 前置守卫：`queue.members().length > 0` → 拒绝「有任务在运行或排队，请稍后再迁移」；渲染层 chooseLibrary 按钮 busy 防护（顺修遗留清单⑤）。
- 失败回滚不变（rmSync dest），但守卫先行后「迁移期间任务写旧库」的窗口被关闭。
- 测试：守卫拒绝路径；进度回调序列；中断后 dest 清理。

### C4 迁移/启动失败兜底（P1-1，静默白屏砖机）

- `src/main/index.ts`：`Logger` 构造提前到 `createContext()` 之前注入（createContext 加 logger 参数）；`whenReady` 内 try/catch——createContext 抛出时 `dialog.showErrorBox`（人话：资料库打开失败的原因 + 日志目录路径）+ 日志落盘 + 优雅退出，永不静默白屏。
- 测试：注入坏迁移使 openDatabase 抛错 → 断言错误框路径被调（fake dialog）+ 日志文件存在。

### C5 settings 类型收敛（P2-7 顺带）

- settings key 收敛为 `const SETTINGS_KEYS = { libraryRoot, cacheDir, theme, cacheQuotaGb } as const` 联合类型；`readSettings` 对 theme 做 3 值白名单校验（坏值回 auto）。

---

## 六、批 E：IPC 面与导航收口

### E1 sender 校验全覆盖（P1-5 主修）

- `src/main/ipc.ts`：新增 `handle` wrapper——`const handle = (ch, fn) => ipc.handle(ch, (e, ...a) => { assertAppSender(e); return fn(e, ...a) })`，全量替换现有 `ipc.handle` 调用（机械改动，~50 处）。
- `assertAppSender`：`e.senderFrame?.url` 必须以 `file://` 开头或等于 dev URL（`ELECTRON_RENDERER_URL`）；否则 throw「非法调用方」并记日志。
- 效果：主窗口导航到学校平台期间，学校页面的 JS 经 preload 桥调用任何 IPC 都会被拒——PROGRESS 里「可信学校平台」的风险定性不再依赖信任，改为结构性封死。收割/登录链路不受影响（V1 收割与 V2 登录都是 main 侧驱动，不经桥）。
- 测试：fake event（url=file://）通过；url=https://evil.com 拒绝；smoke 全量回归（22 条通道探活必须仍绿——这是 wrapper 机械性的验收）。

### E2 导航守卫（P1-5）

- `src/main/index.ts` 主窗口：①`will-navigate`：URL 不在白名单（`*.seu.edu.cn` + `file://` + dev URL）则 `preventDefault` + 日志；②`setWindowOpenHandler` → deny + 日志（收割点选课时是 SPA 内路由，无新窗需求；若实测有场景需放行再开洞并记录）；③`setPermissionRequestHandler` → 一律拒绝。
- 测试：fake webContents 事件断言 preventDefault 调用。

### E3 exportPdfWrite token 化（P1-6）

- `exportPdfDialog` 成功后 main 侧保管 `{ token, filePath }`（Map，5 分钟过期，一次性）；`exportPdfWrite` 签名改 `(token)`，main 用保管 filePath 覆盖 renderer 传参——renderer 指定任意路径写文件的能力被移除。bridge 类型同步。
- 测试：无 token/过期 token/错误 token 拒绝；正常流程往返（SEU_PDF_PATH 缝保持）。

### E4 revealFile 路径域约束（P2-9）

- `notes:revealFile`：仅允许 `exportsDir()` 与 `attachmentsPath()` 前缀内的路径，越界拒绝。
- 测试：越界路径拒绝、exports 内路径通过。

### E5 baseUrl 强制 https（P2-10）

- `providers/model.ts` `validateProvider`：非 localhost/127.0.0.1 的 `http://` 拒绝，错误信息说明原因（key 明文风险）。
- 测试：http 拒绝、https 通过、localhost http 放行。

---

## 七、批 F：数据契约与增长护栏

### F1 quiz 无锚题归一强制（P1-2）

- `normalizeQuiz`（shared/notes/schema.ts:147）：`source === 'concept' && !term` → 丢弃该题（代码口径对齐第 53 行注释契约）；exam/cue 类不受影响。
- 测试：注入无 term concept 题 → 归一后不出现；Markdown/Anki 导出不再出现「概念 · 」空锚点。

### F2 证据引用存在性入库校验（P1-3）

- `summarize.ts` `saveNoteVersion` 前：从 db 查本课时真实证据集（ppt 页数 → `ppt:0..N-1`；keyframes 文件名 → `kf:<stem>`），传入 `normalizeNote` 新增可选参数 `validRefs?: ReadonlySet<string>`；不在集合内的 ref 从 evidence/timeline.evidence 数组剔除（**文本内容不动**——渲染层 nearest 兜底机制本就处理缺图，剔除只是把「图配错」变成「图退回就近」，比静默死链诚实）。
- 剔除计数进 hitRate 返回链（toast 已显示「引用命中 N/M」，口径自然变准）。
- 测试：注入含捏造 ref 的模型输出 → 入库笔记无捏造 ref、文本完整。

### F3 refs 时间戳归一全覆盖（P2-4）

- `withNormalizedTimestamps` 扩展到 `concepts[].refs` 与 `formulasAndSteps[].refs`（同 `coerceAt` 路径），消除「timeline 修了、concept 没修」的两套命运。
- 测试：concept ref 输出 "12:30" → 归一为秒数。

### F4 附件按需加载（P2-3，渲染内存/IPC 线性恶化的根治）

- `notes:attachments` 改返回**清单**（`{ ref, kind, name }`，不带 data URL）；新增 `notes:attachmentData(lessonId, ref)` 单图通道（8MB/张上限沿用）。
- 渲染层：`NoteBlocks`/时间线/图集组件按 ref 懒加载（组件层 Map 缓存）；**PDF 导出例外**——`exportNotePdf` 前批量预取全部附件再渲染 PrintHandout（保持 waitForImages 语义）。
- 测试：清单通道形状、单图通道 8MB 上限、懒加载组件渲染（mock 数据 URL）。

### F5 索引补齐（迁移 008，P2-10）

- `CREATE INDEX idx_tasks_created ON tasks(created_at)`、`idx_qa_created ON qa(created_at)`、`idx_qa_course ON qa(course_id)`（course_id 列保留——spec §6 的预留承诺有效，决策点 7）。
- 测试：迁移 008 幂等 + EXPLAIN QUERY PLAN 断言走索引。

### F6 笔记版本历史上限（P2-2）

- `saveNoteVersion` 后：`DELETE FROM notes WHERE lesson_id = ? AND version <= max_version - 10`（保留最近 10 版；版本浏览 UI 仍属「明确不做」）。
- 测试：第 11 版插入后最早版本被剪。

### F7 formatTime/labelOf 收敛（P2-8）

- 新增 `src/shared/notes/format.ts` 单一实现，views.ts / markdown.ts / evidence.ts 三处改 import，删重复。

---

## 八、批 G：渲染层结构（最大可维护性债）

### G1 useAppState 拆分（1175 行 god hook → 域 hook 组合）

- 按域拆为 5 个 hook（**不追求完美架构，只拆域边界**）：
  - `useSessionState`（session/sessionInfo/login/logout/refreshTree/netCheck）
  - `useCourseTree`（tree/expanded/query/搜索/harvest/manual add/mine）
  - `useTaskCenter`（progress/history/createAndRun/retry/cancel/clear）
  - `useNoteWorkspace`（note/attachments/qa/五视图导出链）
  - `useAppSettings`（settings/providers/theme/cacheDir/library）
  - `useToasts` 保持独立小件；跨域联动（任务完成→loadNote、登录→refreshTree）用回调参数显式传递。
- `app.tsx` 变薄壳（现 403 行 JSX 保持不变）；**纯机械重构，行为零变化**，463 测试 + 组件测试全程护航；分两个提交：①hooks 抽取 ②app.tsx 接线清理。
- 验收：四门禁全绿 + smoke 22/22 + 真实库截图抽验四页签渲染与既有截图一致。

### G2 ErrorBoundary（P1 渲染白窗）

- 新增 `src/renderer/ui/ErrorBoundary.tsx`（preact class 组件，componentDidCatch → bridge.log.rendererError + 人话错误卡：「界面出错了，已记录日志。<重新加载>」按钮 = location.reload()）。
- 挂两处：App 外壳（兜白窗）、`NoteBlocks` 外层（笔记 JSON 渲染是最大风险面，笔记坏了不拖垮整个应用）。
- 测试：注入抛错子组件 → 错误卡渲染 + rendererError 上报断言。

---

## 九、批 H：收尾与验证

- **H1 死代码删除**：`src/main/media/pipeline.ts`（与活实现分叉的双真相）删除；其专属测试文件随之删除——**测试总数会下降，需 Andiii 点头**（决策点 2；理由：这些断言测的是无生产调用方的死函数，保留=鼓励误改）。
- **H2 崩溃转储验证**：实测制造一次渲染崩溃，检查 `%APPDATA%\seu-summary(-dev)\Crashpad\reports` 是否生成 minidump；若生成 → 启动时清理 >7 天转储（不碰用户数据）。
- **H3 ffmpeg/ffprobe 哈希校验**：构建时记录两个二进制的 sha256 进安装包，启动时 `binaries.ts` 校验不符则报错拒用（供应链防线，几行改动）。
- **H4 关键帧真实时间戳**（P2-5）：`extractKeyframes` 用 `ffprobe -skip_frame nokey -show_entries frame=pts_time` 取真实 pts 替换 `i × everySeconds` 近似值，图文对齐精度提升（决策点 5，可选）。
- **H5 更新与签名**（决策点 3/4）：electron-updater + GitHub Releases 属工程改造，本轮默认**不做**记入「明确不做」；代码签名证书需购买，等 Andiii 决定。

---

## 十、明确不做（本轮边界）

- HTTP Range 视频下载器（B3 的完成标记方案已覆盖 90% 收益，Range 下载器风险大）。
- repairJsonCandidate 尾逗号的括号深度感知（P2-9）——修复仅在 JSON.parse 失败后应用（现状即如此），模型输出字符串含 `,}` 概率低，修复成本高于收益，注释说明现状即可。
- RESTORE_PERCENT 恢复百分比精确化（已有「界面重载后恢复显示」诚实文案，够用）。
- 路由库/多窗口/侧栏虚拟化（既有边界不变）。
- 笔记版本浏览 UI、QA 发图（既有「明确不做」清单延续）。
- macOS / 云同步 / B 站（MVP 边界不动）。

## 十一、待 Andiii 拍板的决策点

1. **D4 后台运行**：推荐 **Tray 最小实现**（托盘图标+点击还原+退出菜单，45 分钟长任务误关窗的真实需求）；保守版=删「后台继续」按钮只留取消/返回。→ 1b：若选 Tray，任务全部完成后**自动恢复窗口**还是仅托盘提示？（推荐自动恢复——无窗口时 toast 不可见，「完成」这个最重要的状态必须有归宿）
2. **H1 死代码删除与「测试数只增不减」**：删除 pipeline.ts 连带其专属测试会让总数下降。规则本意是防删断言制造绿灯，此处是删死代码；**推荐批准例外并记录于 PROGRESS**。不批则 pipeline.ts 保留并加「DEPRECATED：勿改，活路径在 stages.ts」头注释。
3. **自动更新（electron-updater）**：本轮做/不做？做则加 1 个中批次（发布流改造 + latest.yml + 更新 UI）；不做维持手动下载（README 已有发布页指引）。
4. **代码签名证书**：购买（OV 证书约几百至千元/年）与否。不签则 SmartScreen 警告持续（装机验收时会看到「更多信息→仍要运行」）。
5. **H4 关键帧 pts 精确化**：做（图文对齐更准，改动局部）或接受近似值（偏差 ≤10s）？推荐做。
6. **B5 缓存配额默认值**：推荐 20GB + 设置项可调；或你指定其他默认。
7. **qa.course_id 空壳**：推荐保留列+加索引（spec §6 预留承诺仍有效）；激进版=删列（更诚实但推翻 spec 承诺）。

## 十二、测试与验收总纲

- 每批：`npm run lint && npm run typecheck && npm test` + smoke；涉及 main 行为的批次（A/B/C/D/E）补真实 Electron smoke 探活项（桥面变更必须登记）。
- 预计新增测试 ~45 条（A 12 / B 12 / C 8 / D 8 / E 6 / F 10 / G 4 — 以实际为准），测试数只增不减（决策点 2 例外单独记录）。
- 批 C 完成后做一次**真实库迁移演练**（副本库，不动真库）：迁移 → 重启 → 笔记附件/导出/追问全链回归。
- 全部落地后：版本 bump 0.5.0 + CHANGELOG + PROGRESS 阶段记录 + neat-freak 一致性检查（README/AGENTS 与代码事实对齐）→ 按 scripts/release.md 发布。
