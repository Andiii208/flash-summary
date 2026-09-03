# PROGRESS — SEU Summary

> 断点续跑台账：新会话先读本文件和 docs/plans/ROADMAP.md，不重做已完成内容。

## 当前状态

- **已完成阶段**：Phase 0-7、U1-U5、v0.2.0/v0.2.1 已发布；可用性整改 A/B/C（10 提交）；**UX 深审整改 M1/M2/M3 全部落地（方案 docs/plans/2026-09-03-ux-overhaul.md，用户批准「全按推荐」）**
- **进行中**：无——UX 整改 11 提交 + 实测反馈 4 修（F1-F4，2026-09-04）：「我的课程」更名「**我的收藏**」（平台课表与真实安排有出入，课表自动同步方案作废）、已提取/我的收藏 ≥2 门可折叠、侧栏 scrollbar-gutter 修宽度跳变、历史行补**教师·上课时间·教室**、ffmpeg 原始报错纳入人话映射。M1 行为修正 + M2「我的学习」+ Tailwind 基建 + M3 Provider 预设/测试连接/Dialog/ARIA/增量渲染。**四门禁 323/323 + smoke 19/19**，版本 0.3.0
- **下一步**：①用户装 0.3.0 实测验收；②课表探测**已取消**（F1 实测结论：平台「我的课表」与真实安排不符）；③视反馈决定是否推 GitHub Release
- **进行中（旧）**：M1 已交付待用户装机验收（版本 0.3.0-m1）——取消全阶段 ≤2s 生效且如实显示「已取消」、历史 JOIN/删除/清空/筛选、错误人话映射、下载字节+速度、关窗确认、重登重试引导、课程排序升级。四门禁 317/317 + smoke 19/19
- **进行中（更旧）**：可用性整改 A/B/C 七提交（ed30f1c…f627d48，301 测试）
- **进行中（旧）**：无——可用性整改 7 个提交：dev/安装版 userData 隔离（ed30f1c）、会话三态 JWT exp（d9d8dc8）、登录结果一次性反馈（5700b4d）、退出清浏览器状态（34cc0ec）、校园域名代理绕行+Fake-IP 预检（2008610）、课程分页+总量边界（eb1e719）、迁移007 课程元数据+我的课程置顶+同课推荐。四门禁 301/301 + smoke 19/19

## 环境实测（2026-08-30）

- node v24.15.0 / npm 11.12.1 / git 2.53.0.windows.1 / gh 2.89.0（已登录 Andiii208，scopes 含 repo+workflow）
- 本会话 bash 是 cygwin 风格且 PATH 无 Unix 工具：需要时用 `export PATH="/cygdrive/e/Git/usr/bin:$PATH"`，或 `cmd //c`、node 单行脚本替代
- 本会话里 `npm`/`npx` 裸命令会报 "cannot execute"，必须用 `npm.cmd`/`npx.cmd`
- git 仓库级身份已配置：Andiii208 / Andiii208@users.noreply.github.com（全局未配置）

## 阶段记录

| 阶段 | 状态 | 验收结果 | 备注 |
|---|---|---|---|
| Phase 0 | ✅ 完成 | 四门禁 0 退出；CI success（run 33324490350）；私密仓库已建并推送 | 提交 96cbe56、a18f2c6 |
| Phase 1 | ✅ 完成 | 15/15 测试过（迁移/幂等/外键/CHECK）；better-sqlite3 在 Node+Electron 双 ABI 验证可用 | 提交 082b9eb |
| Phase 2 | ✅ 完成 | 37/37 测试过；会话 DPAPI 加密存储、API 客户端错误分类、过期检测三通道 | 提交 2c12993 |
| Phase 3 | ✅ 完成 | 46/46 测试过；失败注入→重试不重复已完成阶段；24h 清理反向验证 | 提交 373ee52 |
| Phase 4 | ✅ 完成 | 62/62 测试过；真实 ffmpeg 音频/关键帧验证；全景流禁下守卫；下载重试 20 次 | 提交 e73a777 |
| Phase 5 | ✅ 完成 | 80/80 测试过；DPAPI 加密 key 字节级验证；能力独立绑定；三类错误分类 | 提交 c5da012 |
| Phase 6 | ✅ 完成 | 96/96 测试过；四视图同源 JSON；追问课时边界；Markdown 导出 | 提交 7d3947e |
| Phase 7 | ✅ 完成 | NSIS 安装包 257.6MB 构建成功（含 ffmpeg）；MVP.md 逐条验收（6 项✅自动化，5 项⚠️待人工） | 提交 7d220af |
| UI 组装 | ✅ 完成 | IPC 16 通道+AppContext+三栏主界面+真实 Electron 烟测通过；修复 gitignore 吞掉 src/main/library 的 CI 失败（7204093 CI success） | 提交 72be62f、7837368、7204093 |
| 增强 | ✅ 完成 | 手动课程/课时 ID 后备入口（spec §2，幂等落库）+ Provider 设置界面（保存并绑定三能力，Key 仅存内存后加密落库）；114/114 测试 | 提交 bf952de |
| 发布事故修复 | ✅ 完成 | v0.1.1 重发：asar 含完整 UI（旧脚手架残留=0）、6 层尺寸图标、桌面/开始菜单快捷方式；release 已上线 | 提交 dfb0af9、tag v0.1.1 |
| U1 主流程修复 | ✅ 完成 | 四门禁绿（128/128 测试，新增 14 个）；真实 Electron 启动烟测通过（页面渲染无错误、toast 区存在）；U1 验收判据「登录→课程树→点课时→创建并运行→实时进度」已接线，真实 CAS/45 分钟端到端仍属人工验证 5 项 | 提交 318d49d（后端）、3356b06（前端） |
| U2 UI 重做 | ✅ 完成 | Preact 引入（preact/hooks、@preact/preset-vite、happy-dom）；组件化（App/Sidebar/TaskPanel/NoteViewer/QaPanel/Toast/EmptyState/ProviderPanel/WelcomeGuide/ManualAdd/TopBar/ProgressBar）；CSS 变量设计系统明暗双主题；CSP 收紧 connect-src 'none'；组件测试 25 个（≥10 达标）；四门禁绿 153/153；真实 Electron 烟测：4 页签+侧栏+引导卡+空态渲染正常无错误 | 提交 afc03a2 |
| U3 设置与下载位置 | ✅ 完成 | 004_settings 迁移（key-value）；IPC settings:get/setCacheDir/setTheme/chooseLibrary/openPath；资料库迁移（SQLite backup API 复制 db+attachments，迁移前备份+失败回滚+重启生效）；notes:exportMarkdown 走系统保存对话框；缓存目录可改即时生效（orchestrator/cache-clean 读设置）；设置页 UI（账号/Provider/位置/主题，主题覆盖明暗）；四门禁绿 169/169（新增 16 测试）；真实 Electron 烟测设置页渲染正常 | 提交 96e7b80 |
| U4 管线质量 | ✅ 完成 | ASR 按 10 分钟分片转写（ffmpeg -ss/-t 切片，拼接保留片偏移，分片进度事件）；多模态真发图（PPT/关键帧 base64 data URL，上限 20 张，unsupported_visual 回退纯文本）；ffmpeg 超时 30min+停滞检测 60s（输出无增长即 kill）+AbortSignal；downloadToFile Range 续传（206 续传/200 重来）；SerialTaskQueue 串行队列+runAsync 入队；单实例锁（二开聚焦主窗口）；tasks:cancel（AbortController+阶段边界 cancelled）；005 error_kind 迁移；缓存清理跳过运行中任务；UI 取消按钮；四门禁绿 187/187（U4 共 +18 测试）；启动烟测通过 | 提交 425a1ae、5c9f5e7、49d8423 |
| U5 基建与文档 | ✅ 完成 | logger（userData/logs 每日轮转 7 份、redact 脱敏 cookie/key/URL、渲染错误经 log:rendererError 入同一日志、设置页打开日志目录）；scripts/release.md 发布清单 + scripts/verify-asar.mjs sha256 抽验 + npm run verify:asar；版本号 0.2.0；README/CHANGELOG 与代码事实同步（28 IPC 通道、32 测试文件、187 用例）；+4 测试 191/191 | 提交 9fbeda5 |
| v0.2.0 发布 | ✅ 完成 | 四门禁绿 191/191；npm run dist 产出「SEU Summary Setup 0.2.0.exe」；asar 抽验通过（out/ 7 文件 sha256 与当前构建一致，tag 同提交构建）；verify-asar 脚本修复 @electron/asar 4.x Windows 路径解析问题（改按 header offset 直读）；tag v0.2.0 + GitHub Release 资产已上传 | 提交 e8ec4de、c22add0、tag v0.2.0 |
| CAS 登录白屏修复 | ✅ 完成 | 用户实测反馈：登录窗口白屏长时间无响应。根因=应用打开的 ids.seu.edu.cn 在用户网段 TCP 不可达（实测 80/443 全超时，而公网/cvs/auth 均可达）；叠加缺陷：失败不关窗/无日志/零反馈。修复：10s 预检 fail-fast、本地 loading 页、25s 首屏超时、ERR_ABORTED 不误判、失败关窗+日志。实测校园网内**登录链路全自动静默完成**（cvs→auth.seu.edu.cn OAuth2 prompt=NONE→跳回 cvs→收割会话→session=logged_in 落盘）。**修正认知：平台登录走 auth.seu.edu.cn 的 OAuth2/RBAC，不经过 ids**；ids 老入口保留为可选 casUrl 覆盖。+4 测试 195/195 | 提交 cas-fix |
| 课程接口校准 | ✅ 主体完成 | 已落地（提交 8dec927）：①SchoolClient 换真实 API base `https://cvs.seu.edu.cn/jy-application-resourcemanage`（API 前缀无 -ui，UI 静态资源才有）；②请求带 `jwt-token` 头（getJwt 注入）；③登录窗口收割 JWT（sessionStorage 键 `jy-application-resourcemanage-ui_STORAGE_KEY_JWT_TOKEN`，appName=pathname 首段），SessionRecord 加 jwt 字段加密落盘；④listCourses 切真实端点 `/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=500`；⑤parser 容错 {code,result:{records|list|rows|data}} 包装 + courId/courName 字段候选。**待真实样本精修：t-1 课程字段名（用户 F12 提供）与课时/视频流接口（播放页 getList/lastPlayInfoById/m3u8）**。接口全景（自前端 bundle 逆向）记于上一次会话台账：/v1/course/verify?courId、/v1/vod/addVodWatchRecord、/v1/list/recentWatchRecord、/v1/config/vodNmediaConfigInfo、/v1/app/info、/resource/resources_tree_me(RBAC 菜单树) | 提交 8dec927 |
| 登录挂起诊断与探测修复 | ⏳ 进行中 | 提交 64a6fce/6f1b3eb/79cca90/e0f2d2a/47a9a46：①登录后探测器探真实端点并带 jwt-token，字段结构记录升级为深度受限递归；②`--seu-trace-keep-window` 保留登录窗；③`--seu-direct-net`（no-proxy-server+disable-quic+disable-async-dns，SEU_DIRECT_NET=1 后备）A/B 开关；④会话探测旧 404 端点 → 真实 t-1 + jwt-token 头；⑤**首帧兜底**：22:49 现场复现三次登录全隐形挂死——本地 data: loading 页未完成、ready-to-show 未触发、25s 平台页预算从未建立（它在 loading 页 resolve 后才启动）、零错误零日志；预算改为建窗即启动覆盖 loading→平台首帧全程，net-trace 增 LOADING page ready/PLATFORM page loaded/FAIL 钉子；⑥渲染层：挂载只读本地树（原来挂载时 listCourses 过期会经 withSessionRetry 自动弹登录窗，用户视角=点了没反应，还叠出 3 个隐形窗）、session_expired 翻徽标为未登录、login() 防重入 + WelcomeGuide busy 禁用。四门禁绿 207/207 | 提交 64a6fce、6f1b3eb、79cca90、e0f2d2a、47a9a46 |
| 组合层体检与质量清理（2026-09-02） | ✅ 完成 | 用户判据「测试全绿 ≠ 组装可用」驱动的全面体检：**L1 CDP 进程级烟测 19/19**（`npm run smoke`：桥面完整性对齐 bridge.ts、IPC 无副作用通道全探活含 3 条错误路径、隔离 userData/资料库下启动组装、首渲染、日志落盘；seam=SEU_SMOKE_USER_DATA+SEU_SUMMARY_DOCS_OVERRIDE）；**L2 SchoolClient 真实 fetch 集成 6/6**（本地 http 服务器全错误分类；证伪 opaqueredirect 疑虑——undici manual 返回可读 302）；**L3 六阶段端到端 1/1**（真实 ffmpeg 合成媒体 + 三合一 mock 服务器，进度序列/产物落库/音频清理/全景零请求全断言）；**发现即修**：probeSaysLoggedIn 收紧到平台信封字段、死 StageOutputStore 层删除（恒假 fast-path + no-op 桩）、死桥 3 通道与死导出 9 处清理、qa.history 接线（追问历史跨会话回显）、gridDecoder 提取补测、@types/mocha 与 vitest 弃用告警清除、migrate 冗余备份删除；**现场取证**：系统代理翻案（见当前状态）。文档对齐 README/MVP/spec。测试 207→221（38 文件） | 提交 408ad93…20df514；报告 docs/health/2026-09-02-combined-audit.md |
| V1 课时详情换源——下载管线全通（2026-09-03 凌晨） | ✅ 完成 | 计划 V1.1-V1.5 全勾销，测试 221→257（40 文件），smoke 19/19。**落地**：V1.0 迁移 006（courses.tecl_id/tecl_code + lessons.play_ref，t-1 字段采集）；V1.1 `play-harvest.ts`（URL 构造/双流判别/直链脱敏/课时条目解析纯函数 + 主窗口导航→轮询 video.src→点选课时→抓目录→恢复 UI）；V1.2 fetching_course 换源（收割直链走阶段交接，lessons 表只存脱敏路径）；V1.3 `school:harvestLessons` 通道 + 课程树「抓取课时目录」按钮（展开空课程触发，幂等 upsert+陈旧行清理）；V1.4 **真实单课全管线 succeeded**（1690625-L0：双流 810MB 下载→音频→24 片真实 MiMo ASR→11 段 4108 字真实转写→17 关键帧→mimo-v2.5 笔记 3812B 落库→缓存清理）；V1.5 红线审计 0 违规（日志 0 命中 auth_key/直链/JWT；lessons 表直链 0 带 query）。**现场发现并修复 8 个真实缺陷**（详见关键决定记录 2026-09-03 批注）：①窗口 cookie 罐空→session.bin 注入 ②SPA 鉴权靠 sessionStorage JWT→seedSessionStorage 种入 ③teacher 流无音频→pickAudioSource ffprobe 回退 screen 流 ④chat() body 是 plain object 被 undici 发成 "[object Object]"→JSON 序列化（潜伏 bug！）⑤MiMo ASR 走 chat/completions+input_audio→multipart 404 自动回退+按 baseUrl 记忆（网关对反复大 body 404 会 RST）⑥base64 实测上限 ~7MB（文档写 10MB）→分片 120s ⑦静音分片不应杀任务→跳过，全静音课明确报错 ⑧模型输出偏差→parseNote 归一 mm:ss/数字串时间戳、按 ref 前缀修 evidence.kind、JSON 修复层、response_format json_object。分片转写加重试（网络/限流 3 次）；network 错误带 cause 链 | 提交 c9fc81f、9075b20、e39cedf、3772c58、25ca3e4、7c8f562、af47aa9、f55d099 |
| 人性化功能包 + UI 彻底升级（2026-09-03 上午） | ✅ 完成 | **功能**：侧栏课程搜索（课程/教师/学期/课时名即时过滤，命中自动展开）；课程树默认收起+课时数徽标+全部展开/收起；渲染器重载后从全局任务表恢复运行中任务的实时状态（窗口导航不再丢任务视图）；TopBar 任务运行指示灯（脉冲点）；任务页新增「全部任务」视图（跨课时最近 50 条，状态徽章着色）；笔记新增「复制 Markdown」到剪贴板。**UI 彻底重做**（style.css 全量重写 + 任务卡阶段轨道）：«quiet academia» 设计语言——分层中性表面+靛蓝→紫渐变强调色、渐变品牌标、会话/运行胶囊指示器、分段式页签、课程卡片悬浮抬升、任务卡六步管线阶段轨道+进度流光动画、历史状态徽章按状态着色、问答气泡、卡片式 toast 滑入动画、纤细滚动条、focus-visible 焦点环、reduced-motion 支持；暗色主题同套令牌调校。**验证**：四门禁 257/257+smoke 19/19；真实资料库（500 门课+已生成笔记）双主题 CDP 截图逐视图自检（任务/笔记/暗色），期间发现并修复「旧 bundle 假象」与 aria-expanded 全 true 的初始状态误判（重启后确认收起默认正确） | 提交 cbaf418、be83f1d |
| V2 登录流程产品化（2026-09-03） | ✅ 完成 | 计划 V2.1-V2.5 全勾销，测试 257→272（41 文件），smoke 19/19。**落地**：V2.1 `main-window-login.ts`——loginViaMainWindow 主窗口内嵌登录（第二渲染器彻底退役），三信号监听+probe 权威收割；V2.2 login() 分流接线（withSessionRetry 语义不变，仅用户主动动作触发重登）；V2.3 renderer fire-and-forget + `school:session` 新增一次性 justLoggedIn 标志（fresh mount 消费→自动刷新课程）；V2.4 `SEU_LOGIN_WINDOW=1` 回退旧登录窗（cas-login.ts 保留不删）；V2.5 **活体全链路通过**：logout（session.bin 清除）→点「登录 CAS」→主窗口导航→RBAC 授权→probe 确认→收割→自动回 UI→自动刷新 636 门课落库（fetched_at 铁证）。**活体揪出并修复 3 个真实缺陷**（详见关键决定记录 2026-09-03 批注）：①SSO 回跳立即收割 → 401 会话（OAuth 回调链未 settle）→ probe（t-1 业务信封）改为唯一权威完成信号；②HTTP 401 被分类 bad_response → withSessionRetry 永不触发重登 → 401 归类 session_expired（jwt-token 时代平台裸 401，不再 302 跳 CAS）；③门户根不写 SPA JWT（jwtPresent:false 活体取证）→ 登录入口改为 resourcemanage-ui SPA 本身（其自带 RBAC/OAuth 往返，回跳即签发 JWT）。**现场环境结论**：主窗口白屏=系统代理（规则模式）代理了教育网域名致静态资源加载失败；`SEU_DIRECT_NET=1`（no-proxy-server）绕过，与代理上 GitHub 互不影响 | 提交 6ef1168 之后的 4 个（V2 主体、probe 权威、401 分类、-ui 入口） |
| UI 发布前小修 + V4.1 补测（2026-09-03 下午） | ✅ 完成 | **UI 审查（Explore agent 全量过 renderer 代码）→ 发布前 5 点修复**（提交 3da782a，测试 272→273）：①`.item` 基底 padding 级联覆盖 .course-item/.history-row（重做稿视觉规格实际未生效）；②追问面板无课时锁输入（原静默 no-op 死端）+提交按钮入 primary 层；③「刷新课程」busy 态（禁用+「刷新中…」）+非过期失败 toast（field case 2026-09-01 同类坑）；④删除 Provider 加 confirm + 启用从未使用的 danger 样式；⑤浅色 --text-muted #79818f→#667085（3.9:1→5.0:1 达 AA）。**发布后迭代清单 12 条记入 PROGRESS 遗留节**。**V4.1 补测**（用户退出 Clash 后，task-1788418654762-inwmnf）：收割→下载→音频→转写→关键帧→总结全链 **succeeded**（7 分钟，凌晨缓存 24h 内复用生效）；**auth_key TTL 实测结论：直链 auth_key 时间戳为昨日 22:57（V1.4 时期），8 小时后下载仍成功——静态绑定签名而非短时效令牌，长课下载中途过期风险解除**；重启免登录顺带验证（session.bin 03:21 收割沿用）；红线抽查日志 0 命中、lessons 表 0 泄漏、笔记 5266B 落库 | 提交 3da782a、269df84（测试数同步） |
| v0.2.1 发布（2026-09-03） | ✅ 完成 | 四门禁 273/273 + smoke 19/19 + CI 绿；CHANGELOG/README/MVP 全量对齐（人工验收 4/5 ✅，干净机器项用户决定跳过并如实标注）；TEMP 遗留 577 项（27MB，含疑似敏感残留）已全部清理；发布按 scripts/release.md 清单执行：最终 dist → verify:asar → tag v0.2.1 → GitHub Release（资产与 tag 同提交构建——0.1.0 事故纪律） | 见发布提交 |
| 可用性整改 A/B/C（2026-09-03 晚，用户实测反馈） | ✅ 代码完成 | **用户实测安装版三大症状根因全部取证定位**：①安装版与 dev 共用 userData（productName 不在 package.json 顶层，app.getName()=seu-summary）→「已登录」是 dev 会话泄漏；②listCourses 只抓 t-1 全校列表（648页×500）第 1 页 → 用户课程从未被抓到；③当日 17:52 cvs 被 ERR_CONNECTION_CLOSED 断连（ClashMI 规则再丢嫌疑）+ 登录失败反馈随 renderer 卸载而静默。**修复 7 提交**：dev userData `-dev` 后缀隔离（ed30f1c）、会话三态 JWT exp 本地判定 + TopBar/设置页（d9d8dc8）、loginOutcome 一次性通道（5700b4d）、logout 清 cookie 罐/localStorage（34cc0ec）、`*.seu.edu.cn` 代理绕行 + netCheck Fake-IP 预检带修复指引（2008610）、分页拉取 + courseListMaxPages 设置 + 进度事件 + 已加载/全校边界明示（eb1e719）、迁移007（subj_code/classroom/cour_times/is_mine）+ 星标我的课程置顶 + subjCode 同课推荐 + 课程卡时间/教室副行。**四门禁 301/301 + smoke 19/19**；方案与决策点见 docs/plans/2026-09-03-usability-overhaul.md（已批准） | 提交 ed30f1c…（7 个） |

## 遗留（诚实清单）

- **UI 发布后迭代清单（2026-09-03 审查产出，按性价比排序；发布前 5 个小点已修）**：①浅/深主题页签 ARIA 收口（tablist 无方向键导航——去 role 或补全，二选一）；②主窗口 `minWidth/minHeight` + `backgroundColor`（防白闪，主进程单行）；③空态样式统一（EmptyState 卡 vs `.msg` 灰字两级待遇）；④ProviderPanel h2 跳级 + NoteViewer 缺页标题；⑤资料库迁移按钮加 busy 防护；⑥失败时表单过早清空（ManualAdd/ProviderPanel 的 Key）；⑦课程树截断文本补 title；⑧死令牌清理（--bg-tint/--warning 系）与深色令牌块去重；⑨错误 toast 用 assertive（role=alert）；⑩搜索防抖；⑪回车提交行为统一；⑫侧栏可折叠。审查详情见提交记录。

- **UI 主界面组装 ✅ 已完成**（提交 72be62f/7837368，2026-08-30）：AppContext（资料库+会话+Provider+媒体路径组装）、IPC API surface（school/providers/tasks/notes/qa 共 16 通道）、preload 桥接（SeuSummaryBridge 类型化）、renderer 三栏主界面（课程列表/任务面板/四视图笔记+追问）。真实 Electron 启动烟测通过：7 秒运行日志干净、资料库三目录+app.db 正常建立、renderer 标题正确。112/112 测试绿。
- **需人工验证的 5 项**：见 docs/acceptance/MVP.md（干净机器安装、真实 CAS 登录、真实课程拉取、45 分钟端到端、过期重登恢复）——其中「过期重登恢复」已于 2026-09-03 活体验证通过（V2.5，见阶段记录），待 V4.4 收口时在 MVP.md 归档为 ✅。
- **待确认删除项**：①构建产物 release/ 已 ignore，未入库；②**系统 TEMP 有 567 个历次会话遗留的 seu-* 调试文件**（含 seu-cookie.b64 疑似 cookie 残留、若干 .mjs/.cjs 探针与日志缓存目录）——不入 Git 但有敏感残留风险，建议清理（待用户确认后执行）。

## 失败与卡点

- **dncvsvod 视频服务器网络层不可达（2026-09-03 上午起；当日定性并验证恢复：代理 TUN 分流，非平台问题）**：`dncvsvod.seu.edu.cn` 纯直连 TCP/TLS 即被 RST，同路径对照 cvs=200、auth=404、公网=200。**定性证据**：系统 DNS 为 `172.19.0.2`、域名解析 `172.19.0.38`（Clash Meta TUN 的 fake-ip 虚拟网段），路由表存在 **Meta Tunnel** 网卡——Clash TUN 模式接管全部流量（含不走系统代理的 node/Electron），dncvsvod 未命中直连规则被送去代理出口，代理侧无法进校园视频网即 RST。**恢复验证（当日）**：用户完全退出 Clash → DNS 返回真实 IP `58.192.114.3`、dncvsvod HEAD 200 → 收割/下载立即可用，全管线任务 succeeded。**解决方案（用户侧，不改代码）**：Clash 规则加 `DOMAIN-SUFFIX,seu.edu.cn,DIRECT` 或退出 TUN。README troubleshooting 已收录（教育用户高频坑）。

- **Chromium 第二渲染器环境级故障（2026-09-02 晚定论，与代理无关）**：与用户实时联测定论——**本机 Electron 的第二个渲染器永远不加载**：登录窗无论 data:/http(s)/file:// 的 loadURL 都只 NAV start 不 commit；`window.open` 返回窗口对象但 target title 永空；CDP `Target.createTarget` 调用本身挂死；而主窗口（第一个渲染器）的 file:// 加载完美（烟测 19/19 全绿即单窗口验证）。已排除：代理（用户退出 Clash Mi 且 ProxyEnable=0）、session 分区（defaultSession 同挂）、沙箱（--no-sandbox 同挂）、scheme（file:// 同挂）、GPU/遮挡计算（--disable-gpu + CalculateNativeWinOcclusion 关闭同挂）。同期环境异常：better-sqlite3 从 node_modules 无声消失（疑似安全组件隔离，重装恢复）。**应用侧已做防御**（001e6c4）：loading 页改 file:// 临时文档 + renderer 侧跳平台、首帧预算/探针移入 did-navigate——环境修好后登录链路即用最可靠路径。**根因三嫌疑**（按可能性）：①安全组件注入（Windows Defender 实时防护开着；试加排除目录）；②Windows build 26200（Insider 级超新 build）× Electron 44/Chromium 152 兼容 bug；③虚拟显示驱动/输入法 hook（百度输入法在跑、用户用远程工具）。**V2 之后独立登录窗已退役**（SEU_LOGIN_WINDOW=1 才启用），此项不再阻塞任何功能；排查仍有价值（定位本机环境问题），穿插进行。

- **v0.1.0 发布事故（已修复，2026-08-31）**：tag 打在最新提交但发布资产是 Phase 7 时点的旧构建（asar 含脚手架页，无 UI/Provider 代码），且无应用图标、oneClick 静默安装无桌面快捷方式。根因：打包（7d220af）之后又提交了 UI 组装/Provider 等功能但从未重新 `npm run dist`，而发布时未校验资产与 tag 一致。教训已记入 CHANGELOG 0.1.1：**发布资产必须在打 tag 的同一提交上构建，发布前用 @electron/asar 抽验包内产物**。

## 关键决定记录

- **V2 登录（2026-09-03）**：①**probe 是唯一权威完成信号**——t-1 课程列表端点 + 业务信封判定；did-navigate 的 SSO 回跳与 sessionStorage JWT 出现只触发一次立即探测。理由：SSO 回跳瞬间 OAuth 回调链尚未 settle、门户页不写 JWT，立即收割产出 401 会话（活体实测）；probe 成功 ⟺ listCourses 可用，收割时点必然有效。②**登录入口 = resourcemanage-ui SPA 而非门户根**——JWT 只有该 SPA 的 RBAC/OAuth 往返才签发（写入 `jy-application-resourcemanage-ui_STORAGE_KEY_JWT_TOKEN`），门户根永远写不出（活体取证 jwtPresent:false）。③**HTTP 401 → session_expired**——jwt-token 时代平台对无会话请求裸 401 JSON，不再 302 跳 CAS；CAS 重定向三通道保留。④**justLoggedIn 一次性标志**挂在 school:session 上——主窗口导航会卸载 renderer，登录完成只能由 fresh mount 感知；mount 平台仍不做网络刷新（防未登录时自动拉起登录页），仅消费该标志时自动刷新（此时会话刚建立必有效）。⑤登录期间主窗口被平台页占用、无「取消」按钮，用户中止=关应用（登录输入不限时，与旧登录窗语义一致）；窗口导航期间 renderer 卸载，login invoke 挂起无副作用。⑥主窗口导航到平台时 preload 桥仍注入平台页面（V1 收割已有先例，可信学校平台、通道均只读，风险可接受）。
- **V1 管线（2026-09-03）**：①fetching 收割的完整签名直链只在 task_stage_outputs 里做阶段交接（随缓存清理），lessons 表只存去 query 的路径段（红线 V1.5）；②auth_key TTL 未实测——下载失败重试若因签名过期，需重跑任务从 fetching 重新收割（V4.1 45 分钟端到端前实测）；③窗口内导航（收割/后续登录）会让渲染器卸载重载：renderer 侧 fire-and-forget，回来后 mount 重读本地树；导航期间 tasks:progress 事件丢失，任务实际不中断；④课程树默认全展开 + 每目录抓取需开一次播放页——500 门课不做全量抓取，用户对哪门课感兴趣点哪门。
- **U1 重试统一走 runAsync（2026-08-31）**：后端 `tasks:runAsync` 的 `firstStageFor(state, failed_stage)` 对 failed 任务自动从失败阶段恢复，语义等同 retryTask；前端「重试」不再调阻塞式 `tasks:retry`，统一非阻塞路径，避免 UI 冻结。更简单方案，符合计划「选更简单方案」约定。
- **U2 组件测试环境分治（2026-08-31）**：vitest 默认环境保留 `node`（main 层测试用真实 fetch/better-sqlite3），仅 `tests/components/**` 用 `happy-dom`——否则 happy-dom 的 CORS fetch 会弄挂 downloadToFile 测试。交互用 `preact/test-utils` 的 act 包裹以 flush 异步批处理。
- **U2 Provider 管理暂留「设置」页签（2026-08-31）**：计划 U2 主区页签为 任务/笔记/追问，但 Provider 表单必须保留且 U3 才做完整设置页，故先以第四个页签「设置」承载 ProviderPanel，U3 增量扩展资料库/缓存/主题。
- **U3 资料库迁移后重启生效（2026-09-01）**：计划任务 2「设置变更后即时生效」针对 cacheDir（orchestrator 每次读设置，已即时生效）；资料库迁移涉及重开 db 与 stageOutputs 等运行时单例，热切换复杂易错，选「迁移完成写 settings.libraryRoot + 提示重启」更简单可靠（计划未强制迁移即时生效）。
- **U3 缓存目录用文本输入而非对话框（2026-09-01）**：cacheDir 变更走输入框+保存（后端校验可写），比多一个 chooseCacheDir 对话框通道更简单；资料库位置必须走目录选择对话框（用户选空目录），两者分工与计划一致。
- **U4 ASR 分片取固定 10 分钟边界而非静音对齐（2026-09-01）**：计划允许二选一；静音对齐需额外 ffmpeg silencedetect 解析+切点回退逻辑，固定边界更简单可靠，截断只影响段边界一句话（记录取舍）。分片拼接以片起始时间为段 at（provider 不返回时间戳），整段音频转写成功后删除。
- **U4 重试统一走 runAsync + 串行队列（2026-09-01）**：runAsync 在 main 侧 SerialTaskQueue 排队，同一时刻至多 1 个任务；tasks:cancel 对未运行任务直接标记 failed(cancelled)，运行中经 AbortController 在阶段边界取消并 kill ffmpeg。
- **session_expired 重登重试（2026-08-31）**：`school.login` 会打开 CAS 登录窗口（用户交互），故不做静默自动重登；invoke 通道用 `withSessionRetry`（shared/session-retry.ts，纯函数可测），任务运行中会话过期则在 toast 提示 + 登录按钮高亮，用户重登成功后手动重试历史任务。
- **挂载（mount）只读本地课程树，不自动刷新网络（2026-09-01）**：原实现挂载即 listCourses，过期会话会经 withSessionRetry 自动拉起登录窗，叠加首帧挂起后用户视角是「点了没反应」；改为挂载只调本地 courseTree，网络刷新留在显式「刷新课程」按钮后（spec §2 的自动重登语义仅保留给用户主动动作）。
- ROADMAP 按 leader 方法论写入 docs/plans/ROADMAP.md：8 阶段（0-7），每阶段含验收命令与完成判据（2026-08-30）。
- 上传超时重试上限设为 20 次（用户要求，网络不稳定环境下的长程任务保障）。
- electron 选 ^44.0.0：^37 有 2 个 high 漏洞（extract-zip 路径穿越等），npm audit 清零。
- package.json 设 `type: module`（eslint.config.js 按签名警告改为 ESM 解析）；preload 构建输出 `.cjs`（CommonJS），避免 sandbox preload 与 `type: module` 的 `.js`-当-ESM 解析冲突，main 中 preload 路径相应为 `../preload/index.cjs`。
- better-sqlite3（同步 API、Electron ABI Prebuild 可用）而非 sql.js：Node/Electron 双 ABI 实测通过，无需 rebuild。
- 迁移机制：`schema_migrations` 版本表 + 事务内应用；001_initial 建全 8 表，002 加 task_stage_outputs 证据表，003 加 providers/capability_bindings。
- ffmpeg 分发：ffmpeg-static/ffprobe-static（6.1.1）随 npm 安装，electron-builder extraResources 打入安装包 resources/ffmpeg/，用户无需自装 ffmpeg。
- 下载重试上限 20 次（与用户要求的会话重试上限一致），指数退避封顶 30s。
- schema/views/markdown 纯逻辑放 src/shared/notes/，main 与 renderer 共用单一事实源。
