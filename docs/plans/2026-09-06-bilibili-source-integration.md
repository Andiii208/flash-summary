# B站视频源接入：功能更新与适配计划

> 状态：**待 Andiii 审阅**（方案先行，未动代码）
> 日期：2026-09-06
> 前置调研：本文所有 B 站 API 均为 2026-09-06 现场实测或从活跃开源项目源码/B 站 API 文档镜像查证，非凭记忆。

---

## 0. 一页摘要

在不动校内平台一行逻辑的前提下，给 SEU Summary 增加「B站视频 → 笔记」能力：

- **核心路线 = 阿哔视频总结的思路 + 我们的 ASR 优势**：登录 B 站后直拉现成字幕（CC/AI 字幕，带时间戳），跳过下载与 ASR，直接进现有笔记生成链路；视频无字幕时回退到「下载 DASH 音频流 → MiMo ASR」——这是阿哔类纯字幕插件做不到的兜底。
- **现有六阶段任务系统、笔记生成、五视图、导图、QA、导出、Provider 层全部原样复用**（它们本来就是源无关的）；需要动刀的是收割分叉、下载器单流假设、数据模型加 source 列、三个域名白名单。
- **B 站登录用扫码**：应用内画二维码轮询，拿到 SESSDATA 后 DPAPI 加密落盘，完全复用现有凭据红线模式。
- **规模控制**：MVP 只做「单个视频 URL/BV号（含多P）导入」，不做收藏夹/UP主批量/搜索；分 6 批实施，每批独立可验收。

---

## 1. 背景与目标

### 1.1 为什么是 B 站

东南大学校内录播平台功能已趋完善（v0.5.0，531/531）。扩大可用视频源时发现：南大、武大、华科等高校均无校内公开录播平台，而 B 站承载了大量高校课程录像（很多课程直接搬运/录制于这些学校）、公开课、技术教程——是现实中最丰富的中文学习视频源。

### 1.2 调研对象

| 对象 | 形态 | 结论 |
|---|---|---|
| 阿哔视频总结 | Edge/Chrome 插件 | 提取 B 站字幕 → LLM 总结。**纯字幕路线，无字幕即无解** |
| BiliNote（7.2k star，活跃维护） | 桌面应用（React+FastAPI+Tauri） | 与本产品同构：字幕优先 → yt-dlp 音频下载兜底 → Whisper ASR → LLM 结构化笔记。是本计划最重要的工程参照 |
| bilibili-API-collect | API 文档社区仓库 | **2026-01-28 收到 B 站律师函，原仓库永久关停删库**；镜像仍在更新（详见 §6 合规） |
| bilibili-subtitle / Bilibili Copilot / BiliStudy 等 | 浏览器插件 | 全部同一路线：player API 抓字幕 |

### 1.3 目标与非目标

**目标**：
1. 用户贴一个 B 站视频链接（或 BV 号），软件生成与校内课程同规格的结构化笔记（五视图、导图、时间线配图、Quiz、追问全支持）。
2. 校内平台功能零回归——所有改动以「加分支/加列/加白名单」为形式，不重构现有 SEU 链路。
3. 有字幕秒出笔记（省下载省 ASR），无字幕自动回退 ASR。

**非目标（MVP 不做）**：
- 收藏夹/UP 主/合集批量导入（后续版本）
- B 站内搜索、榜单、推荐
- 弹幕、评论、互动视频
- 下载视频持久化到 Library（同 SEU 模式：抽帧后即删）
- 会员专属/充电专属/付费试看视频（明确拒绝并提示，见 §5.9）

---

## 2. B 站侧技术事实（全部实测/查证于 2026-09-06）

### 2.1 API 清单与登录要求

| API | 端点 | 无登录可用 | 实测结果 |
|---|---|---|---|
| 视频信息 | `GET api.bilibili.com/x/web-interface/view?bvid=` | ✅ | code=0，返回 title/cid/aid/duration/分P pages[]/UP主 mid/封面 pic |
| 字幕列表 | `GET api.bilibili.com/x/player/wbi/v2?bvid=&cid=` | ⚠️ 可调但空 | code=0 但 `subtitles=[]`、`need_login_subtitle=true` ——**字幕必须 SESSDATA 登录态** |
| 字幕文件 | subtitle_url（B 站已签名的完整地址） | 跟随列表 | JSON `{body:[{from,to,content}]}`，`from/to` 为秒——与现有 `transcripts.segments_json` 结构同构 |
| 视频流 | `GET api.bilibili.com/x/player/wbi/playurl?bvid=&cid=&fnval=16` | ✅（try_look=1） | 实测无签名无登录也返回 code=0；DASH 含 3 条独立音频流（id=30216=64kbps mp4a）。**但执法不严 ≠ 无风险**，BiliNote 需打 dm_img 补丁（§2.3） |
| AI 视频总结 | `GET .../view/conclusion/get` | ❌ | 无登录 -403；需 SESSDATA + WBI 签名。返回官方 AI 摘要+带时间戳提纲。**仅作可选优化，不作为依赖**（我们自己的 LLM 笔记质量更高） |
| WBI 签名 key | `GET api.bilibili.com/x/web-interface/nav` | ✅ | code=-101（未登录）但 `wbi_img` 照常返回 img_key/sub_key |
| 扫码登录 | `GET passport.bilibili.com/x/passport-login/web/qrcode/generate` + `/poll` | ✅ | 状态机 86101 未扫/86090 已扫未确认/86038 过期/0 成功；成功后 Set-Cookie `SESSDATA`/`DedeUserID`/`bili_jct` |

### 2.2 字幕选择策略（照抄 BiliNote 实战验证过的优先级）

`人工 zh-CN > AI zh-CN（ai-zh）> 任意中文 > 任意非空`。注意 `lan` 形如 `zh-CN`/`ai-zh`，`ai_type` 区分人工/AI。字幕轨的 `subtitle_url` 以 `//` 开头需补 `https:`。

### 2.3 风控现状（关键工程风险）

- **dm_img 风控**：2026-06 起 B 站 playurl 网关对缺 `dm_img_list/dm_img_str/dm_cover_img_str/dm_img_inter/web_location` 指纹参数的请求回 **HTTP 412**（部分视频、按需触发，非全量）。BiliNote 的解法是注入「格式合法的 dummy 值」并在 WBI 签名前合并——已开源验证可行，直接照抄值形态。
- **CDN Referer 鉴权**：`platform=pc` 的流地址有 referer 鉴权，下载必须带 `Referer: https://www.bilibili.com`。
- **流地址 120 分钟失效**（对比 SEU auth_key 的 6h）——resume 逻辑需按源配置新鲜度阈值。
- **SESSDATA 有效期**约 1~2 个月，过期需重扫。

### 2.4 WBI 签名实现量

nav 拿 img_key/sub_key → 按 64 项固定混淆表（mixinKeyEncTab）取前 32 字符得 mixin_key → `md5(排序后的 query + mixin_key)` = `w_rid`。约 30 行纯 TS，无依赖新增（Node 自带 crypto）。

### 2.5 字幕覆盖率（决定 ASR 兜底的必要性）

AI 字幕由 B 站语音识别离线生成，**覆盖率不满**（新视频/冷门视频/部分分区无）。阿哔类插件遇无字幕视频直接无解；我们有现成 MiMo ASR 链路，这是产品层面的差异化优势，**兜底路径必须做**。

---

## 3. 现有架构盘点（接入缝隙地图）

> 详见 2026-09-06 Explore 报告，此处只列结论。

**直接复用（源无关，零改动）**：六阶段任务系统（serial-queue/stages/resume/取消/进度）、ASR 切片与分片 checkpoint、笔记生成（summarize.ts 提示词 + Note schema + 归一层）、五视图/课程导图/时间线、QA、md/Anki/SVG/PDF 导出、Provider 层（per-capability 绑定）、IPC `handle()` sender 校验框架、测试四层模式。

**必须动刀的 6 处缝隙**：

| # | 位置 | 现状 | 改法 |
|---|---|---|---|
| 1 | `orchestrator.ts makeFetchCourse` | 写死「有 teclId→播放页收割，否则 lessonDetail」 | 按 `lesson.source` 分支：SEU 走原逻辑，bilibili 走新 `fetchBilibili` |
| 2 | `orchestrator.ts makeDownload` | teacher+screen 双流齐备才跑、全景流硬编码 1170194 | 参数化：按源给「流清单」——SEU 双流、B站单流（视频 or 音频） |
| 3 | 数据模型 | courses/lessons 无 source 列 | migration 009 加 `source`（默认 'seu'）+ B 站元数据列 |
| 4 | 三个白名单 | `NAV_ALLOWED_HOST_SUFFIXES`/`PROXY_BYPASS_RULES`/netCheck hosts 全 SEU | 加 bilibili 域（api.bilibili.com / passport.bilibili.com / *.bilivideo.com / b23.tv）；netCheck 增加 B 站探活 |
| 5 | 转写硬依赖 | `transcribing` 必须有 extracting_audio 产物 + ASR binding | 字幕旁路：fetching_course 阶段拿到字幕即直插 `transcripts` 行；`transcribing` executor 检测到已存在 → 秒过（resume 的 resolveResumeStage 同步兼容） |
| 6 | 凭据单源假设 | `school-session/session.bin` 单文件 | 新增 `bilibili-session/session.bin`，复用 Cryptor/SessionRecord 模式（baseUrl 字段天然支持） |

**不做的**：正式的「视频源接口」抽象层。只有两个源，按 source 字段分支即可（rule of three：第三个源出现时再抽象）。符合「两种方案犹豫时选更简单的」。

---

## 4. 产品设计

### 4.1 用户流程

```
侧栏「B站导入」→ 粘贴 URL/BV号/b23.tv 短链
  → 解析预览卡（标题/UP主/时长/分P列表/是否有字幕）
  → 勾选要导入的分P（默认全部）
  → [未登录?] 弹二维码扫码
  → 创建任务（走现有任务队列，排队上限/取消/进度全复用）
  → 笔记页正常消费（五视图/导图/追问/导出）
```

### 4.2 决策点（附推荐，请裁决）

| # | 决策点 | 选项 | 推荐 & 理由 |
|---|---|---|---|
| D1 | B 站登录方式 | a) 应用内扫码 b) 内嵌网页登录 c) 手动贴 Cookie | **a 扫码**。generate/poll 是纯 JSON API，渲染层用 qrcode 库画码+主进程轮询即可，无窗口、无 DOM 收割、比 SEU 登录还简单；c 是 BiliNote 的做法但体验差且有用户贴错风险 |
| D2 | 字幕策略 | a) 仅字幕（阿哔式，无字幕即拒） b) 字幕优先+ASR 兜底 | **b**。ASR 兜底是我们对纯字幕插件的差异化；成本可控（仅无字幕视频触发） |
| D3 | 无字幕时下载什么 | a) 完整视频流 b) 仅 DASH 音频流 | **b 仅音频**（bestaudio 64kbps，45 分钟课约 20MB）。关键帧需要的视频流只在「有字幕」路径下载（见 D4）|
| D4 | 关键帧（时间线配图）怎么来 | a) 下载视频流抽帧（SEU 模式） b) 不做配图，evidence 空 | **a**。时间线配图是笔记的核心差异化体验；B 站路径下载 360P/480P 单视频流抽帧后即删（与 SEU 同模式，磁盘预检/配额护栏全复用）。有字幕路径 = 下载视频流抽帧 + 直插字幕；无字幕路径 = 下载音频流转写 + 下载视频流抽帧（两条流都要） |
| D5 | 多 P 处理 | a) 每个P一个 lesson（SEU 课时模式） b) 只导当前 P | **a**。与现有课程树/课时模型完全同构，课程导图也能用 |
| D6 | B 站课程在侧栏的呈现 | a) 混入全部课程树（source 徽标区分） b) 独立分组 | **a 混入+徽标**。CourseTree 已有 isMine/noteCount 模式，加 source 小标即可；避免导航结构翻倍 |
| D7 | 官方 AI 总结接口（conclusion/get） | a) 用作笔记辅助输入 b) 不接 | **b 不接（MVP）**。我们 LLM 笔记质量更高；接口还要 WBI 签名，多一处风控面。列入后续优化候选 |

### 4.3 失败语义（用户可理解的错误分类）

- 未登录/SESSDATA 过期 → 「请重新扫码」
- 视频不存在/审核中/地区限制（view API code≠0）→ 原样透出 message
- 充电专属/会员专属/付费试看（view 返回 `is_upower_exclusive`/`is_ugc_pay_preview`）→ 明确拒绝「该视频为付费/专属内容，不支持」（不碰付费内容红线）
- 无字幕且无 ASR provider 绑定 → 提示去设置页绑定
- playurl 412/dm_img 风控 → 重试一次（带 dummy dm_img），仍失败则降级「仅字幕模式」（D4 关键帧跳过，evidence 置空，笔记仍可生成——Note schema 的 evidence 是可选的，note-craft 已有全空 evidence 的合法先例）
- SESSDATA 频率风控 → 任务间隔节流（B 站 playurl 有 QPS 限制，串行队列天然满足，不需额外做）

---

## 5. 技术设计

### 5.1 新模块：`src/main/bilibili/`（对照 `src/main/school/` 组织）

```
src/main/bilibili/
  client.ts        # BilibiliClient：view/player/subtitle/playurl 四个 API + 注入 fetch（照 SchoolClient 模式）
  wbi.ts           # WBI 签名（nav key 缓存 30min + mixinKeyEncTab + md5 w_rid）
  url-parse.ts     # BV号/URL/b23.tv短链/av号 → {bvid, page?} 纯函数
  subtitle.ts      # 字幕轨选择(优先级)+body→segments 归一（与 transcripts 同构）
  qr-login.ts      # generate/poll 轮询器（AbortController 可取消，状态 86101/86090/86038/0）
  dm-params.ts     # dm_img_* dummy 值构造（照抄 BiliNote 形态）
  parse.ts         # view/player JSON → CourseSummary/LessonDetail DTO（纯函数）
```

设计纪律：client 只做 HTTP 与 envelope 校验，parse 纯函数可单测；错误分类复用 `ErrorKind` 模式（network/auth/unsupported…）。

### 5.2 数据模型（migration 009）

```sql
-- courses: + source TEXT NOT NULL DEFAULT 'seu'
--          + bili_bvid TEXT、bili_up_mid TEXT（可空，B站课独有）
-- lessons:  + source TEXT NOT NULL DEFAULT 'seu'
--          + bili_cid TEXT、bili_page INTEGER（可空）
-- 索引：lessons(source, bili_cid) 唯一（同 cid 防重复导入）
```

- lesson id 约定：`bili-<bvid>-P<page>`（与 SEU 的 `${courseId}-L${index}` 同风格，全局可判源）。
- course id：`bili-<bvid>`。
- `course-order.ts`：B 站课时排序用 `bili_page` 自然序，不进「第N节课」正则分支。
- **现有行不受影响**（DEFAULT 'seu'），SEU 查询路径不加 WHERE source 过滤即可原样工作——只有渲染层徽标和 orchestrator 分支读这个字段。

### 5.3 管线分叉（改动核心，最小侵入）

`makeFetchCourse`（orchestrator.ts:133）改造：

```
lesson.source === 'bilibili' ?
  fetchBilibili(bvid, page):
    1. view API → 标题/UP主/分P/时长/封面（失败语义按 §4.3）
    2. player/wbi/v2 → 字幕列表（需已登录）
    3. 选轨拉字幕 body → segments（有字幕时）
    4. playurl(wbi 签名+dm_img) → 流地址清单（视频流 360P + 音频流）
    5. 落库：course/lessons upsert + 签名 URL 只进 task_stage_outputs（红线不变）
    6. 有字幕 → 直插 transcripts 行（provider 记 'bilibili-subtitle'）
  : (现有 SEU 逻辑一行不动)
```

`makeDownload` 参数化：把「teacher+screen 双流」抽成「按 source 产出的流清单」——SEU 双流、B 站单视频流（有字幕）或音频+视频双流（无字幕）。下载仍走 `ffmpeg -c copy` remux（DASH 的 mp4 分段 m4s 直接 concat 容器即可，ffmpeg 原生支持 `-i url` 不行时退 `downloadToFile` Range 下载——B 站 CDN 支持 Range，media/download.ts 已有 20 重试+断点续传实现，直接复用）。

`transcribing` executor：入口检测 `transcripts` 行已存在 → 直接标记完成（字幕旁路）。`extracting_audio` executor：B 站音频流已是 m4a，ffmpeg 只需转 wav（复用 extractAudio）。

`resolveResumeStage`：URL 新鲜度阈值按源分（SEU 6h / B 站 120min）。

### 5.4 B 站会话（复用凭据红线）

- `SessionRecord` 泛化：新 `bilibili-session/session.bin`（同 Cryptor/DPAPI 封存，MAGIC 区分）。字段：`{cookies(SESSDATA/DedeUserID/bili_jct), savedAt}`。
- IPC：`bilibili:login`（返回二维码 URL + 开始轮询）、`bilibili:loginStatus`（推送 86101→86090→0 状态）、`bilibili:logout`、`bilibili:session`。全部走 `handle()` 包装器 + sender 校验。
- 过期检测：player API 返回 code=-101 → session 状态置 expired → UI 引导重扫。
- **不持久化 bili_jct 到日志**（redact 正则扩展 `SESSDATA|bili_jct`）。

### 5.5 域名与网络

- `NAV_ALLOWED_HOST_SUFFIXES` += `bilibili.com`（passport/api/www）——仅当导入预览需要开 B 站页时用；MVP 全走 main 进程 HTTP，主窗口可不导航 B 站域（保持最小面）。
- `PROXY_BYPASS_RULES` 不加 B 站域（B 站走公网，走代理没问题，与 Clash 问题域无关——反而 SEU 是「必须直连」）。
- netCheck：设置页网络诊断增加 B 站 API 探活项（可选，M5）。
- 请求 UA/Referer 统一在 BilibiliClient 内设置（Chrome UA + bilibili Referer）。

### 5.6 UI 落点

- 侧栏 `ManualAdd`（手动添加后备）上方新增「B站导入」入口（`<details>` 折叠同款交互，或独立小组件 `BiliImport.tsx`）：
  - 输入框（URL/BV/短链）→ `bilibili:resolve` IPC → 预览卡（标题/UP/时长/分P 复选/字幕有无徽标）→「导入」→ `tasks:create`。
  - 未登录态在预览卡内嵌二维码（qrcode 渲染 dataURL + 轮询状态提示）。
- CourseTree 课程节点加 source 徽标（B 站小电视色点或文字标，遵循现有墨绿视觉纪律，不做彩色喧宾）。
- bridge 三处同步：`shared/bridge.ts` + `preload/index.ts` + `scripts/smoke-cdp.mjs EXPECTED_BRIDGE` + `tests/ipc.test.ts` 注册断言（这是既定纪律，漏一处 smoke 就红）。

### 5.7 提示词与证据（笔记链路）

- `summarize.ts` SYSTEM_PROMPT 增加 B 站语境参数：课时名=「P2 xxx」，课程=视频标题；「课堂/老师」措辞泛化为「视频/讲者」。以最小 diff 方式参数化（注入 course/lesson 元数据行），SEU 行为不变。
- 证据类型沿用 `kf:`（关键帧）——B 站封面可选存为 `kf:` 首帧或跳过（D4 已决定下载视频流，封面意义不大，跳过）。
- `note-craft/SKILL.md` 补 B 站源段落（措辞泛化规则+失败语义），这是改笔记链路的既定前置。

### 5.8 测试策略（照四层既有模式）

| 层 | 内容 |
|---|---|
| 纯函数单测 | url-parse（BV/URL/短链/p参数）、wbi 签名（固定 key 向量）、subtitle 选轨优先级、parse DTO、course-order bili_page 排序 |
| fixture 重放 | BilibiliClient 注入 fetch（照 school-client.test.ts 的 makeFetch routes）：view/player/subtitle/playurl/qr 全链路 + 错误码分支（-101/-403/412/充电专属）|
| IPC 测试 | bilibili:login/logout/session/resolve + sender 校验 + 桥面注册断言 |
| 管线 e2e | pipeline-e2e 模式：本地 http server 扮 B 站 API（view/player/playurl/字幕 JSON/CDN 字节流），跑「有字幕直插」与「无字幕 ASR 兜底」两条完整管线 |

四门禁（lint/typecheck/test/smoke）+ 测试数只增不减，沿用 AGENTS.md 纪律。

### 5.9 合规与安全红线（B 站特有）

1. **律师函先例**：bilibili-API-collect 因「系统性收集并公开传播非公开 API 文档」被关停。我们的边界：**代码内实现调用（工具行为）≠ 发布 API 文档**；本仓文档只写「我们用什么端点」级别的实施记录，不搬运参数表/签名算法全文到对外文档；不开源发布 API 逆向细节章节。（仓库本身已公开，计划文档会留在 docs/plans，注意措辞已在控制）
2. **付费/专属内容不碰**：`is_upower_exclusive`/`is_ugc_pay_preview`/会员清晰度（qn>64 不请求，360P/480P 足够抽帧）——既合规又避免大会员 Cookie 的风控敏感面。
3. **速率与体量**：串行任务队列天然限速；单人单视频粒度，不做批量抓取形态（MVP 非目标就是防线）。
4. **凭据**：SESSDATA 是登录凭据，DPAPI 封存、日志 redact、永入 Git——全部复用现有红线基建，零新原则。
5. **签名流地址**：与 SEU auth_key 同规格对待——只进 task_stage_outputs，lessons 只存脱敏路径。**（2026-09-11 修正）** 原写「任务终态清除」不准确：成功与取消确实清除，但**失败**任务会为断点续跑保留，直到超过签名有效期（SEU 6h / B站 100min）由启动清扫 `pruneStaleSignedUrlHandoffs` 删除，或用户重试成功/删除任务。见 plan 2026-09-11 compliance-disclosure 批7。

---

## 6. 分批实施计划（每批独立提交、四门禁全绿）

### M1 数据模型与源字段（地基，纯增量）
- migration 009（source 列 + B 站元数据列 + 唯一索引）+ 迁移测试
- course-order.ts 兼容 bili_page 排序 + 单测
- spec 边界变更记录：`docs/superpowers/specs/...mvp-design.md` 的「不做 B 站」条目更新为「B 站源已立项（本计划）」，AGENTS.md 范围段同步
- 验收：迁移前后 DB 兼容、SEU 全链路回归绿

### M2 BilibiliClient 与纯函数层（无 UI、无登录）
- `src/main/bilibili/` 全模块 + 四层测试前两层（单测+fixture 重放）
- 验收：`bilibili:resolve`（无登录可解析视频元数据+分P）可被测试驱动

### M3 扫码登录与会话
- qr-login + bilibili-session.bin（Cryptor 复用）+ `bilibili:login/logout/session` IPC + sender 校验 + redact 扩展
- 渲染层：导入面板内嵌二维码 UI + 状态机提示
- 验收：扫码 → session 落盘加密 → 重启后恢复 → logout 清除；fixture 测试覆盖 86101/86090/86038/0

### M4 管线分叉（核心，最大一批）
- makeFetchCourse 双源分支 + fetchBilibili（元数据落库/字幕直插 transcripts/流地址进 stage_outputs）
- makeDownload 流清单参数化 + B 站 CDN 下载（Referer/Range/dm_img）
- transcribing 字幕旁路 + extracting_audio B 站分支 + resolveResumeStage 新鲜度分源
- 管线 e2e 两条路径（有字幕/无字幕）
- 验收：本地假 B 站服务器全链路出笔记；SEU pipeline-e2e 原样绿

### M5 UI 与入口
- BiliImport 面板（解析预览/分P 复选/登录态/创建任务）+ CourseTree source 徽标
- bridge 三处同步 + EXPECTED_BRIDGE + ipc 注册断言
- 提示词语境参数化（SEU 行为不变，note-craft SKILL 同步）
- 验收：组件测试 + CDP smoke 桥面全绿

### M6 真机验收与收尾
- Andiii 真机 e2e：真实课程视频（有字幕/无字幕各一）+ 多 P + 追问 + 导图 + 导出
- 失败语义实测（付费视频拒绝/过期重扫/412 降级）
- README/CHANGELOG/PROGRESS/AGENTS 一致性检查（neat-freak 纪律）
- 版本：并入 v0.6.0 或独立 v0.7.0（建议独立 0.7.0——B 站源是用户可感知的大功能，且 v0.6.0 已在发布暂停态，先完成 0.6.0 bump 再开本计划 M1，避免两版本交叠）

预估总量：M1-M6 约 6 个工作会话批次，新增测试约 60-80 个。

---

## 7. 风险登记

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| B 站 playurl 风控升级（412 扩大/dm_img 失效） | 中 | 无字幕路径受影响 | dm_img 模块独立可更新；有字幕路径不碰 playurl 的音频部分仍可跑（仅关键帧降级）；失败语义透明 |
| 字幕覆盖率低于预期 | 中 | 多数走 ASR | ASR 兜底本就是必做项；MiMo 成本 Andiii 已有校准（v0.2.1） |
| SESSDATA 频繁过期/风控 | 低 | 体验损失 | 状态检测+一键重扫；不做自动续期（激活性检测有风控面） |
| 律师函类合规事件波及同类工具 | 低 | 功能维护成本 | 个人使用定位+不碰付费内容+不批量；最坏情况 B 站源下线，SEU 主功能不受影响（源分支隔离的设计保证） |
| 多 P 长课程（100+P） | 低 | 课程树性能 | CourseTree 已有折叠；导入时允许只勾选部分 P |
| 与 v0.6.0 发布交叠 | 中 | 版本管理混乱 | 先完成 0.6.0 bump（清单第 2 步起），再开 M1 |

---

## 8. 与既有纪律的对齐检查

- 方案先行：本文件即方案，批准前不动代码 ✅
- spec 唯一权威：M1 含 spec 边界条目更新（产品边界变更已由用户主动发起，本计划为变更记录载体）✅
- 安全红线：凭据 DPAPI/签名 URL 生命周期/redact/sender 校验全复用 ✅
- 测试只增不减 + 四门禁 ✅
- 简单优先：不做源抽象层、不接 conclusion API、不做批量 ✅

---

## 附录 A：关键 API 速查（实施时用）

```
视频信息   GET https://api.bilibili.com/x/web-interface/view?bvid={bvid}[&p={page}]
           → data.{title,cid,aid,duration,pic,pages[{cid,part,duration}],owner.mid}
           错误码：-404 无视频 等
字幕列表   GET https://api.bilibili.com/x/player/wbi/v2?bvid=&cid=   (需 SESSDATA)
           → data.subtitle.subtitles[{lan,ai_type,subtitle_url}]
           → data.view_points[]（章节，可选喂 LLM）；data.need_login_subtitle
字幕文件   GET {subtitle_url}（//开头补 https:，B站已签名）
           → {body:[{from,to,content}]}   from/to=秒
视频流     GET https://api.bilibili.com/x/player/wbi/playurl?bvid=&cid=&qn=16/32&fnval=16&try_look=1&fourk=0
           （+WBI 签名 w_rid/wts + dm_img_* 参数）
           → data.dash.video[] / data.dash.audio[]（baseUrl 需 Referer 头）
扫码登录   GET https://passport.bilibili.com/x/passport-login/web/qrcode/generate
           GET https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=
           状态：86101 未扫 / 86090 已扫未确认 / 86038 过期 / 0 成功(Set-Cookie)
WBI key    GET https://api.bilibili.com/x/web-interface/nav → data.wbi_img.{img_url,sub_url}
AI 总结    GET https://api.bilibili.com/x/web-interface/view/conclusion/get（-403 无登录，MVP 不用）
```

字幕选轨优先级：人工 zh-CN（`ai_type` 空/0 且 lan 以 zh 开头）> AI zh（lan='ai-zh'）> 任意 zh > 任意非空。

dm_img dummy 值形态（BiliNote 验证可过 412）：
`web_location=1550101, dm_img_list='[]', dm_img_str=<base64 随机 16-64 字符>, dm_cover_img_str=<base64 随机 32-128 字符>, dm_img_inter='{"ds":[],"wh":[6093,6631,31],"of":[430,760,380]}'`

## 附录 B：参照源

- BiliNote 后端字幕抓取：`backend/app/downloaders/bilibili_subtitle.py`（player API 直拉）、`bilibili_dm_patch.py`（412 风控补丁）；浏览器插件 `BillNote_extension/src/logic/bilibili-subtitle.ts`（带登录态 cookie 抓字幕=阿哔同思路）
- bilibili-API-collect 镜像（原仓库 2026-01-28 律师函关停）：`docs/video/player.md`（字幕/view_points）、`docs/video/videostream_url.md`（playurl/DASH/qn 表）、`docs/video/summary.md`（AI 总结）、`docs/login/login_action/QR.md`（扫码）、`docs/misc/sign/wbi.md`（WBI 签名）
