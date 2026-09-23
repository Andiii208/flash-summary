# 方案：宣发宣传动画「一节课进去，一册笔记出来」（2026-09-23）

> 状态：**v3 已出片，待 Andiii 目视**（正片 `promo/out/promo.mp4`，27.00s / 九幕；未 commit/未 push）。
> 触发原话（2026-09-23）：「我现在想要去做一下这个软件的宣发，你能不能根据这个软件去截几张图，然后做一个十几秒的，精致且高级的宣传动画？给我一个 plan」
> 执行中的两次即时指示：**「直接用真实截图，横屏就行，你继续吧」**（D1=A、不出竖版）；**「等等，刚刚封面没加载出来，你再来一遍，然后继续」**。
> 纪律依据：`AGENTS.md`「方案先行」；用户可见承诺只写能核对的事实；**不新增运行时依赖**。

## v3 精修（2026-09-23，Andiii 三审：「很多细节没做好，整体也不够丝滑……要非常精美、非常优雅」）

**正片**：`promo/out/promo.mp4` —— 1920×1080、30fps、**27.00s**（810 帧）、H.264 High / yuv420p / SAR 1:1、约 5.4MB；海报 = 尾帧品牌卡 + 导图主视觉。

**九幕**：对仗开场（`一节 72 分钟的录播课` → `一份 14 分钟读完的笔记` + 一道黄铜细线展开）→ 定场（图标/名称/口号）→ 双入口 → 1656 门课程 → 六阶段（暗场）→ 五种读法（5×0.98s + 压轴全图导图）→ 讲义翻页 → 追问 → 收尾。**开场两个数字都是这节课自己的事实**（库中 `duration_seconds=4296`、笔记自估「约 14 分钟读完」、导出 26 页）。

**这一轮修的全是"观感债"**：
1. **缓动分级**：卡片落定改 `easeOutQuint`（尾段极缓、收得住），文案 `easeOutCubic`；不再全场一个 `easeOutExpo`（起步太冲，机械感来源）。
2. **幕间改线性交叉淡溶**：原先用 eased 淡溶，两幕相加在重叠前段远小于 1——观感是"先一暗再亮"的凹陷；改成入幕提前 fade 秒起溶、出幕同窗结束，**两幕透明度之和恒等**。
3. **修"落点闪空帧"**：幕淡溶完成的那一刻，内容动画还要再等 0.1~0.2s 才起跑，中间闪 1~6 帧空纸面（八个落点全有）。把每幕首个元素提前 ~0.3s 起跑，落点即有内容。
4. **修压轴卡"提前淡出"**：v2 里导图卡的 out-fade 比幕淡溶早开始，两层透明度相乘，S5→S6 边界出现近空帧；压轴卡 outDur 收到 0.12s，撑到幕尾再交给幕淡溶。
5. **五种读法换素材**：同深度下「标准总结」与「方法论」仍长得一样（都是章节列表）。按「结构化表格 / 章节块 / 公式清单 / 图+文 / 导图」各取一个最可辨的滚动深度（方法论取 1800=重点实验+易错点），并拉长到每幕 0.98s、0.18s 短溶。
6. **镜头永不静止**：主图落定后仍有 1.2% 的极慢推近（观感是呼吸不是缩放）。
7. **文案压到 20 字内**，底部说明尽量落在同一基线上；去掉「登录后课程树自动刷新」等长尾子句。

**门禁（实跑）**：lint 0 错 / typecheck 0 错 / test **1467/1467** / build 成功 / smoke **40/40**。**仍未 commit / 未 push**。

---

## 执行结果（2026-09-23 实测）

**正片**：`promo/out/promo.mp4` —— 1920×1080、30fps、**25.00s**、H.264 High / yuv420p / **SAR 1:1 DAR 16:9**、1680 kb/s、约 5.3MB（750 帧）；`promo/out/poster.png` 为尾帧品牌卡（封面图用），`poster-mindmap.png` 为导图主视觉备选。

**八幕**（Andiii 二审「五种读法太尴尬、五张截图基本一模一样 + 时长加一点 + 整体再高级一点」后的 v2）：
1. 定场（0–2.1）墨滴 → 图标 → Flash Summary → 副标
2. 双入口（2.1–5.3）左=课程树/任务历史，右=B站导入对话框（粘贴→解析预览交叉淡溶），双卡带纸叠
3. 找课（5.3–7.6）「1656 门课程」+ 全部课程全屏浏览器
4. **六阶段流水线（7.6–12.2，暗场）**墨绿盖层 + 同名 CSS 变量翻板（轨道卡/节点/文案全跟着换色），六阶段依次点亮 + 铜点扫过
5. **五种读法（12.2–17.4）chips 滑动 pill + 五张「滚到正文」的截图**（每种视图 0.72s、0.16s 短溶，约 0.4s 全不透明可读）→ 压轴思维导图全图缓推近
6. 讲义（17.4–20.2）真实导出的 26 页讲义，封面→课堂画面→整页导图**两段三维翻页**
7. 追问（20.2–22.2）note + 坞
8. 收尾（22.2–25.0）导出整册讲义 + logo + 三徽标 + 非官方声明 + 仓库地址

**每条文案都能在 README 找到出处**（声明层纪律）。**技术路线不变**：`promo/promo.html` 是 1920×1080 的纯函数时间线（不用 CSS transition/animation/rAF，每帧由 `__setTime(t)` 直接写 DOM）→ `scripts/promo-render.mjs` 逐帧采集 + ffmpeg-static 编码；零新依赖、可复现。

### 与 v1 / 初版方案的偏差（都是实测逼出来的）

1. **「五种读法」重拍**：初版五张是未滚动的笔记页——折叠线以上（封面 hero + 章节 chips）五个视图**逐像素相同**（实锤：`01/02/03` 三帧字节数全等），确实就是 Andiii 说的「五张基本一模一样」。改为每种视图 `scrollTop=820` 拍正文（事项运算表 / 编号清单 / 概念列表 / 解题思路 / 导图），并追问坞先收成小球避免盖正文。
2. **渲染宿主改无框窗口 + 尺寸断言**：`new BrowserWindow` 默认带窗框，视口被吃掉成 2538×1358，压成 1080p 后 **SAR 2276:2165 = 横向拉伸 5%**。现在 `frame:false` 拿整 2560×1440，`promo-render.mjs` 对每帧做 JPEG SOF 尺寸断言，不对就抛错。
3. **补字体同源**：产品文楷来自 npm 包 `lxgw-wenkai-screen-webfont`，分镜页 link 同一份 css 才不落回系统楷体；chips 几何挪到 `document.fonts.ready` 之后再量（字体没就绪量宽度，滑动 pill 会对不齐）。
4. **PDF 重导出**：`.ui-shots/full-handout.pdf` 是 Python 课的，S5 封面会和前四幕的概率论课不一致；改用 `SEU_PDF_PATH` 现导一份同课讲义（要先过「导出提醒」对话框）。翻页用三页：封面 / 课堂画面页 / 整页知识导图。
5. **截图统一裁掉标题栏（y<86）**：那一行同时放着 logo、面包屑和「东大·已过期 / B站·已登录」两个登录态药丸；学校会话 JWT 已过期，不裁的话每一帧角上都是「已过期」。
6. **eslint.config.js 加一行**：`promo/**/*.mjs` 进 Node globals 段（一次性构建脚本同样需要 console/process）。
7. **两个自伤bug（记下来免得复发）**：① `clamp(t, 25)` 只传两参（我的 clamp 是三参）→ NaN → 所有幕 visibility:hidden、抽帧全空，CDP 探针 dump computed style 才定位到；② `promo-render.mjs` 的 `--at` 抽检帧写的是 `.png` 后缀、内容是 JPEG，读尺寸时会读出垃圾值。

**门禁（实跑）**：lint 0 错 / typecheck 0 错 / test **1467 passed / 134 文件** / build 成功 / smoke **40/40**。**未 commit / 未 push**（等目视后点头）。

### 拍帧链条（换版本重出片用）

`node .zcode/promo-reshoot.mjs`（gitignored 一次性脚本：拷真库 **+ attachments/**、从安装版 userData 拷学校/B站会话得到「已登录」、显式 `goTab('任务')` 且**选课时前**拍任务页、「全图」弹层等 `.mindmap-full-overlay`、`SEU_PDF_PATH` 导同课讲义）→ `node promo/build-assets.mjs`（裁标题栏 + 缩放 + 拷文楷 + PDF 栅格化）→ `node scripts/promo-render.mjs`（750 帧 + 编码 + 两张海报）。

---

## 0. TL;DR（一句话做法）

用**真实 UI 截图**当舞台素材，用一个**自包含的 HTML 分镜页**（品牌 token 直接抄 `src/renderer/style.css`）做「帧精确」动画，用**本仓自带的 Electron + CDP** 逐帧截图（Web Animations 完全不用，全部由 `renderFrame(t)` 纯函数驱动 → 零时序抖动、可复现），最后用仓内已有的 **ffmpeg-static**（libx264）编码成 1920×1080@30fps、约 16 秒的 mp4。零新依赖、无人力重复劳动、产物与脚本全部可重建。

---

## 1. 交付物

| 文件 | 说明 |
|---|---|
| `promo/out/promo.mp4` | 正片：1920×1080、30fps、约 16s、H.264（yuv420p，faststart）、**静音**（各平台静音自动播放；配乐留给他以后在剪辑软件里加） |
| `promo/out/poster.png` | 海报帧（尾帧大字版，给公众号/B站封面用 1920×1080） |
| `promo/out/promo.gif` | 可选：前 3 秒循环，给 README/GitHub 用 |
| `promo/promo.html` | 分镜页源文件（六幕 + 时间线，`renderFrame(t)` 纯函数） |
| `promo/build-assets.mjs` | 素材内联脚本：读 `promo/assets/*` → 产出 `promo/promo.built.html`（base64 data URI，无 file:// 路径问题） |
| `promo/main.cjs` | 渲染宿主：独立 Electron 窗口 2560×1440（`force-device-scale-factor=1`），加载 `promo.built.html`，开 CDP |
| `scripts/promo-render.mjs` | 帧精确采集 + ffmpeg 编码驱动器（与 `ui-shots.mjs` 同风格、同 lint 约束） |
| `promo/assets/` + `manifest.json` | 截图/位图素材（**不入 Git**，见 D5） |

---

## 2. 现状盘点（要的能力基本都在）

| 需要的能力 | 现状（已核） |
|---|---|
| 真实 UI 截图 | `scripts/ui-shots.mjs`：boot 真 app → 临时库副本隔离 → CDP 走完主流程；`.ui-shots/wide/`、`wide-dark/`、`mindmap/`、`study/` 有 2026-09-22 最新一批；`--bili`/`--my-study` 专项机位现成（B站导入对话框、我的学习弹层都有实拍） |
| 编码 | `node_modules/ffmpeg-static` 现成，`libx264`/`aac` 都在 |
| PDF 讲义位图 | `.ui-shots/full-handout.pdf` 现成 + 本机有 **PyMuPDF 1.28.2 / pdftoppm（MiKTeX）** 可转高清 PNG |
| 品牌 token | `src/renderer/style.css:12-103`：纸 `#f5f1e6` / 表面 `#fbf9f3` / 墨绿 `#00432b` / 黄铜 `#6e5426` / 间距刻度 / 文楷 `--font-display` / 圆角阴影全套 |
| 图标 | `build/icon.ico`（深蓝底白书 + 纸飞机），ffmpeg 可直接解出 PNG |
| 阶段名（流水线幕要用） | `src/renderer/labels.ts:6-11`：拉取课程信息 / 下载视频 / 提取音频 / 转写音频 / 提取 PPT·关键帧 / 生成笔记（六阶段，`src/main/tasks/stages.ts`） |
| lint 约束 | `scripts/**/*.mjs` 只许用 console/process/Buffer/fetch/WebSocket/setTimeout 全局别名（照抄 `ui-shots.mjs` 写法即过） |
| 测试面 | 宣发不碰 `src/`，四门禁零影响；`promo/` 全走独立验收（拍板核对） |

---

## 3. 决策项（D1-D6，均给推荐）

### D1 画面素材口径 —— **推荐 B：先 seed 一个演示库再拍**

片子要发 B站/公众号/README，而真实截图里有**真实课程名、教师姓名、真实转写正文**（README 与 `DISCLAIMER.md` 明写「课程资料请勿公开转发」）。三条路：

- **A. 用现成真实截图**（当天出片）：内容最丰富，但公开即分发课程内容，须他明确豁免。
- **B. seed 演示库 + 合成幻灯片**（推荐，~+1.5h）：造 1 门演示课（1 个课时、一份手写 note JSON、3 张 HTML 渲染的合成「课堂幻灯片」位图），再走一遍截图流程。画面结构与真机一致，但**不含任何学校/教师/课程内容**；且文字量我可以按 1080p 可读性精编（真实笔记正文太长，上镜会糊）。
- **C. 真实截图 + 模糊/裁敏感区**：笔记标题就是课程名，裁了画面残缺，不做。

> 合成幻灯片也用同一套 CDP 渲染一个 `promo/slides.html` → PNG，不引入新依赖。note JSON 的 schema 照 `src/shared`（overview/knowledgeTree/timeline/concepts/…），timeline 挂 2-3 张合成图当关键帧。

### D2 技术路线 —— **推荐「HTML 分镜页 + Electron CDP 帧精确」**

| 路线 | 结论 |
|---|---|
| **HTML 分镜页 + CDP 逐帧采集**（推荐） | 帧精确、可复现、字体/配色与产品同源、零新依赖；改一个数字重渲染即可 |
| Remotion | 要新装依赖（浏览器下载，网络/代理风险），且要重写一套 React 舞台，收益为零 |
| 录屏/剪映手工 | 有时序抖动、不可复现、改一处要从头再录 |

关键点：分镜页**不用 CSS 动画、不用 `requestAnimationFrame`**——全部状态由 `window.__setTime(t)` 直接写 DOM（transform/opacity/clip），所以每一帧都是 `t` 的纯函数，无掉帧、无竞态。480 帧串行采集约 2-4 分钟。

### D3 规格 —— **推荐 1920×1080@30fps、16.0s、静音**

- 画布按 **1920×1080 CSS px** 编写，`transform: scale(4/3)` 后在 **2560×1440** 窗口采集（超采样 1.333×），ffmpeg lanczos 降回 1080p——文字与缓动边缘比原生 1080p 干净一档。
- 竖版 9:16（视频号/抖音）留作批5：分镜构图按「中心安全区」设计，竖版只需重新排版舞台，不动逻辑。

### D4 文案口径 —— **只写 README 能核对的事实，尾帧带非官方小字**

每句台词都能在 README 找到出处（见 §4 台词列）。结尾卡加一行小字「非官方工具，与东南大学、哔哩哔哩无隶属关系」——公开宣发必须带。

### D5 落库策略 —— **脚本与源页入库，素材与产物不入库**

- 入库：`promo/promo.html`、`promo/slides.html`、`promo/build-assets.mjs`、`promo/main.cjs`、`scripts/promo-render.mjs`（下个版本改版后 5 分钟可重出片）。
- 不入库（`.gitignore` 加 `promo/assets/`、`promo/out/`、`promo/promo.built.html`）：产物、帧序列（~200MB）、以及任何截图位图——即使 seed 过也避免误传真实内容。正片走 release/或 QQ 交接。

### D6 验收方式 —— 我逐镜自审 + 他目视

- 自审：抽帧条（1 fps × 16 张拼联系表）逐帧 Read 目视，核文字溢出/时机/缓动；ffprobe 核时长、帧数、分辨率、码率。
- 终审：Andiii 目视 mp4；不满意按幕改（改 `promo.html` 一处、重渲染 3 分钟）。

---

## 4. 分镜表（16.0s / 480 帧 @30fps）

统一：纸色底 + 颗粒质感；文楷大字；墨绿/黄铜两点色；镜头语言「缓推近 + 遮罩圆角 + 柔影」；转场一律 easeOutExpo/Cubic，无弹跳。

| # | 时间 | 画面 | 屏幕文案（≤14 字/行） | 素材 |
|---|---|---|---|---|
| S0 | 0.00–1.90 | 墨点滴落晕开 → app 图标轻落定 → 产品名+副标显影 | **Flash Summary** / 把一节录播课，变成一册结构化笔记 / （小字）Windows 桌面应用 | `build/icon.ico` → PNG |
| S1 | 1.90–4.40 | 左：课程树截图缓推近；右：B站导入对话框弹出（链接已粘贴 → 解析出预览卡） | 科达录播 · B站视频 / 两个入口，同一条流水线 | 课程树帧、`bili-b1/b2` 帧（seed 库重拍） |
| S2 | 4.40–8.00 | 中景：虚化的任务卡做底，前景六段阶段轨依次点亮（真实 stage 名），光点流过节点 | 拉取课程信息→下载视频→提取音频→转写音频→提取 PPT·关键帧→生成笔记 / 断点续跑，失败从断点继续 / 任意阶段 2 秒内可取消 | 任务卡帧 + 自绘阶段轨（token 与产品一致） |
| S3 | 8.00–12.90 | 五视图接力：详细笔记(1.3s)→要点(0.7s)→方法论(0.7s)→标准总结(0.7s)→思维导图(1.5s，节点逐个亮) | 同一份笔记 · 五种读法 | 五张视图帧（seed 库重拍）+ `mindmap/fitted` |
| S4 | 12.90–14.60 | 右侧追问坞浮出：打字式问题 → 答案逐字显出 | 读到哪里，问到哪里 / 问：随机试验和样本空间什么关系？ | 追问坞帧 + seed 的一条问答 |
| S5 | 14.60–16.00 | PDF 讲义封面翻开 → 收拢 → logo + 名称 + 三枚徽标 + 小字声明 + 仓库地址 | 本地优先 · 自带模型密钥 · 无遥测上报 / 非官方工具，与东南大学、哔哩哔哩无隶属关系 / github.com/Andiii208/flash-summary | `full-handout.pdf` 首页 PNG + 图标 |

---

## 5. 实现要点

### 5.1 舞台与时间线（`promo/promo.html`）

```
:root 抄 style.css 的 token（颜色/间距/字号/字体/圆角/阴影）→ 与产品同源，不会「宣传片和实物两个品牌」
#root { width:1920px; height:1080px; transform:scale(4/3); transform-origin:0 0 }
const TL = [ { from, to, render(t, els) } ]   // 每幕一段纯函数
window.__setTime = (t) => { 找到当前幕，调用 render(localT) }
```

- 缓动助手：`clamp/lerp/easeOutCubic/easeOutExpo/easeInOutCubic/stagger(i)`。
- 打字机、进度条、阶段点亮、节点逐个亮全部写成 `f(t)`，**不依赖任何时钟**。
- 截图帧：`img` + 圆角遮罩 + `box-shadow` + 轻微 `scale` 缓推；边缘加 1px 高光描边（-surface-3 色）让「纸上的窗口」有实物感。
- 退出条件：`window.__promoReady = true`（ assets 全部 `decode()` 完成后置位，采集前等它）。

### 5.2 采集与编码（`scripts/promo-render.mjs`）

- `spawn(electron, ['promo/main.cjs', '--remote-debugging-port=<free>'])` → 轮询 `/json/list` → WebSocket CDP（复用 `ui-shots.mjs` 的 `Cdp` 类写法）。
- 循环 `i = 0..479`：`Runtime.evaluate('__setTime(' + (i/30) + ')')` → `Page.captureScreenshot({format:'jpeg', quality:92})` → 写 `promo/out/frames/f%04d.jpg`。
- 编码：`ffmpeg -framerate 30 -i f%04d.jpg -vf scale=1920:1080:flags=lanczos -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -preset slow -movflags +faststart promo.mp4`，另 `-ss 14.6 -frames:v 1` 出 poster。
- `main.cjs` 必须：`app.commandLine.appendSwitch('force-device-scale-factor','1')`（本机 DPI 150%，否则窗口物理尺寸翻倍）、窗口 `show:true` 且 `SW_RESTORE`（hidden 窗口会冻结视口、截图可能拿到空帧——`ui-probe` 踩过）、`backgroundThrottling:false`。

### 5.3 批1 的 seed 最小集合

1 门演示课 → 1 个课时 → 1 份 note JSON（overview / knowledgeTree(12-16 节点、10+ 关系边) / timeline(8 条、3 条挂合成图) / concepts / methodology / examCues / 一段 transcript 供追问上下文）+ 3 张合成幻灯片。写进一个临时库副本（照 `ui-shots.mjs` 的 `SEU_SUMMARY_DOCS_OVERRIDE` 隔离套路，绝不碰真库），过一遍同意闸门后拍 8-10 张定场帧。

---

## 6. 批次与验收门

| 批 | 内容 | 验收（过了才进下一批） |
|---|---|---|
| 批1 备料 | 裁 D1 → seed 演示库 + 合成幻灯片 → 拍定场帧（课程树/B站导入/任务卡/五视图/追问坞/PDF 首页/图标）→ ffmpeg 缩到目标尺寸 → `manifest.json` + 联系表 | 我逐张 Read 目视（无敏感内容、无滚动条/焦点环/悬停态、文字可读）；`node -e` 核每张尺寸 |
| 批2 舞台 | `promo.html`（六幕 + 时间线）、`build-assets.mjs` → `promo.built.html` | 抽 4 个时间点（t=0.8 / 4.8 / 9.5 / 15.5）渲染核对：构图、文案、无溢出、无元素穿帮 |
| 批3 渲染 | `main.cjs` + `scripts/promo-render.mjs` 全量 480 帧 → mp4 + poster | `ffprobe`：1920×1080 / 30fps / ≥15.5s / faststart；抽 12 帧联系表目视；`npm run lint` 过（新脚本） |
| 批4 修订 | Andiii 目视 → 按幕改 → 重渲染（改一幕只需重跑全量 3 分钟） | 他点头；四处门禁 + smoke 仍绿（防误伤 `src/`） |
| 批5 可选 | 9:16 竖版 / GIF / README 嵌入 | 同上抽帧目视 |

工期估计：批1 1.5h · 批2 2.5h · 批3 0.5h · 批4 1-2h（含往返）——合计约 **6-7 小时**（不含等待审批）。

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 真实课程/教师内容混入公开宣发 | D1-B seed 演示库；`promo/assets/` 一律不入库 |
| DPI 150% 导致画布尺寸翻车 | `force-device-scale-factor=1` + ffprobe 核分辨率 |
| hidden 窗口视口冻结、截图空帧 | `show:true` + `SW_RESTORE`（`ui-probe` 已有前科） |
| 截图带滚动条/焦点环/`cursor` | 拍摄脚本注入 `::-webkit-scrollbar{display:none}`，全程无 userGesture（不触发 hover/focus） |
| 文楷字体本机缺失导致宣传片与实物字体不一 | 应用本身无内置字体、同样回落 KaiTi，两边同源；批2 抽帧时肉眼确认标题字形 |
| 帧序列体积（~200MB） | 一律写 `promo/out/frames/`，编码成功后自动删 |
| 16s 讲不完想讲的 | 台词已按 ≤14 字/行、每幕一个论点收敛；要加内容先加幕，不塞字 |

---

## 8. 请他拍板

1. **D1**：seed 演示库（推荐，公开安全）还是直接用真实截图（快，但含课程名/教师名/笔记正文）？
2. **D3**：16:9 一版定稿，还是要顺手出 9:16 竖版（批5）？
3. 有想强调的功能点或一句「灵魂文案」吗（没有就按 §4 分镜表走）？
