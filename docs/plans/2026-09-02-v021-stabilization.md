# v0.2.1 稳定化与发布计划（2026-09-02 深夜定稿）

> 断点续跑：本计划接续 PROGRESS.md「当前状态」。执行前先读 PROGRESS 与
> `docs/health/2026-09-02-combined-audit.md`。每阶段完成即更新 PROGRESS 台账并
> 独立提交（Conventional Commits）；提交前 `npm run lint && npm run typecheck && npm test`
> 全绿，涉及构建产物的阶段加跑 `npm run smoke`。

## 0. 背景快照（2026-09-02 深夜）

- **可用状态**：会话注入成功 → 应用 `logged_in`，刷新课程拉回 500 门真实课程，
  课程名/学期正确渲染（c80d82f）。会话有效期内应用整体可用。
- **环境故障（已定性）**：本机 Electron 第二渲染器永不加载 → 独立登录窗口不可用。
  主窗口（第一渲染器）的 file:// 与 http(s) 导航全部正常。
- **已侦察完毕的接口事实**（详见记忆与 355d68f）：
  - 课程列表：`GET /jy-application-resourcemanage/v1/group_subject_vod_list/t-1?page.pageIndex&page.pageSize`
    → `{code,data:{records:[{id,subjName,teacNames[],acyeBeginYear/acyeEndYear,teclId,teclCode,...}]}}`
  - 播放页路由：`/jy-application-resourcemanage-ui/#/play-video?courseId=&teclId=&teclCode=`
  - **视频直链 = 播放页 video.src**：`https://dncvsvod.seu.edu.cn/.../SVR-CLOUD-*.mp4?auth_key=...`
    （双 video：教师流+屏幕流；mp4 非 m3u8；auth_key 签名有时效）
  - `/v1/vod/getList|lastPlayInfoById` 存在但 GET 缺参 500、POST 不支持——**放弃猜参数，走 DOM**
  - 课时目录可从播放页 DOM 抓取（「第N节课」条目）
- 红线提醒：视频直链（含 auth_key）与 cookie/JWT 不落日志、不入 Git；入库的
  stream_urls_json 必须脱敏（见 V1.5）。

## V1 课时详情换源 —— 下载管线全通（预计 1 个会话）

**目标**：fetching_stage 拿到真实双流 URL，下载/音频/关键帧阶段在真实数据上跑通。

- [ ] **V1.1 新模块 `src/main/school/play-harvest.ts`**：
      `harvestLessonDetail(win, { courseId, teclId, teclCode }) → { teacherStreamUrl, screenStreamUrl }`
  - 在传入的 BrowserWindow 上导航播放页路由（复用 cas-login 的钉子与 25s 首帧预算模式）
  - 等待 `video` 元素出现（第二个 video 出现 = 双流就绪），读 `currentSrc`
  - 完成后**必须导航回应用 UI**（`loadFile` renderer index），失败也要回（finally）
  - 不新建窗口（环境故障），只在主窗口内跳转
  - 测试：纯逻辑部分（URL 判别、video 等待谓词）单测；DOM 依赖部分以集成探针脚本验证
- [ ] **V1.2 fetching_course 切换**：orchestrator 的 lessonDetail 路径改为调用 play-harvest；
      SchoolClient.lessonDetail 保留（接口未来修好可回切）
  - 依赖注入：win 通过 AppContext 暴露（`ctx.mainWindow()` 或注册时传入）
- [ ] **V1.3 课时目录抓取**：播放页 DOM「第N节课」清单 → lessons 落库（幂等 upsert），
      课程树展开即见真实课时； teclId 映射随 DOM 抓取一并提取
- [ ] **V1.4 真实单课验证**：真实一节课创建任务，逐阶段观察：
      fetching → downloading（mp4 直链 + Range 续传 + ffmpeg `-c copy`）→ extracting_audio →
      extracting_visuals。ASR/总结阶段用 mock Provider 或真实 Key（若已配置）
  - 风险①：auth_key 时效 vs 下载时长——先实测 auth_key TTL；超时长下载需「重新收割再续传」
  - 风险②：dncvsvod 可能校验 Referer/UA——downloadToFile 按需补请求头
  - 风险③：任务运行中主窗口被关 → 收割失败——文档标注「收割期间勿关窗」，重试语义不变
- [ ] **V1.5 红线合规**：lessons 表/日志中的流 URL 去除 auth_key 参数（存路径段）；
      playwright/探针脚本不入 Git 的临时产物确认清理
- **验收**：`npm test` 全绿（≥222）+ 真实单课跑通 fetching→visuals + 日志抽查无敏感值

## V2 登录流程产品化 —— 主窗口内嵌（预计 1 个会话）

**目标**：会话过期后的重登体验闭环，登录窗退役（保留回退开关）。

- [ ] **V2.1 `loginViaMainWindow(win)`**（新模块或并入 cas-login.ts）：
  - 主窗口导航到平台登录入口（cvs → SSO → 需要时 auth 登录页，用户在主窗口内输入）
  - 完成信号复用：did-navigate 离开 origin 又回到 origin + sessionStorage JWT 轮询
  - 收割用**应用自身能力**（无需 CDP）：`win.webContents.session.cookies.get` +
    `executeJavaScript` 读 JWT → `saveSession`（应用 cryptor，天然兼容）
  - 完成后主窗口 `loadFile` 回应用 UI；全程 toast 提示「正在跳转登录…」
- [ ] **V2.2 过期重登接线**：`withSessionRetry` 的重登动作改为 `loginViaMainWindow`
      （保持 2026-09-01 语义：仅用户主动动作触发）
- [ ] **V2.3 renderer 适配**：主窗口跳转期间的状态提示与按钮禁用；登录完成事件通知
- [ ] **V2.4 回退开关**：`SEU_LOGIN_WINDOW=1` 时仍走旧 BrowserWindow 路径
      （环境故障修复后可恢复独立窗口）；cas-login.ts 保留不删
- [ ] **V2.5 会话过期恢复验证**：手动使 session.bin 失效 → 点刷新 → 主窗口登录 → 回应用 → 刷新成功
- **验收**：V2.5 全流程人工走通 + `npm test` 全绿 + smoke 全绿

## V3 环境故障根因（用户配合，穿插进行）

- [ ] 重启电脑 → `npx.cmd electron .` → 临时开 `SEU_LOGIN_WINDOW=1` 试旧登录窗
- [ ] 无效则 Windows 安全中心排除 `E:\SEU summary` → 复测
- [ ] 无效则退百度输入法 / 远程控制工具逐个排查
- **产出**：结果记入 PROGRESS；修复则 V2.4 的独立窗口可回归默认

## V4 MVP 验收与 v0.2.1 发布（预计 1 个会话 + 人工配合）

- [ ] **V4.1 ≥45 分钟真实课端到端**（含真实 Provider Key；今晚已确认下载链路可行后执行）
- [ ] **V4.2 干净机器安装**：NSIS 包在无开发环境 Windows 机器双击安装、启动、登录、拉课程
- [ ] **V4.3 会话过期恢复**（V2.5 通过后归档为已验证）
- [ ] **V4.4 发布收口**：README/CHANGELOG/MVP.md 全量对齐（数字、新登录交互、
      播放页直链方案的隐私说明）→ 版本号 0.2.1 → `npm run dist` →
      `npm run verify:asar` → tag + Release（资产必须与 tag 同提交构建——09-01 事故教训）
- **验收**：MVP.md 第 11 条 10 项全部 ✅ 或有明确残留标注；Release 资产在线

## 执行顺序与依赖

```
V1（管线全通）──► V4.1（45min 端到端）──┐
V2（登录闭环）──► V4.3（过期恢复）──────┼──► V4.4（发布）
V3（环境排查，穿插）───────────────────┘
```

V1、V2 相互独立可并行；V4 依赖前两者。每个「会话」以 PROGRESS 断点续跑。
