import { useEffect, useMemo, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { Note } from '../../shared/notes/schema'
import type { NoteIndexInfo, NoteAttachmentInfo, AttachmentManifestEntry } from '../../shared/bridge'
import { evidenceHitRate } from '../../shared/notes/evidence'
import { noteHealth, HEALTH_FIELD_LABELS } from '../../shared/notes/health'
import { projectNoteBlocks, VIEW_IDS, type ViewId } from '../../shared/notes/views'
import { VIEW_LABELS } from '../labels'
import { NoteBlocks, EvidenceGallery } from './NoteBlocks'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { NoteLibrary } from './NoteLibrary'
import { MindMap } from './MindMap'
import { PageHeader } from './PageHeader'
import { LessonChip, type LessonChipLesson } from './LessonChip'
import { EmptyState } from './EmptyState'
import { FeedbackSection } from './FeedbackSection'

/** 试卷头 (V4): the lesson's identity line — course · teacher · lesson. */
export interface LessonContext {
  courseName: string
  teacher?: string
  lessonTitle: string
}

export interface NoteViewerProps {
  note: Note | null
  /** F4 (review): identity manifest + lazy per-ref lookup (undefined = loading).
  /** 2026-09-04: lesson keyframes/PPT images, resolved per ref on demand. */
  attachmentManifest?: AttachmentManifestEntry[]
  getAttachment?: (ref: string) => NoteAttachmentInfo | null | undefined
  /** Bumped whenever a new attachment resolves so the view re-renders. */
  attachmentVersion?: number
  /** Lesson identity for the exam-paper masthead (V4). */
  lesson?: LessonContext | null
  /** 批A: sibling lessons for the header chip's quick-switch dropdown. */
  lessonOptions?: LessonChipLesson[]
  /** 批A: id of the selected lesson (chips' active-row highlight). */
  currentLessonId?: string
  /** 批B: cross-lesson library shown instead of the dead empty state. */
  library?: NoteIndexInfo[]
  /** 批C: 笔记库总数（> library.length 即被截断）——标题据此写实。 */
  libraryTotal?: number
  /** 批C 批2: 笔记库搜索词（主进程过滤）+ 变更回调。 */
  libraryQuery?: string
  onLibraryQuery?: (value: string) => void
  /** 批C 批3: 列表还没取完时给「显示更多」（按页加长）。 */
  onLibraryMore?: () => void
  /** 批B: open a library entry = select that lesson globally. */
  onOpenLesson?: (lessonId: string) => void
  /** 质量批4: upgrade a course's stale notes from the library group head. */
  onUpgradeCourse?: (courseId: string, label: string) => void
  /** Obsidian 批2: export the whole course into the vault. */
  onExportCourseObsidian?: (courseId: string, label: string) => void
  /** A7: jump to the tasks tab when the selected lesson has no note. */
  onGoTasks?: () => void
  /** B4: «上一节/下一节» neighbors within the same course (sorted order;
   *  structural subset — only id/title are used, any lesson row fits). */
  prevLesson?: { id: string; title: string } | null
  nextLesson?: { id: string; title: string } | null
  /** B4: navigate to a neighbor lesson (stays on the notes tab). */
  onNavigateLesson?: (lessonId: string) => void
  /** Regenerate in flight (button busy state). */
  regenBusy?: boolean
  /** 2026-09-04: regenerate the note from stored transcripts/keyframes. */
  onRegenerate?: () => void
  /** 2026-09-04: export the full-lesson PDF handout. */
  pdfBusy?: boolean
  /** 健康巡查 2026-09-12 批5: the in-flight export kind (null = idle) —
   *  export buttons disable while any export runs, the matching one reads
   *  «导出中…» (native save dialogs must not stack). */
  exportBusy?: string | null
  onExportPdf?: () => void
  onExport?: () => void
  /** Obsidian 批1: structured vault export (vault picked on first run). */
  onExportObsidian?: () => void
  /** 2026-09-04 roadmap 2.2: export Anki TSV decks (concepts + quiz). */
  onExportAnki?: () => void
  /** M3.3 (map expansion): export the knowledge tree as a standalone SVG. */
  onExportSvg?: () => void
  /** 批5: 位图导出（光栅化在渲染层，main 只写字节）。 */
  onExportPng?: () => void
  /** Copy the markdown rendering to the clipboard (best-effort). */
  onCopy?: () => void
  /** 批5: feedback polish in flight (button busy state). */
  polishBusy?: boolean
  /** 批5: submit feedback → the model revises the latest note into version N+1. */
  onPolish?: (feedback: { tags: string[]; text: string }) => void
}

/** Five-view note reader: one note JSON, five projections (2026-09-04). */
/**
 * 批C (plan 2026-09-18 note-library-reachability): 标题必须写实——此前硬编码
 * 「最近 200 条」，上限改了文案不会跟着改，而被截断时**从不告诉用户**：既不知道
 * 有更早的笔记，也不知道去哪找。现在总数由数据算出来，截断时补一句出路。
 */
function libraryHeading(shown: number, total: number, query = ''): string {
  // 搜索时标题说匹配数——否则「共 2 条」会被误读成库里的总数。
  const keyword = query.trim()
  if (keyword !== '') return `「${keyword}」匹配 ${total} 条笔记`
  if (total > shown) return `全部笔记（共 ${total} 条 · 这里显示最近 ${shown} 条）— 更早的可在左侧课程树里按课程打开`
  return `全部笔记（共 ${total} 条）— 点击一条即可查看与追问`
}

export function NoteViewer({
  note,
  attachmentManifest = [],
  getAttachment,
  attachmentVersion = 0,
  lesson = null,
  lessonOptions,
  currentLessonId,
  library = [],
  libraryTotal,
  libraryQuery = '',
  onLibraryQuery,
  onLibraryMore,
  onOpenLesson,
  onUpgradeCourse,
  onExportCourseObsidian,
  onGoTasks,
  prevLesson = null,
  nextLesson = null,
  onNavigateLesson,
  regenBusy = false,
  onRegenerate,
  pdfBusy = false,
  exportBusy = null,
  onExportPdf,
  onExport,
  onExportObsidian,
  onExportAnki,
  onExportSvg,
  onExportPng,
  onCopy,
  polishBusy = false,
  onPolish
}: NoteViewerProps): JSX.Element {
  const [view, setView] = useState<ViewId>('detailed')
  // 批C 批2: 搜索中即使零命中也要渲染列表本体——搜索框不能跟着消失（否则用户没法
  // 清空查询），「尚无笔记」也会错误暗示库里一条都没有。
  const searchingLibrary = libraryQuery.trim() !== ''
  const showLibrary = library.length > 0 || searchingLibrary
  // M2.2: concept-card anchor for the mind map popover's «view in detail» jump.
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null)
  // 批3 (plan 2026-09-08 note-quality-overhaul): 内容体检面板开合；换笔记即收。
  const [healthOpen, setHealthOpen] = useState(false)
  useEffect(() => {
    setHealthOpen(false)
  }, [note])
  useEffect(() => {
    if (view !== 'detailed' || pendingAnchor == null) return
    // Wait a frame so the detailed projection mounts before scrolling.
    requestAnimationFrame(() => {
      const escaped = pendingAnchor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const card = document.querySelector(`[data-concept-term="${escaped}"]`)
      if (card != null && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center' })
      setPendingAnchor(null)
    })
  }, [view, pendingAnchor])
  const jumpToConcept = (term: string): void => {
    setView('detailed')
    setPendingAnchor(term)
  }
  // Citation quality signal (roadmap 1.3): share of cited evidence refs that
  // resolve to real attachments; hidden when the note cites none.
  const hitRate = note != null ? evidenceHitRate(note, attachmentManifest) : null
  // 批3: 内容体检——纯函数投影（批1 质量规约的可观测面）。
  const health = note != null ? noteHealth(note, hitRate) : null
  // 批4: 投影 memo——note/view 不变时，无关 state 变更（如体检面板开合）
  // 不重新投影，NoteBlocks 也不会因拿到新 blocks 数组而整树重渲染。
  const sections = useMemo(() => (note == null ? [] : projectNoteBlocks(note, view)), [note, view])
  return (
    <div class="note-viewer">
      <PageHeader
        title="笔记"
        chip={
          lesson != null ? (
            <LessonChip
              courseName={lesson.courseName}
              lessonTitle={lesson.lessonTitle}
              lessons={lessonOptions}
              currentLessonId={currentLessonId}
              onSelectLesson={onNavigateLesson}
            />
          ) : undefined
        }
      />
      {/* 2026-09-05: the toolbar only makes sense with a note on screen —
          five-view tabs + export actions over an empty body mislead. */}
      {note != null && (
        <div class="note-toolbar">
          <nav
            class="note-tabs"
            role="tablist"
            onKeyDown={(e) => {
              // M3-2: roving-focus arrow navigation, matching the main tabs.
              const buttons = [...e.currentTarget.querySelectorAll('button')]
              const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
              if (i < 0) return
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault()
                const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]
                next?.focus()
                next?.click()
              }
            }}
          >
            {VIEW_IDS.map((id) => (
              <button
                key={id}
                id={`note-tab-${id}`}
                class={id === view ? 'active' : ''}
                role="tab"
                aria-selected={id === view}
                aria-controls="note-body-panel"
                tabIndex={id === view ? 0 : -1}
                onClick={() => setView(id)}
              >
                {VIEW_LABELS[id]}
              </button>
            ))}
          </nav>
          <div class="note-actions">
            {onNavigateLesson != null && (prevLesson != null || nextLesson != null) && (
              <span class="lesson-nav">
                <button
                  class="btn small"
                  disabled={prevLesson == null}
                  title={prevLesson?.title ?? '已是第一节'}
                  onClick={() => {
                    if (prevLesson != null) onNavigateLesson(prevLesson.id)
                  }}
                >
                  ‹ 上一节
                </button>
                <button
                  class="btn small"
                  disabled={nextLesson == null}
                  title={nextLesson?.title ?? '已是最后一节'}
                  onClick={() => {
                    if (nextLesson != null) onNavigateLesson(nextLesson.id)
                  }}
                >
                  下一节 ›
                </button>
              </span>
            )}
            {health != null && (
              <button
                class="btn small note-health-toggle"
                title="内容体检——对照批1 质量规约检查这份笔记"
                onClick={() => setHealthOpen(!healthOpen)}
              >
                {health.warnCount > 0 ? `体检：${health.warnCount} 项待改进` : '体检：良好'}
              </button>
            )}
            {hitRate != null && hitRate.total > 0 && (
              <span class="badge" title={`时间线证据引用精确命中附件 ${hitRate.hits}/${hitRate.total}`}>
                引用命中 {hitRate.hits}/{hitRate.total}
              </span>
            )}
            {onRegenerate != null && note != null && (
              <button class="btn small" onClick={onRegenerate} disabled={regenBusy}>
                {regenBusy ? '生成中…' : '重新生成'}
              </button>
            )}
            {/* 批6 (T43): 工具行按「维护 · 导出 · 主行动」三域分组（与导图工具栏
                同一套分隔线）。此前 7 个按钮平铺，4 个导出动作无从分辨主次。 */}
            {onCopy != null && note != null && (
              <>
                <span class="toolbar-divider" aria-hidden="true" />
                <button class="btn small" onClick={onCopy}>
                  复制 Markdown
                </button>
              </>
            )}
            {onExportAnki != null && note != null && (
              <button class="btn small" onClick={onExportAnki} disabled={exportBusy != null}>
                {exportBusy === 'anki' ? '导出中…' : '导出 Anki'}
              </button>
            )}
            {onExport != null && note != null && (
              <button class="btn small" onClick={onExport} disabled={exportBusy != null}>
                {exportBusy === 'markdown' ? '导出中…' : '导出 Markdown'}
              </button>
            )}
            {onExportObsidian != null && note != null && (
              <button
                class="btn small"
                onClick={onExportObsidian}
                disabled={exportBusy != null}
                title="结构化 Markdown 写入 Obsidian 仓库（首次需选择仓库目录）"
              >
                {exportBusy === 'obsidian' ? '导出中…' : '导出 Obsidian'}
              </button>
            )}
            {/* A5/D9 (plan 2026-09-13): the page's primary action sits LAST and
                pins to the right edge of the 860 axis — the wrapped second row
                used to end 126px short with the green button second from the
                left. */}
            {onExportPdf != null && (
              <>
                <span class="toolbar-divider" aria-hidden="true" />
                <button class="btn small primary note-pdf-btn" onClick={onExportPdf} disabled={pdfBusy}>
                  {pdfBusy ? '生成 PDF 中…' : '导出 PDF 讲义'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {/* 批3: 体检面板——findings 列表 + warn 时直达重新生成。 */}
      {note != null && healthOpen && health != null && (
        <div class="note-health-panel">
          <ul>
            {health.findings.length === 0 && <li class="info">各项检查通过，未发现待改进项。</li>}
            {health.findings.map((finding) => (
              <li key={`${finding.field}-${finding.message}`} class={finding.level}>
                <span class="health-field">{HEALTH_FIELD_LABELS[finding.field]}</span>
                {finding.message}
              </li>
            ))}
          </ul>
          {health.warnCount > 0 && onRegenerate != null && (
            <button class="btn small" onClick={onRegenerate} disabled={regenBusy}>
              {regenBusy ? '生成中…' : '重新生成此笔记'}
            </button>
          )}
        </div>
      )}
      {/* 批3 (plan 2026-09-07 v07): masthead lives OUTSIDE .note-body so the
          lesson title keeps one constant width in every view — the mindmap
          breakout (max-width:none) used to drag the title full width.
          批3 (plan 2026-09-18): 该宽度从 860 收到正文列 640（D3，同屏两个右缘
          差 180px）；超长标题（B站视频名）降一档字号，全文进 title。 */}
      {note != null && lesson != null && (
        <header class="note-masthead">
          <h2 class={`note-title${lesson.courseName.length > 28 ? ' note-title-long' : ''}`} title={lesson.courseName}>
            {lesson.courseName}
          </h2>
          <p class="note-meta">{[lesson.teacher, lesson.lessonTitle].filter((x): x is string => x != null && x !== '').join(' · ')}</p>
        </header>
      )}
      {note == null ? (
        <>
          {/* A7: when a lesson IS selected, say so — the library must not
              mask «this lesson has no note yet». 批E: card empty state.
              批3: empty states render outside the 680 reading column so the
              card width matches the tasks/qa tabs on the 860 axis. */}
          {lesson != null && onGoTasks != null && (
            <div class="note-empty-current" data-testid="note-empty-current">
              <EmptyState
                title={`「${lesson.lessonTitle}」尚无笔记`}
                hint="运行任务生成后，这节课的五视图笔记会显示在这里。"
                actionLabel="去创建任务"
                onAction={onGoTasks}
              />
            </div>
          )}
          {lesson == null ? (
            // 2026-09-05: home view mirrors the tasks tab — guide card,
            // then the library under its own subheading.
            // A3 (plan 2026-09-13): with a non-empty library the «尚无笔记»
            // hero card contradicted the list right below it (3 courses of
            // notes under a card claiming there are none) — a one-line hint
            // replaces the card and the list leads. The card stays for the
            // truly-empty case.
            onOpenLesson != null && showLibrary ? (
              <>
                <p class="msg">笔记在任务生成后自动显示；从左侧课程树点一个课时即可创建任务。</p>
                <h3 class="subheading">{libraryHeading(library.length, libraryTotal ?? library.length, libraryQuery)}</h3>
                <NoteLibrary
                  entries={library}
                  query={libraryQuery}
                  onQuery={onLibraryQuery}
                  total={libraryTotal}
                  onMore={onLibraryMore}
                  onOpenLesson={onOpenLesson} onUpgradeCourse={onUpgradeCourse} onExportCourseObsidian={onExportCourseObsidian} exportBusy={exportBusy} />
              </>
            ) : (
              <EmptyState title="尚无笔记" hint="运行任务生成后自动显示；已有的笔记会列在这里供直接打开。" />
            )
          ) : onOpenLesson != null && showLibrary ? (
            <>
              <p class="msg">或打开其他笔记：</p>
              <NoteLibrary
                  entries={library}
                  query={libraryQuery}
                  onQuery={onLibraryQuery}
                  total={libraryTotal}
                  onMore={onLibraryMore}
                  onOpenLesson={onOpenLesson} onUpgradeCourse={onUpgradeCourse} onExportCourseObsidian={onExportCourseObsidian} exportBusy={exportBusy} />
            </>
          ) : null}
        </>
      ) : (
        <div class="note-body" data-view={view} id="note-body-panel" role="tabpanel" aria-labelledby={`note-tab-${view}`}>
          {view === 'mindmap' ? (
            <MindMap
              tree={note.knowledgeTree}
              concepts={note.concepts}
              quiz={note.quiz}
              conceptLinks={note.conceptLinks}
              onViewDetailed={jumpToConcept}
              onExportSvg={onExportSvg}
              onExportPng={onExportPng}
              exportBusy={exportBusy}
            />
          ) : (
            sections.map((section) => (
              <ErrorBoundary key={section.heading} area="note-view">
              <section key={section.heading} class="note-section">
                <h3>{section.heading}</h3>
                <NoteBlocks blocks={section.blocks} getAttachment={getAttachment} manifest={attachmentManifest} version={attachmentVersion} />
                </section>
              </ErrorBoundary>
            ))
          )}
          {view === 'detailed' && (
            <section class="note-section">
              <h3>课堂画面</h3>
              <ErrorBoundary area="note-gallery">
                <EvidenceGallery note={note} getAttachment={getAttachment} manifest={attachmentManifest} version={attachmentVersion} />
              </ErrorBoundary>
            </section>
          )}
        </div>
      )}
      {/* 批5: feedback polish — end of the note, every view except the mindmap
          (the map is a canvas, not prose to revise). */}
      {note != null && view !== 'mindmap' && onPolish != null && <FeedbackSection busy={polishBusy} onSubmit={onPolish} />}
    </div>
  )
}
