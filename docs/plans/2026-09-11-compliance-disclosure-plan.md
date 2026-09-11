# 合规与使用声明（Compliance Disclosure & User Notice）

- 日期：2026-09-11 · 状态：**已批准，七批全部执行完毕**（Andiii 2026-09-11 裁决「都按照你推荐的去做」）
- **执行记录**：批1 文档与事实基线 `923a466` · 批2 首启闸门 `8b4fc65` · 批3 设置页关于与声明 `39be24c` · 批4 导出前版权提醒 `8b02d32` · 批5 场景化说明+安装包许可 `8a058d9` · 批6 测试期反馈通道 `c0f38b1` · 批7 签名直链保留面收口 `3888734`。四门禁 769 → **835/835**（+66，88 文件），smoke 28 → **32/32**，`npm run dist` 出 NSIS 包通过。
- **执行中的两处口径修正**（均已记入提交信息）：①方案 §四④ 原写「登录入口首次点击时的一次性提示」，实际落成**三处常驻文案**（两个徽标 title + 设置页账号块 + B 站导入对话框）——首启九条第 3 条已说过账号风险，再弹第二个窗属于本方案原则 2 要避免的噪音；②批7 收口后 `DISCLAIMER.md` 第 7 条随事实收紧，**文本版本 1 → 2**（版本齿轮自洽，钉住测试强制两处一致）。
- **仍需人工确认**：真机视觉走查五项（首启闸门 / 导出提醒 / 关于与声明两份全文 / 反馈二维码可扫 / 安装器许可页中文可读）。`release/` 下 0.7.2 安装包是批5 中途产物，**不含批6-7**，分发前需版本 bump + 重打（版本号属发布决定，未擅自改动）。
- **裁决记录**：D1=**A**（阻断式首启闸门，不同意则退出应用）· D2=**B**（标题「使用须知与免责声明」）· D3=**B**（首次弹一次 + 可勾「不再提示」，版本升级重置）· D4=**A**（**不改** appId/包名/命名，只在声明里写明无隶属关系）· D5=**A**（补许可声明 + 安装器许可页，**不换** LGPL ffmpeg）· D6=**A**（导出提示覆盖全部七个出口）· D7=**已裁决**（全方案用户可见文本不提跨境/出境）· D8=**已裁决**（二维码用 Andiii 成品图，不自行渲染）· D9=**A**（加「在浏览器打开反馈表」按钮，新增 `feedback:openForm`）
- 触发：Andiii 要求——本软件涉及校园账号登录、从校园录播平台下载视频、B 站视频源，需要一份面向用户的声明，用于**如实告知**与**风险规避**；后续追加：测试期问题反馈通道接入（批 6）。
- 定位：**声明层建设，不改任何功能行为**。唯一例外是批 7（可选），涉及已发现的实现与文档不一致。
- 前置事实基线：本方案第一节全部结论均已逐条核对源码（附 `文件:行号`），不是推测。声明文本必须建立在这些事实上——**夸大或缩水都是违约**。

---

## 零、一页摘要

软件当前**没有任何用户可见的声明**：无首启同意闸门、无「关于」页、导出无版权提示、README 的隐私承诺与实际实现有出入、安装包内没有第三方许可声明（而内置的 ffmpeg 是 GPL-3.0）。同时 spec §9 第 9 条与 README 第 112 行**已经承诺**「应用导出时会有提示」，但该提示从未实现。

本方案七批：① 文档与事实基线 → ② 首启使用须知闸门 → ③ 设置页「关于与声明」→ ④ 导出前版权提示（兑现 spec §9）→ ⑤ 登录风险提示与安装包许可 → ⑥ **测试期问题反馈通道**（应用内二维码 + 失败场景一键复制诊断信息）→ ⑦（可选）签名直链保留面收口。

前六批零新依赖（批 6 的二维码直接用 Andiii 做好的成品图，不需要 `qrcode`，也不需要新 IPC 生成），全部复用既有 `ui/Dialog`。预计新增测试 25-32 个。

**批 6 的来源与边界**：Andiii 已创建腾讯文档收集测试用户反馈，需要应用内入口。反馈表链接 `https://docs.qq.com/form/page/DQVJUZ3hHaHRKSXhW`（收集表形态，可匿名填写）；二维码成品图已入仓 `src/renderer/assets/feedback-form-qr.png`。**关键约束：这条通道是「只给入口、不上报」**——应用不发送任何数据到开发者，只展示二维码、把诊断信息复制到**用户自己的剪贴板**，由用户自行粘贴提交。"无开发者服务器"的产品承诺不因收集反馈而动摇（这也是本仓的核心卖点，见 spec §9 第 1 条）。

**需要 Andiii 裁决 5 个决策点**（D1-D6 与 D9；见第六节），其中 D4（appId 命名）与 D6（导出提示范围）会实质影响工作量。**已裁决**：D7（全方案用户可见文本不提跨境/出境）、D8（二维码用成品图）。

---

## 一、现状体检：规范性缺口清单（已核实）

### 1.1 声明层：完全空白

| 检查项 | 结论 | 证据 |
|---|---|---|
| 首启同意/须知闸门 | **不存在**。全仓 grep `consent/agree/agreement/eula/accept/firstRun` 在 `src/main` 零业务命中 | 无 |
| 「关于」/「帮助」/「检查更新」UI | **不存在**。`src/renderer/` 全域无相关组件 | 探查结论 |
| 版本号展示 | 仅设置页页脚一行 `止于至善 · v{version}` | `src/renderer/components/SettingsPanel.tsx:223` |
| 首启引导 | 有 `WelcomeGuide`，但触发条件是「课程树已加载且为空」，是**空态引导**而非首启标记，无持久化 | `App.tsx:149`、`src/renderer/components/WelcomeGuide.tsx:18-36` |
| 导出时的版权提示 | **不存在**。五个出口只 toast 文件路径 | `App.tsx:1643/1666/1707/1723/1923` |
| 登录入口的风险提示 | **不存在**。CAS 徽标与 B 站徽标只有登录态语义 | `src/renderer/components/TopBar.tsx:80-101` |
| 渲染层「版权/勿外传/仅供」文案 | **零命中** | 全仓 grep |

### 1.2 已承诺但未兑现（spec 与 README 的既有欠账）

| 声明处 | 声明内容 | 实际 |
|---|---|---|
| `docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md:153` | "Exports can omit attachments, but **the UI warns** that course materials are school teaching resources and should not be publicly redistributed." | 未实现 |
| `README.md:112` | 「课程资料属于学校教学资源，请勿公开转发（**应用导出时会有提示**）」 | 未实现 |
| `docs/plans/2026-09-06-bilibili-source-integration.md:242` | 签名流地址「只进 task_stage_outputs，**任务终态清除**」 | 仅**成功**终态清除；失败/取消保留（见 §1.4） |
| `README.md:109` | 完整签名直链「只在任务内部做阶段交接（**随缓存清理删除**）」 | 缓存清理不删 stage 行；失败/取消任务会长期保留 |

> 这不是新问题，是本仓已登记的元模式「**设计声明与实现漂移**」（`docs/plans/2026-09-05-design-review-remediation.md:14-16`）的又一实例。因此本方案第 7 节要求**每批落钉住测试**，避免新增声明再次漂移。

### 1.3 第三方许可：有实质缺口

| 事实 | 证据 |
|---|---|
| 安装包内置 `ffmpeg.exe`，其许可为 **GPL-3.0-or-later** | `package.json:28-37`（extraResources）、`node_modules/ffmpeg-static/package.json` = `GPL-3.0-or-later` |
| `ffprobe-static` 为 MIT（无 copyleft 问题） | `node_modules/ffprobe-static/package.json` |
| 本仓许可为 MIT，**仅覆盖本仓自有代码** | `LICENSE` |
| 仓库内**没有**任何第三方许可声明文件（无 `THIRD-PARTY-NOTICES`、无 `NOTICE`） | 探查结论 |
| NSIS 安装器**没有许可页**（`nsis` 配置无 `license` 字段） | `package.json:44-50` |
| 应用内无法查看许可 | §1.1 无「关于」页 |

**说明（避免误判）**：app 以**独立子进程**方式调用 ffmpeg，不构成衍生作品，MIT 依然有效；缺口在于**分发 GPL 二进制时未随附许可文本与源码获取途径**。spec §1 明确「distributable to other students」，所以这不是纸面问题。

### 1.4 安全与隐私：事实清单（声明的依据）

**出网目标共三类，无第四类**（全仓 `fetch` 调用点核对）：

| 类别 | 目标 | 证据 |
|---|---|---|
| 学校平台 | `cvs.seu.edu.cn`（含 `-ui` SPA 与 API）、`auth.seu.edu.cn`、`ids.seu.edu.cn`（SSO 导航）、`dncvsvod.seu.edu.cn`（流媒体 CDN，运行时从播放页读取） | `src/main/app-context.ts:34`、`src/main/auth/cas-login.ts:52`、`src/main/index.ts:83`、`src/main/school/play-harvest.ts:28-31` |
| B 站 | `api.bilibili.com`、`passport.bilibili.com`、`www.bilibili.com`、`b23.tv`（短链）、`*.hdslb.com`（字幕/封面/流 CDN，运行时数据驱动） | `src/main/bilibili/client.ts:23-31,179,214`、`src/main/bilibili/subtitle.ts:43` |
| 用户自配 Provider | 用户在设置里填的 `baseUrl`，强制 https（本机例外） | `src/main/providers/model.ts:51-58`、`src/main/providers/openai-client.ts:111,172` |

**开发者自有服务器 / 遥测 / 埋点 / 崩溃上报：确认不存在。** 无 `crashReporter`、无 Sentry/GA、无 `electron-updater`；渲染进程 CSP `connect-src 'none'`，渲染层零网络能力（`src/renderer/index.html:8`、`src/main/tasks/cache-clean.ts:105`）。

**凭据**：
- CAS 会话（Cookie + JWT）→ `<userData>\school-session\session.bin`，safeStorage（Windows DPAPI）加密，JWT 单独加密（`src/main/auth/session-store.ts:15-27`、`session-crypto.ts:39-48`）
- B 站 `SESSDATA`/`bili_jct`/`DedeUserID` → `<userData>\bilibili-session\session.bin`，同一 DPAPI Cryptor（`src/main/auth/bilibili-session-store.ts:12-25`）
- Provider API Key → 资料库 `app.db` 的 `providers.api_key`，DPAPI 密封 + `enc:v1:` 前缀；渲染层只能拿到 `hasKey` 布尔（`src/main/providers/store.ts:12-25`、`src/main/ipc.ts:604-609`）
- 学校凭据只发往 `cvs.seu.edu.cn`；B 站 SESSDATA 只发往 B 站自有域（含 `*.hdslb.com` 字幕域）；**唯一会送到第三方的凭据是 Provider API Key，目的地是用户自己填的地址**（`src/main/school/client.ts:82-86`、`src/main/bilibili/client.ts:156,163-166`、`src/main/providers/openai-client.ts:111-118`）

**对外数据流向（全部为主进程发起）**：音频 16k 单声道 WAV 分片（默认 120 秒/片）、PPT 页图与关键帧（最多 20 张，base64）、清洗后转写文本、笔记 JSON（润色时）、追问上下文（含本课历史问答）、用户反馈文本（≤2000 字）、连通性测试固定文本 → 全部发往用户自配 Provider（`src/main/media/audio-split.ts:9-13`、`src/main/notes/summarize.ts:16,66-152`、`src/main/notes/qa.ts:59-83`、`src/main/notes/polish.ts:74-109`、`src/main/ipc.ts:651-657`）。

**下载行为边界**：
- 全局串行队列，同一时刻仅 1 个任务（`src/main/tasks/serial-queue.ts:8-36`）
- 全景流 `1170194-3` 明确不下载（`src/main/media/streams.ts:5-9`、`src/main/tasks/orchestrator.ts:438-441`）
- B 站付费/充电专属三处拒绝（`is_ugc_pay`/`is_upower_exclusive`/`is_ugc_pay_preview`，`src/main/ipc.ts:302,331`、`src/main/bilibili/pipeline.ts:88`）
- B 站仅请求 ≤480P（`qn=32`），会员清晰度不请求（`src/main/bilibili/client.ts:201-209`、`pipeline.ts:45-50`）
- 全仓**无** DRM/解密逻辑；策略是「不请求 + 拒绝」，不是绕过
- 无整课批量视频下载入口（整课仅批量收割课时目录；B 站分 P 需用户显式勾选且串行）

**签名直链落盘面（本仓已知红线的最薄弱处）**：
- `lessons` 表只存去 query 的脱敏路径 ✅（`src/main/school/play-harvest.ts:56-62`）
- 日志不含直链 ✅（`play-harvest.ts:6-15,318`）
- 完整签名 URL 经 `recordStage` 以**明文 JSON** 写入 `task_stage_outputs.output_json`（`app.db` 无加密，`src/main/tasks/orchestrator.ts:93-97,227-231,141-148`）
- 任务**成功**时该行被删除 ✅（`src/main/tasks/queue.ts:58-69`，注释明确写了这条红线）
- 任务**失败或被取消**时该行保留（`src/main/tasks/queue.ts:134,143,167` 三条失败路径只改 `tasks` 状态，不删 stage 行），明文签名 URL 留在 `app.db` 中，直到：该任务重试成功、该任务被删除、或清空历史任务。启动缓存清理**不**触碰 stage 行

**其他**：
- 资料库默认 `<UserProfile>\Documents\SEU Summary\Library`（`src/main/library/paths.ts:16-20`）；缓存默认 `<library>\cache`，启动清 >24h、配额默认 20GB 且跳过运行中任务（`src/main/tasks/cache-clean.ts:40-88`）；日志 `<userData>\logs`，按天保留 7 份（`src/main/logger.ts:42-56`）
- 日志脱敏：`Authorization: Bearer`、`Cookie`、`api_key`/`tgt`/`castgt`/`auth_key`/`jwt-token`/`sessdata`/`bili_jct` 全部打码，URL 一律去 query（`src/main/logger.ts:63-81`）。**小缺口：`DedeUserID` 未列入脱敏名单**

### 1.5 命名与身份：四处不一致 + 一个隐含隶属关系

| 位置 | 值 |
|---|---|
| 产品展示名 | Flash Summary（README 标题、安装包 productName） |
| npm 包名 / userData 目录 | `seu-summary` → `%APPDATA%\seu-summary`（`package.json:2`、`src/main/index.ts:128-135`） |
| appId | `edu.seu.summary` —— **占用了 `seu.edu.cn` 的反向域名命名空间**（`package.json:19`） |
| spec 标题 | SEU Summary |
| LICENSE 署名 | `Copyright (c) 2026 SEU Summary contributors`（改名后未同步） |

`edu.seu.*` 在 Windows 上会出现在注册表、快捷方式与用户可见的应用标识中，客观上暗示与东南大学的隶属关系；`seu-summary` 作为目录名同样出现于 `%APPDATA%` 与文档目录。**这是本方案最需要法律口径输入的一点**（决策点 D4）。

### 1.6 README 的数字与范围漂移

- 测试数同时出现 **221**（`:136`）、**525**（`:117`）、**639**（`:85`）三个值；smoke 写 **19**（`:138`）
- `README.md:156` 「MVP 范围明确不做：B 站、…、PDF 导出」——**B 站与 PDF 均已交付**（这同时与 `AGENTS.md` 范围段冲突，AGENTS.md 已是正确版本）
- README 未提及 Obsidian/Anki 导出（已交付）

### 1.7 反馈通道：不存在，且应用从不打开外部网址

- 应用内**没有任何产品问题反馈入口**。grep 命中「反馈」的位置全部是**笔记内容反馈**（`src/renderer/components/FeedbackSection.tsx:32,62` —— 用于润色/重新生成笔记），与"报告软件 bug"是两件事。
  > **命名纪律**：新入口不要叫「反馈」，否则和笔记反馈混淆；叫「**问题反馈**」或「使用反馈」。
- **应用目前从不打开浏览器**：全仓 `shell.openExternal` 零命中，唯一的外链面是 `settings:openPath(kind)`，且 `kind` 是枚举 `'library' | 'cache' | 'exports' | 'logs'`（`src/main/ipc.ts:739-751`、`src/shared/bridge.ts:243`）。
  > 所以"打开反馈表"是**新增能力**，必须沿用 `openPath` 的枚举先例——**URL 只能由 main 侧持有，绝不接受渲染层传入的任意地址**（否则就是一个 `openExternal` 注入洞）。
- 二维码生成**已有现成路径**（但本方案**不用**它）：渲染层已 `import QRCode from 'qrcode'` 并调用 `QRCode.toDataURL(url, { margin: 1, width: 220 })`（`src/renderer/components/BiliImportDialog.tsx:3,171`）。反馈二维码改为**直接用 Andiii 做好的成品图**：
  - 资源：`src/renderer/assets/feedback-form-qr.png`（**已入仓**，732×960 RGBA，101 KB）
  - 理由：这张图自带腾讯文档品牌与「扫一扫二维码打开或分享给好友」说明文字，是成品素材；自己用 `qrcode` 渲染只会得到一张没有说明的裸二维码，还得另写文案。
  - **呈现约束（重要）**：原图内二维码约 370×370 px。缩到 220 px 宽时二维码只剩约 110 px，**会扫不动**。设置页里应按**约 380–420 px 宽**展示（二维码约 190–210 px），并保持图片自身的白底卡片形态。
  - **仓库现状**：`src/` 下此前**没有任何图片资源**（图形全是内联 SVG 组件 + `lucide-preact`），这会是第一个二进制素材。Vite 原生支持 `import qrUrl from './assets/x.png'`，无需新配置。
- 渲染层 CSP `connect-src 'none'`（`src/renderer/index.html:8`）：生成二维码是纯 canvas 计算、不需要网络，不受影响；打开浏览器必须经 main 的 `shell.openExternal`。

---

## 二、声明的设计原则

1. **只写能核对的事实**。每一条声明都必须能在源码里找到依据；写不实的承诺比不写更有害（§1.2 就是先例）。
2. **告知，不是甩锅**。口吻是「你会用到这些功能，这些事你需要知道」，不是「出了事与我无关」。避免全大写免责话术。
3. **分层可见性**：一次性同意（首启）+ 常驻可查（设置页）+ 场景即时提示（导出/登录）。三者互补，不互相替代。
4. **不引入新依赖、不新增页面**。全部复用 `ui/Dialog`（`src/renderer/ui/Dialog.tsx:5-22`）与既有设置页结构。
5. **不改变任何产品行为**。声明层不改网络、不改存储、不改管线；批 6 是唯一的例外且可独立否决。
6. **每批落钉住测试**，测「机制存在」而非「文案字符串」，避免文案迭代就红。

---

## 三、声明内容骨架（九个条款）

以下是**条款清单与要点**，最终措辞在批 1 落定为 `DISCLAIMER.md` 全文，UI 引用同一份文本源，避免两份文案漂移。

1. **非官方声明**：Flash Summary 是个人开发的开源工具，**与东南大学及其信息化部门、与哔哩哔哩均无隶属、合作或授权关系**；未获学校或平台的认可与背书。
2. **仅限个人学习使用**：用于处理**你本人有权访问的**课程与视频；不得用于商业用途、不得二次分发、不得用于规避学校或平台的任何管理规定。
3. **账号与凭据**：请使用**你本人的账号**。凭据仅使用 Windows DPAPI 加密存储于本机，**不上传开发者、不进入日志、不进入版本库**。使用第三方工具访问学校系统可能触发学校的账号安全策略（限流、风控、临时锁定），**该风险由你自行承担**，请遵守学校的信息系统使用规定。
4. **第三方模型服务的数据流向**：转写与笔记生成需要把**音频、视频截图、转写文本、追问内容**发送到你**自己在设置里配置**的第三方 ASR/LLM 服务商——不是发给开发者，也不是发给学校。这些数据在该服务商处的处理与留存，以你选择的服务商条款为准；相关 API 费用由你自行承担。

   > **口径规矩（Andiii 裁决 2026-09-11）**：**全方案的用户可见文本一律不提「跨境」「出境」**——首启弹窗、设置页面板、Provider 配置区、README、`DISCLAIMER.md` 全文，一处都不出现。理由：应用不知道用户填的是境内还是境外服务商，写成「会跨境传输」在多数情况下根本不成立，违反本方案第二节原则 1「只写能核对的事实」；且这类法律术语无论放在哪一层，都属于原则 2 要避免的「甩锅话术」。要说的只是朴素事实——**数据发给你自己配置的服务商，其处理与留存以该服务商的条款为准**。
5. **版权与人格权**：课程录像、平台 PPT、B 站视频的著作权归学校、教师或 UP 主所有；生成的笔记是你个人的学习记录。**导出的文件（PDF / Markdown / Anki / Obsidian / SVG / 剪贴板）可能包含课程画面与他人肖像、声音，请勿公开转发或公开发布。**
6. **技术边界（我们不做什么）**：不下载课堂全景流；不触碰 B 站付费/充电专属内容；不请求会员清晰度；不提供批量抓取；不包含任何 DRM 绕过或内容解密逻辑；不提供任何对学校平台或 B 站的 API 文档。
7. **数据处理与清理**：资料库、转写、关键帧、笔记默认全部保存在本机（可在设置中查看与迁移）；临时文件在任务成功后删除，超过 24 小时的缓存在启动时清理。**失败或被取消的任务会在本地数据库中保留其当次视频直链（含限时签名参数），直至你重试成功或删除该任务——如对本地留存敏感，请及时删除对应任务。**（此条措辞必须与 §1.4 事实一致，或按批 6 修复后再收紧）
8. **可用性与环境**：视频直链带时效签名，可能因平台策略或网络环境（如代理 TUN 模式）失效，表现为任务失败；本软件**按现状提供**（AS IS），不承诺可用性、不承诺结果正确性（AI 生成的笔记可能包含错误，**请以课程原始内容为准**）。
9. **责任限制**：在适用法律允许的最大范围内，作者不对因使用本软件产生的任何直接或间接损失承担责任；完整免责条款以 `LICENSE`（MIT）为准。

---

## 四、落点设计

```
                         ┌─ ① 首启「使用须知与免责声明」Dialog（一次性，须勾选同意）
                         │
用户可见的声明 ──────────┼─ ② 设置页「关于与声明」面板（常驻可查）
                         │     ├─ 版本号 + 非官方声明（三行）
                         │     ├─ 数据流向摘要（音频/图片/文本 → 你的 Provider）
                         │     ├─ 「查看完整声明」→ 全文 Markdown
                         │     └─ 「第三方许可」→ THIRD-PARTY-NOTICES
                         │
                         ├─ ③ 导出前版权提示（7 个出口统一，可勾选不再提示）
                         │
                         ├─ ④ 登录入口一句话风险提示（CAS / B站）
                         │
                         └─ ⑤ Provider 配置区一行数据流向说明（用户做选择的那一刻）
```

**① 首启闸门** — 新增 `ConsentDialog`：标题「使用须知与免责声明」，正文为九条的精简版（可滚动），底部勾选框「我已阅读并同意上述须知」+ 主按钮「同意并继续」（未勾选时 disabled）。落库到 `settings` 一个 `disclaimerAcceptedVersion`（`AppSettingsInfo` 的 `version` 字段是同一模式的先例，见 `src/shared/bridge.ts:233`）。触发条件：**无记录或记录版本低于当前文本版本**（升级用户与文案改版都会重新提示）。拒绝的路径：提供「退出应用」（不做「不同意仍可用」的假闸门）。

**口吻纪律**：全部用户可见文本用口语化短句，**不出现「跨境」「出境」「不可抗力」一类法律术语**，也不做全大写免责话术；首启弹窗每条不超过两行。弹窗的职责是「让你知道有这么回事」，不是「把责任划清」——它比全文更短，但不说任何全文里没有的话。

**② 设置页面板** — 插入在「外观」块与页脚之间（`SettingsPanel.tsx:196-224`），或作为可点击页脚。含版本号、非官方声明、数据流向摘要、两个按钮（查看完整声明 / 第三方许可）。复用现有设置行样式。

**③ 导出提示** — 七个出口逐一接入：导出 PDF 讲义、复制 Markdown、导出 Anki、导出 Markdown、导出 Obsidian（单课时）、导出 Obsidian（整课/课程组）、导出 SVG。首次触发时弹一次 `Dialog`，含「不再提示」勾选（记 `settings` 版本，与免责声明版本解耦）。**这是 spec §9:153 与 README:112 的兑现**。

**④ 登录提示** — CAS 徽标与 B 站徽标加 `title`/首次点击时的一次性提示（「请使用你本人的账号；第三方工具访问可能触发平台风控」），B 站导入对话框内补一句付费内容边界说明。

**⑤ Provider 配置区一行说明** — 在 `ProviderPanel`（`SettingsPanel.tsx:217-219`）的 Provider 列表上方加一行常驻灰字：「转写与总结会把音频、截图和文本发送到你填写的服务商；这些数据在该服务商处的处理与留存，以它的条款为准。」（**不提跨境/出境**，见第三节第 4 条口径规矩。）**这是「数据流向」唯一该出现这层细节的位置**——用户此刻正在做选择，说明才有意义；首启弹窗只陈述事实、不展开。零新组件、零新 IPC。

**⑥ 问题反馈入口** — 测试期把反馈表接到最需要它的两个位置上：

- **位置 A：设置页「关于与声明」面板内**（常驻）——区块「测试期问题反馈」：直接 `<img>` 展示打包好的 `feedback-form-qr.png`（约 380–420 px 宽）+ 一句话「发现 bug 或想提建议，扫码填写」。（是否再加「在浏览器打开」按钮见 D9。）
- **位置 B：任务失败处**（最高价值）——失败任务的历史行与失败 toast 旁加「反馈这个错误」：**不打开浏览器，而是先弹一个 `Dialog`**，内含一段可复制的**诊断信息**，用户复制后自行粘贴到反馈表。
  诊断信息 = 应用版本 + 平台（SEU/B站）+ 课程/课时名 + 失败阶段 + 错误信息 + 发生时间 + 日志目录路径。**全部经 main 侧已有的 `redact()`**（`src/main/logger.ts:63-81`）过一遍再出——绝不带 Cookie / API Key / 签名直链。失败态的错误文本本身入库时已过 `redact`（`src/main/tasks/queue.ts:55`），此处再加一道。
  弹窗底部**必须有一句提醒**：「请勿粘贴账号密码、Cookie、API Key 或视频直链」——因为我们主动提供了「复制诊断信息」，用户很容易顺手把日志全贴进去。

- **技术落点**：
  - 图片：`src/renderer/assets/feedback-form-qr.png`（已入仓）→ `import qrUrl from '../../assets/feedback-form-qr.png'` + `<img src={qrUrl}>`。**零新依赖、零新 IPC**。
  - 反馈表链接：`https://docs.qq.com/form/page/DQVJUZ3hHaHRKSXhW`（**腾讯文档收集表** `form/page/*` 形态——可匿名填写、不要求腾讯文档编辑权限，测试用户不会有权限卡点）。仅在 D9 选「加按钮」时才需要落到 `src/shared/` 常量。
  - 新增 IPC `feedback:diagnostics(taskId)`（返回 `redact` 后的文本）；按仓库纪律落 bridge 三处同步 + `EXPECTED_BRIDGE` + FakeIpc 测试样板。若加按钮则另有 `feedback:openForm`（**无参数**，URL 只存在于 main 侧，**绝不接受渲染层传入的地址**——沿用 `settings:openPath(kind)` 的枚举先例，`src/main/ipc.ts:739-751`）。
  - 复用 `ui/Dialog`；复制走既有剪贴板路径。

**⑦ 仓库与分发包** —
- 新增 `DISCLAIMER.md`（九条全文，中文，作为唯一文本源）
- 新增 `THIRD-PARTY-NOTICES.md`（ffmpeg GPL-3.0 全文摘要 + 源码获取途径 + 其余 MIT/ISC/BSD 依赖清单）
- `README.md` 新增「合规与使用声明」章节（非官方声明 + 数据流向 + 版权提示），并修 §1.6 的全部陈旧数字与范围清单
- `docs/superpowers/specs/...mvp-design.md` §9 增补声明层条目（spec 是唯一规格来源，新增用户可见承诺必须先写进 spec）
- `AGENTS.md` 安全红线段增补一条：**新增用户可见声明必须先入 spec §9，并落钉住测试**（防漂移）
- `package.json` 的 `nsis` 配置增加 `license` 指向声明文件，使安装器显示许可页（`package.json:44-50`）

---

## 五、分批实施计划（每批独立提交、四门禁全绿）

### 批 1 — 文档与事实基线（零代码）
- `DISCLAIMER.md`（九条全文，定稿）+ `THIRD-PARTY-NOTICES.md`（含 ffmpeg GPL 处置）
- `README.md`：新增「合规与使用声明」章节；修 §1.6 的陈旧测试数/smoke 数、「MVP 不做」范围清单（B 站/PDF 已交付）、补 Obsidian/Anki 导出
- spec §9 增补声明层条目；`AGENTS.md` 增声明纪律
- `LICENSE` 署名与新命名一致化（仅当 D4 裁决为改名时才动）
- 验收：`npm run lint && npm run typecheck && npm test` 全绿（应零变化）；文档间链接可点；`neat-freak` 式一致性检查通过
- **这一批不写代码，先把「对外事实」立正**——后续 UI 引用它，避免两份文案

### 批 2 — 首启使用须知闸门
- `src/shared/disclaimer.ts`：声明文本与版本号的共享源（main/renderer 同用，纯常量 + 版本号）
- `settings` 新增 `disclaimerAcceptedVersion`（main 侧读写 + 类型 + bridge 契约）
- 新增 `ConsentDialog` 组件（复用 `ui/Dialog`，含滚动区 + 勾选框 + 未勾选 disabled）
- `App.tsx` 启动流程接入：未接受则阻断主界面渲染
- 测试：闸门存在性、未接受不放行、接受后落库、版本升级后重新提示、渲染层文案经 `MdLite`/`InlineText`（遵守 `AGENTS.md` UI 约定）
- 验收：四门禁 + 手工确认首启与升级两条路径

### 批 3 — 设置页「关于与声明」面板
- `SettingsPanel.tsx` 新增区块（版本 / 非官方声明三行 / 数据流向摘要 / 查看完整声明 / 第三方许可）
- 「查看完整声明」用 `Dialog kind="view"` 渲染全文（走 `MdLite`，禁止 innerHTML）
- 「第三方许可」显示 `THIRD-PARTY-NOTICES` 内容（构建时以 `?raw` 内联或经 IPC 读取随包资源——取更简单的一条，在批内记录理由）
- 测试：面板存在、版本号来自主进程、全文渲染不含字面 Markdown 标记
- 验收：四门禁 + 双主题截图走查

### 批 4 — 导出前版权提示（兑现 spec §9:153）
- 七个出口统一接入 `useCopyrightNotice` hook（首次弹一次 + 「不再提示」+ 落库版本）
- 测试：每个出口调用提示、勾选后不再弹、版本升级后重置
- 验收：四门禁 + 逐个出口手工验证一次

### 批 5 — 登录风险提示 + Provider 说明 + 安装包许可
- CAS/B 站入口提示（一次性 + 徽标 `title`）；B 站导入对话框补付费边界说明
- `ProviderPanel` 上方一行常驻数据流向说明（「发送给你填写的服务商，留存以其条款为准」——**不提跨境**）
- `package.json` nsis `license` 字段 + 安装器许可页验证
- LICENSE 署名与 `appId`/命名一致性（按 D4 裁决结果）
- 验收：四门禁 + 安装包重打并人工走查许可页

### 批 6 — 测试期问题反馈通道
- 设置页「关于与声明」面板内新增「测试期问题反馈」区块：`<img>` 展示 `src/renderer/assets/feedback-form-qr.png`（约 380–420 px 宽；**不要缩到 220 px 量级，二维码会扫不动**）+ 说明一句话 +（按 D9）「在浏览器打开反馈表」按钮
- 失败场景（最高价值）：失败任务的历史行与失败 toast 旁加「反馈这个错误」→ 弹 `Dialog` 展示可复制的**诊断信息**（应用版本 / 平台 SEU·B站 / 课程·课时名 / 失败阶段 / 错误 / 发生时间 / 日志目录），**出参强制过 `redact()`**；弹窗内明文提醒「请勿粘贴账号密码、Cookie、API Key 或视频直链」
- 新增 IPC `feedback:diagnostics(taskId)`（+ 按 D9 的 `feedback:openForm`，无参数、URL 只在 main 侧）；bridge 三处同步 + `EXPECTED_BRIDGE` + smoke 桥面登记
- **命名用「问题反馈」**（不要叫「反馈」——会和笔记内容反馈 `FeedbackSection` 混淆，见 §1.7）
- 测试：区块渲染且图片可加载、诊断信息字段齐全、**断言诊断文本不含 cookie/api_key/签名直链**、「打开反馈表」按钮只在 D9=A 时存在、弹窗提醒文案存在
- 验收：四门禁 + 双主题走查（注意暗色下这张白底卡片的观感）+ 真机扫码实测一次
- **红线**：这条通道**只给入口、不上报**——应用不向开发者发送任何数据，无埋点、无自动提交；「无开发者服务器」的产品承诺不因收集反馈而动摇（spec §9 第 1 条）

### 批 7 —（可选，独立裁决）签名直链保留面收口
- `queue.ts`：任务**取消**时同样清除 `fetching_course` 行（取消后重试本就会重抓，保留无收益）
- 失败态的 stage 行加保留期（例如与 `auth_key` 6h 新鲜度对齐：超过新鲜期的行在启动清理时删除——`src/main/tasks/resume.ts:16-25` 已有 6h 判断可复用）
- `logger.ts` 脱敏名单补 `DedeUserID`
- 同步修正 README:109 与 B 站方案 §5.9 第 5 条的措辞
- 测试：取消后行数归零、陈旧失败行被清理、新鲜失败行保留（续跑不回归）
- 验收：四门禁 + 断点续跑 e2e 回归
- **若此批被否决，批 1 的声明第 7 条必须按现状措辞如实写明**（见第三节第 7 条）

---

## 六、决策点（需 Andiii 裁决）

| 编号 | 问题 | 选项 | 推荐 |
|---|---|---|---|
| **D1** | 首启须知是阻断式还是非阻断横幅？ | A 阻断（须勾选才能进入）／B 顶部横幅可关闭 | **A**。一次性、可持久化，规避风险效果最强；用「不同意则退出应用」避免假闸门 |
| **D2** | 声明的标题与强度 | A 中性「使用须知」／B「使用须知与免责声明」／C 纯「免责声明」 | **B**。既要告知也要免责；C 显得推责 |
| **D3** | 导出提示的频率 | A 每次导出都弹／B 首次弹一次 + 可勾选「不再提示」，版本升级重置 | **B**。A 会严重伤害日常使用（导出是高频动作） |
| **D4** | 命名与身份是否整改？ | A 只加声明（不改 appId/包名）／B 改 appId 为中性命名／C 同时改 show 名与包名 | **A**。`appId`/`name` 是红线（改了丢登录态与已加密密钥，`%APPDATA%\seu-summary` 由 name 决定）；声明里写明「非官方、无隶属关系」已能覆盖主要风险。**B/C 需先单独评估迁移成本** |
| **D5** | ffmpeg GPL 处置 | A 随附许可文本 + 关于页展示 + 安装器许可页／B 换成 LGPL 构建的 ffmpeg 包 | **A**。B 需替换依赖并重验全媒体管线，收益不足以覆盖成本。若未来要收紧可另立方案 |
| **D6** | 导出提示覆盖哪些出口？ | A 全部七个／B 仅「会产生可分享文件」的（PDF/MD/Anki/Obsidian/SVG，不含剪贴板）／C 仅 Obsidian/Anki 这类高分享性出口 | **A**。剪贴板同样是最容易被粘贴公开的路径，都不贵 |
| **D7** | 「数据会发给第三方服务商」说在哪、说多细？ | ~~A 首启弹窗就写「可能跨境传输」~~／**B 首启弹窗只陈述事实（发给谁）+ 设置页 Provider 配置区补一层「留存以服务商条款为准」**／C 只放全文声明 | **已裁决（2026-09-11）：按 B，且全方案用户可见文本不提跨境/出境**。A 会写出不成立的断言且过度惊悚；C 让人在做选择时看不到 |
| **D8** | 反馈二维码怎么呈现？ | **A 直接用 Andiii 给的成品图**（已入仓 `feedback-form-qr.png`）／B 用已有 `qrcode` 依赖按链接实时生成／C 只用链接、让用户自己复制 | **已裁决（2026-09-11）：A**。成品图自带腾讯文档品牌与「扫一扫二维码打开或分享给好友」说明文字；自己渲染只是一张裸二维码，还要另写文案，且徒增代码 |
| **D9** | 除扫码外是否再加「在浏览器打开反馈表」按钮？ | A 加（需新增 `feedback:openForm` IPC，应用首次拥有 `shell.openExternal` 能力）／B 不加（PC 用户也用手机扫） | **A**。用户本来就坐在电脑前，点一下比掏手机快；只花一个 IPC，URL 固定写死在 main 侧、无注入面。**但这是应用第一次打开外部网址**（现状：全仓 `openExternal` 零命中）——若你想保持「从不打开浏览器」这个结论，选 B 即零新能力 |

---

## 七、纪律与验收

- **方案先行**：本文件批准前不动代码；执行中若发现新事实与声明冲突，先改声明不改事实（或按 D 裁决另立修复批）。
- **spec 唯一权威**：新增用户可见承诺先进 spec §9，再落实现；本方案本身就是 spec 变更的记录载体。
- **每批落钉住测试**：测**机制存在**（闸门、状态落库、提示被调用），不测文案字符串——避免文案迭代就红，也避免再次「声明与实现漂移」。
- **测试只增不减**，四门禁（`lint` / `typecheck` / `test` / `smoke`）每批全绿。
- **UI 约定**：文本一律经 `MdLite`/`InlineText`（模型与文档文本会含 `**加粗**`，纯插值会印出字面星号）；模态统一用 `ui/Dialog`；busy 文案加省略号 + disabled。
- **收尾**：批 1 与最后一批各跑一次 `neat-freak` 式一致性检查（README/AGENTS/docs/spec 与代码事实一致，只保留一个现役答案）；CHANGELOG 在 `[未发布]` 下记批次提交号。
- **风险登记**：

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| 声明写得过长/过凶，用户观感差 | 中 | 体验 | 首启只看精简版九条，全文按需展开；口吻为「须知」而非免责话术 |
| 首启闸门打断老用户升级路径 | 中 | 体验 | `disclaimerAcceptedVersion`：仅无记录或版本变化时提示 |
| 声明文本再次与实现漂移 | 中 | 信任 | 文本集中在共享源 + 钉住测试 + AGENTS.md 纪律 |
| GPL 声明写得含糊留下合规尾巴 | 低 | 法务 | 批 1 明确：随附 GPL 全文 + 源码获取途径 + 独立进程调用说明 |
| 反馈表链接失效 / 表单被删 | 中 | 用户点了没反应 | 图片与链接都写死在仓库，改一处即换；测试期属可接受；反馈表内容不参与任何自动化流程 |
| 用户把 Cookie/API Key 粘进反馈表 | 中 | 凭据泄露 | 「复制诊断信息」出参强制过 `redact()` + **钉住测试断言不含敏感字段**；弹窗内明文提醒 |
| 反馈通道被误解为「加了埋点」 | 低 | 信任 | 方案与 README 明写「只给入口、不上报」；代码里没有任何自动发送路径 |
| 那张白底卡片在暗色主题下突兀 | 低 | 观感 | 批 6 双主题走查；必要时加一点圆角/边框收边，但不改图内容 |
| D4 选 B/C 导致丢登录态/密钥 | 中（若选） | 严重 | 推荐 A；若选 B/C 必须先立独立迁移方案并演练 |

---

## 八、与既有纪律的对齐检查

- 方案先行：本文件即方案，批准前不动代码 ✅
- spec 唯一权威：批 1 含 spec §9 增补与 README 漂移修正 ✅
- 安全红线：不引入任何新的对外数据流向、不新增依赖、不弱化现有加密与脱敏 ✅
- 测试只增不减 + 四门禁 ✅
- 简单优先：零新依赖（二维码用 Andiii 的成品图，连既有的 `qrcode` 都不需要）、零新页面、复用 `ui/Dialog` 与既有设置结构；不引入 i18n 框架、不做多语言 ✅
- 无遥测红线：批 6 **不引入任何自动上报**；新增的 `feedback:openForm`（若 D9=A）是应用首次具备「打开外部网址」能力——URL 只在 main 侧、无参数、不接受渲染层地址 ✅
- 变更产品边界？否——声明层不改变任何产品行为；批 7 若实施会改动一处存储清理语义，故单列并需独立裁决 ✅
