# Flash Summary Desktop MVP Design

## 1. Product Position

Flash Summary is a Windows desktop application that turns Southeast University Kedacom course recordings into structured study notes. The application is local-first, distributable to other students, and requires no developer-owned server. Each user logs in with their own SEU CAS account and provides their own model provider credentials.

The MVP focuses exclusively on `cvs.seu.edu.cn` recordings. Cloud sync, multi-user accounts, local ASR, and macOS support are outside MVP scope.

> Boundary updates (user-approved): PDF export was promoted into scope on 2026-09-04 (Note Revolution). Bilibili as a second video source was approved on 2026-09-06 — see `docs/plans/2026-09-06-bilibili-source-integration.md`.

## 2. User Experience

- The installed application opens by double-clicking; no command-line operation is required.
- On first launch, the user configures model providers.
- The user logs in through an in-app SEU CAS window. The saved session is reused when the application restarts.
- The application automatically lists the user's courses and lessons. Manual entry of a course ID or playback URL remains available as a fallback.
- The user selects lessons to process. Processing runs as a local task queue with visible progress and retry actions.
- When a school session expires, the application opens the in-app CAS login window. After a successful re-login, the failed task resumes from its failed stage without restarting the application.
  - Revision (2026-09-01, commit 47a9a46): silent auto-relogin was deliberately narrowed. Mounting reads the local course tree only (no network refresh); the CAS window opens only from an explicit user action (login / refresh buttons); a session expiry mid-task surfaces as a toast plus an honest logged-out badge, and the user retries the task manually after re-logging in. Rationale: with the login-window first-paint hang, auto-raised invisible windows made the UI look unresponsive (three stacked windows, no feedback). See PROGRESS.md "关键决定记录".

## 3. Core Pipeline

For each selected lesson:

1. Fetch lesson metadata and video URLs through the authenticated school API.
2. Temporarily download the teacher stream and screen/PPT stream.
3. Extract audio from the teacher stream.
4. Send the audio to a user-configured OpenAI-compatible ASR provider.
5. Fetch the school platform's PPT images.
6. Extract deduplicated keyframes from the screen/PPT stream using perceptual hashing.
7. Generate one structured note with a multimodal model using the transcript, PPT images, and keyframes.
8. Delete temporary video and audio files after successful processing.

### Stream Strategy

- Teacher stream `1170193-1`: audio source only.
- Screen/PPT stream `1170195-5`: visual source for keyframes.
- Classroom panorama stream `1170194-3`: not downloaded or processed in MVP.

### Visual Source Priority

1. PPT images from `/v1/course/ai/ppt?courseId=` are the primary visual source.
2. Keyframes supplement missing PPT pages, mismatches with the lesson timeline, board writing, software operations, and code demonstrations.

## 4. Model Provider Configuration

Users can configure multiple providers. Each provider has:

- Base URL
- API key
- Optional ASR model name
- Optional multimodal model name

Capabilities are bound independently — exactly two:

- ASR: provider + model
- Multimodal summarization: provider + model

The first-run experience recommends a single provider that supports both ASR and multimodal input. Advanced settings allow ASR and multimodal summarization to use different providers and keys.

All provider communication uses OpenAI-compatible APIs. The default note generation path uses a multimodal model; follow-up Q&A uses the **same multimodal binding** (see the 2026-09-21 annotation below).

> **批注（2026-09-21，模型设置两项化 P25，见 docs/plans/2026-09-20-ux-issues-remediation.md 补批）**：
> 能力面由三项（ASR / 多模态 / 文本问答）收敛为**两项（ASR / 多模态）**——用户原话要求「直接改成 asr 语音转写模型和多模态模型这两个选项，不要设置成当前的三个选项」。依据：`text` 从来没有独立的真实消费点，追问链路是它唯一的用处，而多模态模型本身就能回答文本问题（追问上下文里本来就有转写与笔记）。因此 **Q&A 走多模态绑定**（`qaCapability()` 恒返回 `multimodal`）；原先「绑了 text 就用 text、否则回落到 multimodal」的二选一消失。老库里遗留的 `capability_bindings.capability = 'text'` 行由 migration 013 删除（能力面已不存在，留着只会在 Provider 列表渲染一个 UI 无法维护的徽标）；`capability_bindings` 的 CHECK 约束不动（改它要重建表，收益为零）。**已绑多模态的账号**追问不受影响；**只绑过 `text`、从未绑过多模态的账号**升级后追问会得到可执行的提示「未绑定问答模型，请在设置中配置多模态总结模型」，需要自己把多模态模型绑上——migration 不代用户改写绑定（把原先给 Q&A 用的文本模型搬到多模态能力上，会让笔记生成按用户从未声明的配置跑起来，且按 §4 的视觉能力判据这类模型不发图，属越权且静默降级）。

> **批注（2026-09-19）**：“绑定的多模态模型”按具体模型判定视觉能力。已知无视觉（如 deepseek-chat）时生成路径**不发图**；未知类型保守发图。划分不依赖于用户声明，而依赖于维护的模型知识表（猜错的代价不对称：说无视觉=丢画面，说有视觉=白烧 token）。

## 5. Structured Notes

The model produces one structured note stored as JSON. The UI renders this note natively and offers four reading views:

- Detailed notes
- Standard summary
- Key points
- Methodology analysis

All views are filtered and reorganized from the same structured note. The model does not generate four independent summaries.

The note schema contains:

- Lesson overview
- Knowledge structure tree (nodes may anchor concept terms)
- Timeline of the lesson
- Concepts and definitions (optional concrete example per concept)
- Formulas, code, and operation steps
- Methodology analysis
- Exam and assignment cues
- Questions and gaps
- Timestamped transcript references
- PPT and keyframe evidence references
- Self-quiz items (anchored to a concept term or an exam cue)
- Concept relation links (from/to resolving to a concept term or a node title)
- Chapters (optional; 3-8 sections with `at`/`title`/one-line `summary`; timeline entries are grouped by chapter in the reading views)
- Key quotes (optional; verbatim speaker quotes with `at`, verified against the transcript, omitted rather than invented)
- One-line TL;DR (optional; the preview-value sentence that answers "what is this and is it worth reading")

> **清单维护批注（2026-09-17）**：本清单此前已落后于实现——`quiz`、`conceptLinks`、
> `terms` 与时间线条目的 `evidence` 都不在旧清单里，批2 又新增了 `Concept.example`。
> 本次一并补齐，并把「清单须随实现更新」当作常态维护项（AGENTS 的一致性纪律）。

Markdown export is a secondary exchange format. PDF export is not included in MVP.

> **批注（2026-09-19，笔记体验整改 v4，见 docs/plans/2026-09-19-note-experience-overhaul.md）**：
> ① 时间线/转写引用的 `at` 若超出真实转写范围（模型外推时间），铳制到范围上界并计数暂存——**保内容、修位置、不装作时间是准的**（宁缺勿编）。
> ② 绑定的多模态模型若无视觉能力（知识表 `shared/model-vision.ts`，**只收核实过的知识**：mimo-v2.5 曾因假说误列无视觉、2026-09-20 经用户订正撤下；表外类型保守发图）——不发图，避免图片被静默丢弃或造成整段静默重发；生成结果报 `visionCapable`。
> ③ 时间线配图新增课时封面（B 站导入落盘 `attachments/<lessonId>/cover.jpg`，`lessons.cover_path`）；无封面时阅读首屏用最早关键帧兜底，两者皆无则不渲染。
> ④ 就近配图由“90 秒单条目筛选”改为**跨条目贪心一对一分配**（屏幕端与 PDF 同口径；容差自适应且封顶 600s，超限而诚实纯文字卡）。
> ⑤ **原片时间戳跳转按源收窄（批 D，2026-09-20）**：仅 SEU 源不做（平台播放页无时间参数）；B 站源支持 `lessons:openSource(lessonId, at)` ——渲染层只传 lessonId 与秒数（数据，不是 URL），URL 由 main 侧常量基准 + 库内 bvid 拼出并经 `shell.openExternal` 打开（渲染层不传 URL，安全红线不破）；BV 号过正则才拼，秒数净化，多 P 带 `p=` 参数。
> **修订批注（2026-09-04，Note Revolution，用户批准）**：
> ① 阅读视图由四个扩为**五个**：+ 思维导图（knowledgeTree 的交互 SVG 投影，同源 JSON）。
> ② 四个阅读视图升级为**块模型投影**（`projectNoteBlocks`：时间线图文卡片/概念卡/公式分块/考点缺口卡/编号步骤），证据引用在渲染层与真实关键帧图片绑定（三层对齐：ref 精确匹配 → 就近关键帧 → 纯文字）。
> ③ 笔记支持「重新生成」（复用已存转写/关键帧，仅重跑总结阶段，不重下载）。
> ④ **PDF 导出转正**：主窗口 printToPDF 输出整册讲义（封面/整页导图/时间线配图/图集），vector 文本。工艺规范见 `docs/skills/note-craft/SKILL.md`。
>
> **批注（2026-09-20，UX 整改批2，见 docs/plans/2026-09-20-ux-issues-remediation.md）**：
> ⑥ **定向补全（「按体检结果补全」）的行为边界**：体检报 warn 之后，除「重新生成此笔记」之外再给一条更省的出路——**对已存盘的最新版笔记**触发一次返修，而不是重跑整条生成。边界四条：① **不发图片**，只带转写（体检报的多是「写短了 / 复读了标题 / 缺具体数字」，靠带时间的转写就能修，重发画面会让多模态费用接近翻倍）；② **只跑一次**，不做循环返修；③ warn 数**没有下降就保留原稿、不存新版本**，且判据与生成路径同一口径（含证据命中率与转写摘引命中率；其中**转写摘引**通道的 warn 才是返修修不掉的那一支——只差它时不得被报成「补全成功」；证据通道的失效引用会在返修时被剔除、命中率回到 100%，按同一把尺子判为已改善并出新版本，见方案 §2 2.2 的 v9 订正）；④ 入口在体检面板，与「重新生成此笔记」并列但语义不同（一个按体检问题修、一个重出整稿）。补全仍只把文本发给用户自己配置的 provider，§9 的既有句子已覆盖，无需新增条款。
>
> **修订批注（2026-09-21，UX 整改第二轮批5，见 docs/plans/2026-09-21-ux-optimization-round2.md）**：
> ⑦ **行内荧光笔高亮（`==文本==`）**：用户要「笔记里像荧光笔一样划重点」。md-lite 受支持集新增 `==高亮==`（渲染为 `<mark>`，屏幕与 PDF 同底色；Obsidian 原生即 `==`，导出直通不漂移）。边界：**仅 overview / methodology 两个散文字段**可用，每篇合计不超过 6 处，只标真正需要强调的定义/结论；模型 prompt 的「其余字段一律纯文本」规约同步放开该例外并带上限（`CURRENT_PROMPT_VERSION` 升版，旧笔记不回溯——要高亮需主动重新生成）。未闭合的 `==` 降级为普通文本（与 `$$` 同纪律：先前偿找闭合，绝不吞掉后面整篇内容）。

## 6. Follow-Up Questions

MVP supports questions about the current lesson only. The context is:

- Lesson transcript
- Structured note
- PPT images
- Keyframes
- Prior questions and answers for that lesson

The data model reserves course-level relationships so course-wide Q&A can be added later without redesigning storage.

> **Revision (2026-09-21, plan 2026-09-21-ux-optimization-round2 P36/P37)：**
> **① 追问坞（`.qa-dock`）改为「笔记页右侧悬浮小卡片」（2026-09-22 修订，见 docs/plans/2026-09-22-qa-dock-float-window.md）**——读笔记时提问不用切 tab 的收益保留；**坞只在笔记页渲染**（任务页/设置页不再显示——用户的使用逻辑是点开笔记才追问）。形态 = 笔记页右侧**悬浮小卡片**：**单一 `position: fixed` 形态，不依赖任何断点**——右缘与内容盒右缘对齐（`var(--space-5)`，24px）、**垂直居中**（`top: 50% + translateY(-50%)`，既不在右上角也不在右下角）；宽 = **笔记右侧那条空白本身**（`max(200px, min(260px, calc(100vw - 右缘24 - 侧栏304 - 内容左距24 - 阅读列640 - 间距12)))`——默认窗 260px，明显小于旧宽屏列的 340–520px）、高度随对话内容（最小 380px、最大内容区高 −32px，日志区自滚；卡片 `position: absolute` 挂 `.app-main`，`top: 50%` 即内容区垂直居中）；`z-index: 30`——低于四个自绘 overlay 的 40、高于内容；不是弹层——不加遮罩、不锁滚动。可一键折叠成**同位置**的**悬浮小球**（`.qa-dock-launcher`：44px 圆形图标钮，accent 填充，与卡片同一组定位值）。**宽屏方向没有任何 `min-width` 断点**——原「坞档 1400」随本方案取消，宽屏适配靠 main 侧窗口缩放（`window-zoom`）。**正文列 640 阅读铁律不变**；且**笔记盒常驻 640 阅读轴**（追问卡槽位常驻）——卡片任何窗宽都不压笔记内容（工具行/封面/时间线 chips 全部让出），且展开/折叠时笔记侧零布局变化。**坞头只有「追问 + 收起」**：无课时切换 chip——用户就在笔记内部针对当前笔记提问，切课时在侧栏课程树/笔记题头 chip/顶栏面包屑三处都可做。
> **② 追问以「该课时已有笔记」为硬门禁**——没有笔记的课时不接受提问（输入不可用 + 主侧 `qa:ask` 直接返回「该课时尚无笔记，请先为此课时生成笔记后再追问」）。原实现允许无笔记时基于转写回答、甚至在不依赖课时材料的一般性问题上作答；用户明确「这没有必要，不如直接去问网页 AI」，只保留针对笔记内部的追问。门禁放在绑定检查之前（无笔记时不该先问模型绑定）。

## 7. Task Lifecycle and Resume

Tasks use this state machine:

`pending -> fetching_course -> downloading_video -> extracting_audio -> transcribing -> extracting_visuals -> summarizing -> succeeded`

Any stage can fail and enter `failed(stage)`. Users can retry the task.

Retention and reuse rules:

- Course metadata: retained permanently.
- PPT images: retained after successful download.
- Keyframes: retained after successful extraction.
- Transcript: retained after successful transcription.
- Audio: temporary; deleted after successful transcription.
- Teacher-stream video: temporary; deleted after successful audio extraction.
- Screen-stream video: temporary; deleted after successful keyframe extraction.
- Notes: retained after successful generation; older versions are retained as history when regenerated.

Retries resume from the failed stage and reuse all previously successful outputs.

## 8. Local Library

Default library path:

`C:\Users\<username>\Documents\SEU Summary\Library`

Structure:

- `app.db`: SQLite database for courses, lessons, tasks, structured notes, and Q&A.
- `attachments/`: PPT images, keyframes, and exported Markdown.
- `cache/`: temporary videos, audio, and unfinished task data.
- `exports/`: user-exported files.

Users can move the library by selecting a new empty directory. MVP performs a one-time migration and does not support multi-disk synchronization.

## 9. Privacy and Security

- The application has no developer-owned backend.
- Audio, text, and images are sent only to user-configured ASR/LLM providers.
- Logs must not contain CAS cookies, TGTs, API keys, full video URLs, or `auth_key` values.
- Crash reporting and telemetry are disabled in MVP.
- School sessions and provider API keys are encrypted with Windows DPAPI.
- Credentials are never written to Git.
- Exports can omit attachments, but the UI warns that course materials are school teaching resources and should not be publicly redistributed.
- Temporary task files older than 24 hours are cleaned on application startup.
- Verbose network logging is disabled in release builds.

### User-facing disclosure layer

Added 2026-09-11 (user-approved plan: `docs/plans/2026-09-11-compliance-disclosure-plan.md`). The authoritative text lives in `DISCLAIMER.md` (nine clauses); the in-app text version is pinned in `src/shared/disclaimer.ts` and must stay in sync with the `文本版本` line of that file.

- **First-run consent gate**: on first launch the user must read and accept «使用须知与免责声明» before the main UI renders. Acceptance is stored together with a **text version**, and the gate re-prompts when that version changes. Declining exits the application.
- **Settings → 关于与声明 panel**: shows the app version, the non-affiliation notice, a data-flow summary, the full text, and the third-party license notices.
- **Export notice**: every export path (PDF / Markdown / clipboard / Anki / Obsidian single lesson / Obsidian whole course / mind-map SVG) shows a one-time reminder that course materials are school teaching resources and must not be publicly redistributed. This fulfils the "Exports can omit attachments, but the UI warns…" clause above.
- **Login entries** (SEU CAS and Bilibili) carry a one-line notice that the user must use their own account and that third-party access may trigger platform risk controls.
- **Provider configuration area** states that audio, images and transcripts are sent to the user-configured provider, and that retention there is governed by that provider's terms.
- **Signed stream URLs**: the complete signed URL is handed off inside the task only — cleared when the task **succeeds** and when it is **cancelled**. Only a **failed** task retains it, so that resume can avoid a re-harvest, and only for as long as the signature can still be alive (6h for SEU recordings, 100 min for Bilibili): the startup sweep `pruneStaleSignedUrlHandoffs` clears anything older. Retrying successfully, deleting the task, or clearing history also clears it immediately. The library stores sanitized paths only.
- **Third-party licenses**: `THIRD-PARTY-NOTICES.md` plus the full license texts in `LICENSES/` ship inside the installer (the bundled `ffmpeg` is GPL-3.0). The NSIS installer shows a license page.
- **Feedback channel**: the app may display a link/QR to an external feedback form and may offer to copy redacted diagnostics to the user's clipboard. It **never** transmits anything to the developer — no telemetry, no auto-report — so the "no developer-owned backend" clause above continues to hold.
- **Update check** (added 2026-09-30, user-approved plan: `docs/plans/2026-09-30-public-release-autoupdate.md`): the user can trigger a check from **Settings → 关于与声明**. The check only reads the project's GitHub Releases (version numbers and installer assets, served by GitHub) via `electron-updater`; it carries no usage data. There is no background/auto check — no network request happens until the user taps the button. Downloads are offered with on-screen progress and installed on restart. The installer is **unsigned**, so Windows SmartScreen may warn when it runs; this is stated in `DISCLAIMER.md` §8.
- **Editorial rule**: user-visible disclosure text states only facts the application can verify, and avoids legal terminology (plan D7).

## 10. Technology Direction

The selected application form is an Electron desktop application:

- Main process: TypeScript orchestration, school API client, task queue, storage, and pipeline.
- Renderer: native note and course management UI.
- Local storage: SQLite.
- External tools: `ffmpeg` for media processing; a packaged distribution strategy will be defined during implementation planning.
- Existing Playwright scripts are exploration assets only and are not bundled with the application.

## 11. MVP Acceptance Criteria

1. On a Windows machine without a development environment, the installed application starts by double-clicking and requires no command-line operation.
2. The user logs in through the in-app SEU CAS window and does not need to log in again after restarting within the session validity period.
3. When the school session expires, the app opens CAS again and resumes the failed task after re-login.
   - Revision (2026-09-01): per §2 revision, expiry surfaces as a toast + logged-out badge; CAS reopens on explicit user action and the failed task is retried manually afterwards.
4. The app automatically lists courses and lessons. Manual course ID or playback URL entry works as a fallback.
5. A real lesson of at least 45 minutes completes download, audio extraction, ASR, PPT/keyframe extraction, structured note generation, and follow-up Q&A.
6. A failed or interrupted task resumes without redownloading, retranscribing, or re-extracting already successful outputs.
7. After success, original videos and audio are deleted while the transcript, PPT, keyframes, notes, and Q&A remain in the library.
8. Multiple providers can be configured, with independent ASR and multimodal model bindings (Q&A uses the multimodal binding); keys are encrypted with DPAPI.
   - Revision (2026-09-21): 「ASR, multimodal, and text model bindings」→ 两个绑定，追问走多模态（§4 批注，P25）。
9. Structured notes support detailed, standard, key-points, methodology, and mind-map views and retain timestamped references.
   - Revision (2026-09-17): 「four views」→ 五个视图。§5 的修订批注①在 2026-09-04 已把视图由四扩为五，
     本条此前一直没跟上（spec 内部漂移），本次对齐。
10. School session expiry, download failure, ASR failure, and unsupported visual model input produce clear messages with a next action.

## 12. Deferred Work

- Bilibili source support — promoted into scope 2026-09-06 (user-approved plan, see above)
- Course-level Q&A
- Local ASR
- PDF export — promoted into scope 2026-09-04 (user-approved, see above)
- macOS support
- Cloud sync
- Automatic crash reporting
- Reusing or distributing school course materials beyond personal study
