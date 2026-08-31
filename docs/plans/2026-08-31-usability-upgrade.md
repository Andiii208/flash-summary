# SEU Summary 可用性与 UI 升级计划(v0.2.0)

> 本计划基于用户 2026-08-31 反馈(三个问题:无自定义下载位置、UI 过于简陋、按钮无反应无法使用)与全代码库审查。批阅通过后按阶段实施;实施进度记入 `PROGRESS.md`,本文件不随实施修改,阶段结论写入 PROGRESS。

---

## 1. 背景与用户反馈

| # | 用户反馈 | 现状核实 | 结论 |
|---|---|---|---|
| 1 | 下载时没有自定义下载位置 | 任务缓存(视频/音频)硬编码在 `Documents\SEU Summary\Library\cache`(src/main/library/paths.ts),无任何 UI 设置项;笔记导出无「另存为」,Markdown 导出函数存在(shared/notes/markdown.ts)但 **UI 上根本没有导出入口** | 属实,需补设置页 + 导出对话框 |
| 2 | UI 非常简陋 | renderer 为原生 DOM 手写单文件(main.ts ~290 行),三栏(课程/任务/Provider 设置/笔记/追问)全部堆在一页,无组件化、无状态管理、无空态/加载态/错误态设计 | 属实,整体重做 |
| 3 | 点按钮没反应,无法使用 | 已核实为真实缺陷(见 §3 根因),**不是打包产物过期**:抽验 v0.1.1 安装包 asar,main/renderer/preload 与当前源码逐一字节一致 | 属实,主流程需修复 |

基线:114/114 测试绿(本会话实测 19 文件全过)、lint/typecheck/build 正常、v0.1.1 安装包内容与源码一致。

## 2. 全代码库审查结论(多角度)

### 2.1 主流程(为什么「无法使用」)

- **任务运行是同步阻塞调用**:`tasks:run` 在 IPC 里 `await runTask(...)` 跑完整个流水线才返回(ipc.ts:139-159)。45 分钟课时的下载+转写+总结期间,渲染进程 UI **完全冻结**,无任何进度反馈 → 用户观感「点了没反应」。
- **无任何进度推送通道**:bridge.ts 只有一问一答的 `invoke`,没有 `tasks:onProgress` 事件;任务 state 变化 renderer 无法感知。
- **课程列表点击不选中课时**:列表项只是 `div.item`,没有 click 处理;选中课时只能靠「手动添加课程/课时 ID」输入,或测试钩子 `window.__selectLesson`(main.ts:283)。正常用户**无法从课程列表选课时** → 无法创建任务。
- **登录后不自动刷新课程**:登录成功只改按钮文案为「已登录」,课程列表不会自动加载,必须手动点「刷新课程」(而且这个按钮没有禁用/加载态)。
- **会话过期不自动重登**:spec §2 承诺「过期自动开 CAS 并从失败阶段恢复」,但 renderer 对 `kind: 'session_expired'` 错误无任何处理;失败的任务也不会自动重试。
- **无加载/禁用态**:所有按钮点击后不置灰,双击会重复创建任务/重复提问;错误只在按钮文字上短暂闪现,无持久提示。
- **无任务持久状态展示**:任务列表不显示;重启后无法看到历史任务/失败任务/重试入口(tasks:get 存在但 UI 未用)。

### 2.2 数据层

- **课程表只有列表元数据,无课时树**:`school:listCourses` 只返回课程;课时列表 **没有 IPC 通道**(api-parse.ts 有 lessonDetail 解析,但没有「列出某课程的课时」的接口)。UI 里课程无法展开到课时。
- **课时「已处理」状态无法感知**:UI 不知道某课时是否已有转写/笔记(notes:latest 存在但只在 `__selectLesson` 钩子里用)。
- **markdown 导出函数存在但零接线**:noteToMarkdown 写了,无 IPC 通道、无 UI 入口。
- **资料库/缓存位置硬编码**,`ensureLibraryLayout` 启动即建,无迁移机制(数据层支持迁移,spec §8 承诺「用户可换库位置」,未实装)。

### 2.3 管线层(二轮复查发现,比 UI 问题更实质)

- **多模态总结根本没发图片**:makeSummarize 只把「转写文本 + 证据 ID 字符串(如 keyframes=k1,k2;ppt=0,1)」发给模型(orchestrator.ts:254-269),`ChatImagePart` 类型定义了但全程无人使用。spec §3.7「用转写+PPT 图片+关键帧生成笔记」落空——当前产出的是**纯文本总结**,PPT/关键帧只是落盘了没参与总结。四视图「多模态」名不副实。
- **ASR 25MB 文件上限是主路径必炸**:OpenAI 兼容 /audio/transcriptions 的 whisper 限制 25MB;45 分钟 16kHz mono WAV ≈ 86MB,超出 3 倍多。当前一次整传,真实 45 分钟课程(用户核心场景)大概率失败。分片转写是**必做项**而非边缘优化。
- **视频流下载无超时/无进度**:`fetchStreamDefault` 用 ffmpeg 流拷贝下载(orchestrator.ts:96-98),不走带重试的 download.ts;ffmpeg 卡死(校园网常见)则任务永久挂起且 UI 冻结。`run()` 无超时参数(execFile 默认无限等待)。
- **无任务队列**:spec §2/Phase 3 承诺「本地任务队列(串行)」,但 ipc.ts 的 tasks:run 直接执行,连点两次「运行」会并发跑两个任务、写同一课时数据。
- **cache-clean 会误删运行中任务的缓存**:cleanStaleCache 按 mtime 一刀切,24h 前启动、仍在跑的长任务目录会被启动清理删掉(cache-clean.ts 无运行中保护)。

### 2.4 工程/安全

- **UI 零测试**:tests/ 19 个文件全部是 main 层(IPC/管线/媒体/存储),renderer 层无任何测试。
- **日志无落盘**:错误只进 UI 文案,无日志文件,用户报障无从排查。
- **无单实例锁**:main 未调 `requestSingleInstanceLock`,双开应用会同时打开同一 app.db(WAL 模式下交叉写有损坏风险)。
- **providers:list 把明文 apiKey 下发 renderer**:ipc.ts:87 直接返回 `ctx.providers()`,loadProviderSettings 解密后的 `apiKey` 明文字段随 list 通道进入渲染进程(tests/ipc.test.ts:103 甚至断言了明文值)。违反「Key 只在 main 进程解密使用」的安全意图(spec §9)。修法:list 只返回 `{id,name,baseUrl,hasKey}`。
- **CSP 无 `connect-src`**:index.html 的 CSP 未声明 connect-src,按默认 same-origin 兜底(当前 fetch 都在 main 层,风险可控,但重做 UI 时需显式声明)。
- 其余安全面健康:会话/Key DPAPI 加密、日志不含敏感值、无明文凭据落盘、fetch 全在 main 层 —— 重做 UI 时保持「renderer 不直接发网络请求」的边界。

### 2.5 打包/发布

- 发布流程无强制检查清单:本次已证实 v0.1.1 资产与源码一致,但「打 tag 的提交上重新构建 + asar 抽验」仍是人工步骤(CHANGELOG 已记录教训),需固化为脚本/文档。

## 3. 根因结论

「按钮没反应、无法使用」= 三个叠加缺陷:

1. `tasks:run` 同步阻塞,运行中 UI 冻结且无进度;
2. 课程列表不可点击选课时,唯一入口是「手动输入 ID」;
3. 无加载/禁用/空态/错误持久提示,所有操作零反馈。

单靠修 UI 无法解决:必须先补**进度事件通道**与**课时列表通道**,再做界面。

另一个产品层面的根因(二轮复查结论):即便主流程修好,当前管线对「45 分钟真实课程」也走不通——ASR 整传超 25MB 上限、总结未发图片。所以 U4 不是优化项,是兑现 spec 核心承诺的必做项。

## 4. 升级方案(五阶段)

用户已确认:UI 用 **Preact**;下载位置**「任务缓存目录可改 + 导出另存为」都要**;五阶段全部执行。完成后发布 **v0.2.0**。

全局约定(每阶段通用):

- 提交前必须过:`npm run lint && npm run typecheck && npm test && npm run build`(测试数只增不减,不 skip)。
- 每阶段 ≥1 个 Conventional Commit;安全红线不变(不提交凭据/日志无敏感值/资料库不入 Git)。
- 新增 IPC 通道全部走 `ApiResult` 信封;renderer 不直接发网络请求。
- UI 组件用 Preact + TypeScript strict;样式用 CSS 变量(明/暗模式)。

### Phase U1 — 主流程修复(让应用真正可用)

**目标**:修复 §3 三个缺陷,任务有进度、课程能选、操作有反馈;不动 UI 结构(保留现有布局,只接线)。

任务:

1. **任务进度事件通道**:main 侧 `runTask` 执行时经 `webContents.send('tasks:progress', {...})` 推送 `{ taskId, state, stage, message, percent? }`;preload 暴露 `tasks.onProgress(cb)` + `tasks.runAsync(taskId)`(后台执行,立即返回);bridge.ts 增加 `onProgress` 类型。**注意 main 侧需要持有主窗口引用**(当前 createMainWindow 返回值被丢弃,index.ts:32),把 ctx 与 win 接线。
2. **课时列表通道**:新增 `school:listLessons(courseId)`(实现:从数据库查该课程 lessons;若空且已登录,尝试从课程详情接口或提示手动添加);`school:courseTree()` 一次性返回 课程→课时 两级结构 + 每课时是否已有笔记/任务。
3. **课程→课时选择**:课程列表项可点击展开课时;点击课时 → 设置 currentLesson、加载笔记(notes:latest)、启用「创建任务/运行任务」按钮;移除对 `window.__selectLesson` 钩子的依赖。
4. **任务一键流程**:选中课时 → 「创建并运行」单按钮;运行期间按钮禁用 + 显示阶段文字;完成后自动加载笔记并提示可追问。
5. **登录后自动刷新**:登录成功回调里自动拉课程树;`session_expired` 错误统一处理 → 弹 CAS 重登 → 重登成功后对失败的当前操作自动重试一次(与 spec §2 对齐)。
6. **反馈组件**:顶部 toast 区(成功/错误/信息,自动消失);按钮 loading/disabled 态;任务区显示任务 id、state、失败阶段、错误文案、重试按钮。
7. **providers:list 不再下发明文 Key**:list 通道只返回 `{id,name,baseUrl,hasKey}`(apiKey 留在 main);同步修正 tests/ipc.test.ts:103 的明文断言(改为断言 `apiKey` 字段不存在)。bridge 类型相应收紧。
8. **测试**:IPC 层补「progress 事件发出」测试(用 FakeIpc 扩展 `send`);orchestrator 补 percent 计算单测;providers:list 无明文 key 断言。

验收命令:`npm run lint && npm run typecheck && npm test && npm run build`;新增测试 ≥8 个(IPC 进度 + 课时树 + session_expired 重试 + key 不出 main)。

完成判据:真实启动后,登录→课程树出现→点课时→创建并运行→界面实时显示阶段进度、完成后笔记出现、无冻结。

### Phase U2 — UI 重做(Preact,简洁高效直观)

**目标**:整体界面重做,低门槛、美观、响应式;保留 U1 的全部行为。

任务:

1. **引入 Preact**:`npm i preact`;renderer 入口改 Preact 挂载;抽组件:`App`、`Sidebar(课程树)`、`TaskPanel`、`NoteViewer(四视图)`、`QaPanel`、`Toast`、`Modal`、`EmptyState`/`Skeleton`。状态收敛到顶层 hook(useReducer 或轻量 store),IPC 调用封装成 hook(`useCourses/useTasks/useNotes/useQa`)。
2. **布局**:左侧固定边栏(课程树 + 当前课时信息 + Provider 状态徽标);主区分页签:任务 / 笔记 / 追问;右上角:登录态、设置入口。三栏职责从「平铺」改为「导航 + 聚焦」。
3. **设计系统**(frontend-design 原则):CSS 变量(`--bg/--surface/--text/--accent/--danger/--border/--radius`),明暗双主题跟随系统;统一间距/字号阶梯;状态色(进行中/成功/失败);图标用内联 SVG(不引图标库,保持包小)。
4. **关键页面**:
   - 课程树:分组显示学期,课时行显示「已处理✓/未处理」徽标,点击选中高亮。
   - 任务面板:任务卡片(阶段进度条 + 当前阶段文案 + 错误 + 重试/取消);历史任务列表(tasks:get 全量拉取)。
   - 笔记:四视图 tab + 时间戳引用样式化(不再用 `<pre>` 堆文本,按 section 渲染)+ **Markdown 导出按钮**。
   - 追问:对话流(气泡式),流式?MVP 不做流式,做 loading 态;保留历史。
   - 设置页:见 U3。
5. **空态/引导**:首次启动(未登录、无 Provider)显示步骤引导:「① 登录 CAS → ② 配置 Provider → ③ 选择课程生成笔记」;每步可跳转对应操作。
6. **CSP 收紧**:显式 `connect-src 'none'`(renderer 不发网络请求)、`img-src 'self' data:`、`style-src 'self' 'unsafe-inline'`。
7. **测试**:引入 `happy-dom`(或 jsdom)写组件测试:课程树渲染/选中、任务进度条状态映射、四视图 tab 切换、空态渲染。≥10 个。

验收命令:`npm run lint && npm run typecheck && npm test && npm run build`;`npm run dev` 手动走查 U1 全流程在新区下正常。

完成判据:界面截图评审通过(简洁、层级清楚、明暗主题正常);U1 验收项在新 UI 下全部可复现。

### Phase U3 — 设置与自定义下载位置

**目标**:用户可自定义「任务缓存(下载)目录」与「资料库位置」;笔记导出走系统保存对话框;首次启动引导配置。

任务:

1. **设置持久化**:新增迁移 `004_settings`(key-value 表);IPC `settings:get/set`;设置项:`libraryRoot`(资料库,默认 `Documents\SEU Summary\Library`)、`cacheDir`(任务缓存/下载目录,默认 `Library\cache`,可指到其他盘如 `D:\SEU Summary Cache`)、`theme`(auto/light/dark)。
2. **下载位置生效**:`paths.ts` 增加 `resolveCacheDir(settings)`;orchestrator/缓存清理改读设置;设置变更后校验可写并即时生效(不需要重启)。
3. **资料库迁移**:设置页提供「选择新资料库目录」(dialog.showOpenDirectory + 校验空目录);迁移 = 复制 app.db + attachments(用 SQLite backup API 防写坏)→ 切换;迁移前自动备份。不做多盘同步(spec §8 边界)。
4. **导出另存为**:IPC `notes:exportMarkdown(lessonId)` → `dialog.showSaveDialog` 默认 `exports/` → 写文件 → 返回路径;UI 笔记页加导出按钮,导出成功 toast 显示路径。
5. **设置页 UI**:U2 的「设置」页放:账号(CAS 状态/登出)、Provider 管理(现有表单迁移过来 + 已绑定能力展示 + 删除)、资料库/缓存位置(路径 + 更改 + 打开目录)、主题。
6. **首次启动引导**:未配置 Provider 时主区显示引导卡(不阻塞浏览课程);一键「去配置」。
7. **测试**:settings CRUD 单测、cacheDir 解析单测、资料库迁移单测(含失败回滚)、导出写文件单测。≥8 个。

验收命令:`npm run lint && npm run typecheck && npm test && npm run build`。

完成判据:设置页可改缓存目录并即时生效(新任务产物落到新目录);资料库迁移前后数据完整;导出弹系统对话框并写入选定路径。

### Phase U4 — 管线质量与长任务体验

**目标**:45 分钟+ 真实课时长任务稳定、可中断、可续传;失败可诊断;产品核心承诺(多模态)真正兑现。

任务:

1. **ASR 分片转写(必做,主路径)**:按 10 分钟边界切音频(ffmpeg `-ss/-t` 切片,或按静音对齐更佳,取更简单者并记录理由),逐片上传转写,拼接段落(保留片内时间戳+片偏移);进度事件按片推进。25MB 限制由此解除,45 分钟以上课程不再失败。
2. **多模态总结真的发图**:makeSummarize 组装 ChatImagePart(把落盘的 PPT 页与去重后关键帧 JPEG 读入为 base64 data URL,附时间戳文字说明,上限如 20 张防爆 token);Provider 不支持视觉输入时(unsupported_visual 错误)自动回退纯文本提示并记录。补 orchestrator 单测:消息里确有 image parts、图片张数上限、回退路径。
3. **ffmpeg 超时与进度**:run() 增加 timeoutMs(下载流拷贝按字节停滞检测:stderr 无进展超时判死);kill 子进程并把 stderr 尾部写入 error_message。
4. **任务队列化 + 单实例锁**:main 侧串行执行器(同一时刻至多 1 个任务在跑,排队 pending);`tasks:runAsync` 入队即返回;`app.requestSingleInstanceLock`(二开聚焦主窗口)。补队列单测(并发 run 请求 → 串行执行断言)。
5. **任务取消**:IPC `tasks:cancel(taskId)`;orchestrator 注入 `AbortSignal`(ffmpeg kill、下载 abort、provider 请求 abort);取消后状态 `failed(cancelled)` 文案「已取消」。
6. **缓存清理修正**:cleanStaleCache 跳过「正在运行/排队任务」的 cache 目录(按任务 ID 判定,不再 mtime 一刀切)。
7. **错误诊断增强**:每阶段失败时把 stage、错误 kind、建议动作写入任务记录;设置页可查看「最近的错误日志」。
8. **断点续传(仅 PPT/HTTP 文件下载路径)**:downloadToFile 支持 `Range` 续传;视频流路径改用「HLS 分段清单 + 分段下载合并」或「ffmpeg 带超时重试」二选一——实施时按简单可靠优先并在 PROGRESS 记录理由(不改产品边界)。

9. **测试**:ASR 分片拼接单测、多模态消息组装单测、队列串行单测、cancel 单测、ffmpeg 超时单测、缓存跳过运行中任务单测。≥10 个。

验收命令:`npm run lint && npm run typecheck && npm test && npm run build`。

完成判据:45 分钟音频分片转写拼接正确(时间戳连续性断言);总结请求中包含图片内容(消息组装断言);运行中任务可取消且临时文件清理;双开应用被单实例锁拦截;任务并发请求被队列串行化。

### Phase U5 — 基建收尾与 v0.2.0 发布

**目标**:文档/日志/发布流程闭环,发布 v0.2.0 且资产与源码一致性有机制保障。

任务:

1. **日志落盘**:main 层 logger(文件轮转,`userData/logs/`,不含 cookie/key/完整 URL);渲染层错误经 IPC 上报;设置页「打开日志目录」。
2. **README/CHANGELOG/PROGRESS/AGENTS 同步**:新功能、新 IPC 清单、设置项、已知限制;neat-freak 一致性检查(发现待删残留列清单)。
3. **发布流程固化**:`scripts/release.md`(或 GitHub workflow)步骤:同一提交构建 → asar 抽验(main/preload/renderer 与源码哈希一致)→ 打 tag → 传资产 → 更新 latest.yml;发布前必须过四条门禁 + 全量测试。
4. **回归**:U1-U4 全部验收项在打包版(v0.2.0 exe)重跑一遍;启动烟测。
5. **CI 补 UI 测试**:windows-latest 跑全量(含组件测试)。

验收命令:`npm run lint && npm run typecheck && npm test && npm run build && npm run dist`;`npx @electron/asar` 抽验包内产物与 `out/` 一致。

完成判据:v0.2.0 安装包产出;发布清单执行;PROGRESS/CHANGELOG/README 与代码事实一致。

## 5. 版本与风险

- 版本:v0.2.0(从 v0.1.1 升级,非破坏性;数据库迁移 004 兼容旧库)。
- 风险与预案:
  - Preact 引入改变 renderer 结构 → U1 先行把行为与界面解耦,UI 重做不碰 IPC 契约;组件测试兜底。
  - 资料库迁移误操作 → 迁移前自动备份 + 目标目录校验 + 失败回滚单测。
  - 真实 CAS/API 结构未知(课程课时接口字段) → U1 课时列表通道先实现 DB 兜底(手动添加仍可用),真实接口探测留待真机,不阻塞本计划。
  - 多模态发图后 token/成本上升 → 图片张数上限 + JPEG 已有质量参数,失败回退纯文本。
  - ASR 分片的截断点可能切断语句 → 按静音对齐切点优先,不行则 10 分钟硬切并在 PROGRESS 记录取舍。
  - (已删)一轮版本误写「下载续传依赖服务器支持 Range → 不支持时回退整段重下」:该风险仅适用于 PPT/HTTP 文件路径;视频流走 ffmpeg,风险已在 U4.3/U4.8 分开处理。
- 与旧计划的差异(二轮审查修正):
  1. 新增 §2.3 管线层(多模态未发图、ASR 25MB、无队列、无单实例锁、cache 误删运行中任务);
  2. U1 新增「providers:list 不下发明文 Key」;
  3. U4 重写:ASR 分片从「可选优化」升为必做,新增多模态发图、队列化、单实例锁,断点续传范围修正为仅 HTTP 文件路径;
  4. 修正 U1 中「下载阶段按字节算 percent」的表述(视频流不经 download.ts,字节进度只对 PPT 下载成立)。

## 6. 范围外(保持 MVP 边界)

B 站、云端同步、多用户、本地 ASR、PDF 导出、macOS、课程级追问、流式回答 —— 均不做,除非用户另行批准。

## 7. 待用户批阅的决策点

本计划已含用户确认的三项决策(Preact / 五阶段 / 下载位置两者都要)。实施前仅需对本计划整体批阅;如对阶段取舍或优先级有调整,在此处注明后即可开工。
