# SEU Summary Desktop MVP Design

## 1. Product Position

SEU Summary is a Windows desktop application that turns Southeast University Kedacom course recordings into structured study notes. The application is local-first, distributable to other students, and requires no developer-owned server. Each user logs in with their own SEU CAS account and provides their own model provider credentials.

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
- Optional text model name

Capabilities are bound independently:

- ASR: provider + model
- Multimodal summarization: provider + model
- Text summarization: provider + model, optional

The first-run experience recommends a single provider that supports both ASR and multimodal input. Advanced settings allow ASR, multimodal summarization, and text summarization to use different providers and keys.

All provider communication uses OpenAI-compatible APIs. The default note generation path uses a multimodal model. A text-only model is a fallback for users who explicitly choose it.

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

> **清单维护批注（2026-09-17）**：本清单此前已落后于实现——`quiz`、`conceptLinks`、
> `terms` 与时间线条目的 `evidence` 都不在旧清单里，批2 又新增了 `Concept.example`。
> 本次一并补齐，并把「清单须随实现更新」当作常态维护项（AGENTS 的一致性纪律）。

Markdown export is a secondary exchange format. PDF export is not included in MVP.

> **修订批注（2026-09-04，Note Revolution，用户批准）**：
> ① 阅读视图由四个扩为**五个**：+ 思维导图（knowledgeTree 的交互 SVG 投影，同源 JSON）。
> ② 四个阅读视图升级为**块模型投影**（`projectNoteBlocks`：时间线图文卡片/概念卡/公式分块/考点缺口卡/编号步骤），证据引用在渲染层与真实关键帧图片绑定（三层对齐：ref 精确匹配 → 就近关键帧 → 纯文字）。
> ③ 笔记支持「重新生成」（复用已存转写/关键帧，仅重跑总结阶段，不重下载）。
> ④ **PDF 导出转正**：主窗口 printToPDF 输出整册讲义（封面/整页导图/时间线配图/图集），vector 文本。工艺规范见 `docs/skills/note-craft/SKILL.md`。

## 6. Follow-Up Questions

MVP supports questions about the current lesson only. The context is:

- Lesson transcript
- Structured note
- PPT images
- Keyframes
- Prior questions and answers for that lesson

The data model reserves course-level relationships so course-wide Q&A can be added later without redesigning storage.

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
8. Multiple providers can be configured, with independent ASR, multimodal, and text model bindings; keys are encrypted with DPAPI.
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
