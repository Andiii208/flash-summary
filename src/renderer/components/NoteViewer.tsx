import { useEffect, useMemo, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { Note } from '../../shared/notes/schema'
import type { NoteIndexInfo, NoteAttachmentInfo, AttachmentManifestEntry } from '../../shared/bridge'
import { evidenceHitRate, allocateTimelineImagesLazy, formatTime } from '../../shared/notes/evidence'
import { noteHealth, HEALTH_FIELD_LABELS } from '../../shared/notes/health'
import { projectNoteBlocks, VIEW_IDS, type ViewId } from '../../shared/notes/views'
import { toPlainText } from '../../shared/notes/md-lite'
import { escapeSelectorValue } from '../../shared/notes/dom'
import { InlineText } from './InlineText'
import { VIEW_LABELS } from '../labels'
import { NoteBlocks, EvidenceGallery } from './NoteBlocks'
import { NoteExportMenu } from './NoteExportMenu'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { NoteLibrary } from './NoteLibrary'
import { MindMap } from './MindMap'
import { MindMapFullDialog } from './MindMapFullDialog'
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
  /** 批2 (plan 2026-09-20, P17): 课程体检在飞——「升级旧笔记」按钮读「读取中…」并禁用。 */
  upgradeBusy?: boolean
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
  /** 批 A2 (plan 2026-09-19): 课时封面 data URL；null 时用第一张关键帧兜底。 */
  coverDataUrl?: string | null
  /** 批3 (plan 2026-09-20, P1): 当前课程来源——只有 B 站源给「重新获取封面」入口
   *  （SEU 源平台没有封面，不给会失败的按钮）。课程级来源是课时来源的可靠代理。 */
  courseSource?: 'seu' | 'bilibili'
  /** 批3: 封面回填在途态（按钮读「获取中…」并禁用）。 */
  coverBackfillBusy?: boolean
  /** 批3: 从 B 站重新取一次封面（无封面且有入口时才渲染）。 */
  onBackfillCover?: () => void
  /** 批2 (plan 2026-09-20, P7): main 侧算好的转写摘引命中率（渲染层没有转写）。
   *  喂给下面那个 noteHealth —— 徽标与升级列表因此同一口径。 */
  noteTranscriptHitRate?: { hits: number; total: number } | null
  /** 批 D (plan 2026-09-19): B 站课时「跳原片」（at 秒）；SEU 源不传——按钮不渲染，不给会失败的入口。 */
  onOpenSource?: (at: number) => void
  /** P30 (plan 2026-09-21): 图集空态的自救入口——重新运行任务再抽一次帧。仅 B 站源
      由 App 传入（SEU 源重跑要重新下载整片，贵且大概率无效，不给这个按钮）。 */
  onRefetchFrames?: () => void
  /** Regenerate in flight (button busy state). */
  regenBusy?: boolean
  /** 2026-09-04: regenerate the note from stored transcripts/keyframes. */
  onRegenerate?: () => void
  /** 批2 (plan 2026-09-20, P2): 定向补全在途态（体检面板的「按体检结果补全」）。 */
  repairBusy?: boolean
  /** 批2: 只按体检问题修一次——不发图、修不好保留原稿。 */
  onRepair?: () => void
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
  /** 批6 (H21): 复制在途——按钮读「复制中…」并禁用（连点不再并发写剪贴板）。 */
  copyBusy?: boolean
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
  upgradeBusy = false,
  onExportCourseObsidian,
  onGoTasks,
  prevLesson = null,
  nextLesson = null,
  onNavigateLesson,
    onOpenSource,
    onRefetchFrames,
    coverDataUrl = null,
  courseSource = 'seu',
  coverBackfillBusy = false,
  onBackfillCover,
  noteTranscriptHitRate = null,
  regenBusy = false,
  onRegenerate,
  repairBusy = false,
  onRepair,
  pdfBusy = false,
  exportBusy = null,
  onExportPdf,
  onExport,
  onExportObsidian,
  onExportAnki,
  onExportSvg,
  onExportPng,
  onCopy,
  copyBusy = false,
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
  // P51 (plan 2026-09-22): 导图「全图」全屏浏览弹层；同样是阅后即收的临时态。
  const [fullMapOpen, setFullMapOpen] = useState(false)
  useEffect(() => {
    setHealthOpen(false)
  }, [note])
  useEffect(() => {
    if (view !== 'detailed' || pendingAnchor == null) return
    // Wait a frame so the detailed projection mounts before scrolling.
    requestAnimationFrame(() => {
      // 批5 (H12): 概念名是模型文本，拼进属性选择器前必须转义——含 " 或 \ 时
      // querySelector 直接 SyntaxError，跳转静默失效（转义判据唯一一份在
      // shared/notes/dom.ts，下面 TOC 高亮处复用同一个）。
      const escaped = escapeSelectorValue(pendingAnchor)
      const card = document.querySelector(`[data-concept-term="${escaped}"]`)
      if (card != null && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center' })
      setPendingAnchor(null)
    })
  }, [view, pendingAnchor])
  // C1: 章节 chip 跳转（与概念卡跳转同渠道：scrollIntoView 存在性守卫）。
  const jumpToChapter = (at: number): void => {
    const target = document.querySelector(`[data-chapter-at="${at}"]`)
    if (target != null && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' })
  }
  const jumpToConcept = (term: string): void => {
    setView('detailed')
    setPendingAnchor(term)
  }
  // Citation quality signal (roadmap 1.3): share of cited evidence refs that
  // resolve to real attachments; hidden when the note cites none.
  // Citation quality signal (roadmap 1.3): share of cited evidence refs that
  // resolve to real attachments; hidden when the note cites none.
  const hitRate = note != null ? evidenceHitRate(note, attachmentManifest) : null
  // B6 (plan 2026-09-19): 时间线配图覆盖率——与时间线卡片同一分配函数＋体检面板
  // 据此诚实呈现「多少条没有图」（无图是合法态，只报 info 不拉低评级）。
  // 依赖里的 attachmentVersion 不能去（与 TimelineCards/coverSrc 同款口径）：懒加载
  // 首渲染 get(ref) 全 undefined → 覆盖率算成 0/N；附件解析完成 bump 后才会算对。
  const imageCoverage = useMemo(() => {
    if (note == null || note.timeline.length === 0) return null
    const allocated = allocateTimelineImagesLazy(note.timeline, getAttachment ?? (() => null), attachmentManifest)
    return { withImage: allocated.filter((images) => images.length > 0).length, total: note.timeline.length }
  }, [note, getAttachment, attachmentManifest, attachmentVersion])
  // 批 A2: 封面 data URL 优先；没有封面（SEU 源/导入失败）退回最早的关键帧。
  // 依赖里带 attachmentVersion——首帧是懒加载的，解析到位后会重算。
  const coverSrc = useMemo(() => {
    if (coverDataUrl != null) return coverDataUrl
    const frames = attachmentManifest.filter((m) => m.ref.startsWith('kf:') && m.at != null)
    if (frames.length === 0 || getAttachment == null) return null
    // 兜底封面帧挑选（实拍回购 2026-09-20）：0s 标题页带 pillarbox 黑边、白底，
    // 当封面像「空图/坏图」。启发式取 60 秒后的第一帧（越过标题页），没有再退最后一张。
    // 不为「猜内容」引入图像分析——只做时间启发式。
    const ordered = [...frames].sort((a, b) => (a.at as number) - (b.at as number))
    const past = ordered.find((f) => (f.at as number) >= 60)
    const pick = past ?? ordered[ordered.length - 1]
    return getAttachment(pick.ref)?.dataUrl ?? null
  }, [coverDataUrl, attachmentManifest, getAttachment, attachmentVersion])
  // C3 (plan 2026-09-19): sticky 目录的当前高亮——滚动时取“最后一个跳过视口顶部的锚点”。
  // 环境守卫：happy-dom 不触发 scroll，初始高亮第一条即可。
  const [tocActive, setTocActive] = useState<string>('')
  useEffect(() => {
    if (note == null) return
    const anchors = [...(note.chapters ?? []).map((c) => `chapter:${c.at}`), ...note.concepts.map((c) => `concept:${c.term}`)]
    if (anchors.length === 0) return
    const onScroll = (): void => {
      let active = anchors[0] ?? ''
      for (const anchor of anchors) {
        const el =
          anchor.startsWith('chapter:')
            ? document.querySelector(`[data-chapter-at="${anchor.slice(8)}"]`)
            // 批5 (H12): 概念名未转义就拼进选择器——含引号/反斜杠的概念
            // （模型自由文本）会让这一行抛 SyntaxError，高亮静默失效。
            : document.querySelector(`[data-concept-term="${escapeSelectorValue(anchor.slice(8))}"]`)
        if (el != null && (el as HTMLElement).offsetTop <= window.scrollY + 80) active = anchor
      }
      setTocActive(active)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [note])

/** C1: 阅读时长估算（中文 约 400 字/分钟，含时间线/概念/金句正文）。 */
function noteReadMinutes(note: Note): number {
  const chars =
    note.overview.length +
    note.timeline.reduce((sum, t) => sum + t.title.length + t.detail.length, 0) +
    note.concepts.reduce((sum, c) => sum + c.term.length + c.definition.length + (c.example?.length ?? 0), 0) +
    (note.quotes ?? []).reduce((sum, q) => sum + q.text.length, 0) +
    (note.chapters ?? []).reduce((sum, c) => sum + c.title.length + c.summary.length, 0)
  return chars / 400
}
  // 批3: 内容体检——纯函数投影（批1 质量规约的可观测面）。
  const health = note != null ? noteHealth(note, hitRate, noteTranscriptHitRate, imageCoverage) : null
  // 批4: 投影 memo——note/view 不变时，无关 state 变更（如体检面板开合）
  // 不重新投影，NoteBlocks 也不会因拿到新 blocks 数组而整树重渲染。
  const sections = useMemo(() => (note == null ? [] : projectNoteBlocks(note, view)), [note, view])
  return (
    <div class="note-viewer">
      {/* P48: 题头右侧上下文组 = 课时身份 chip + 课时导航。「上一节/下一节」是**导航**
          （在课时之间移动），不是对这篇笔记的动作——把它混在动作行里正是工具行混乱的
          源头之一；移上来后动作行只剩「对这篇笔记做什么」。 */}
      <PageHeader
        title="笔记"
        chip={
          <span class="page-head-context">
            {lesson != null && (
              <LessonChip
                courseName={lesson.courseName}
                lessonTitle={lesson.lessonTitle}
                lessons={lessonOptions}
                currentLessonId={currentLessonId}
                onSelectLesson={onNavigateLesson}
              />
            )}
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
          </span>
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
          {/* P48: 行动行 = 三个**组内不换行**的组（组间才换）——维护 · 输出 · 主行动。
              旧结构把 9 个按钮平铺让 flex-wrap 自由切，分隔线被拦腰切断、主按钮被
              margin-left:auto 孤悬在最右（Andiii：「布局太混乱了，一点也不整齐」）。 */}
          <div class="note-actions">
            <span class="note-action-group">
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
            </span>
            {/* 输出组：复制 + 其它导出（Anki / Markdown / Obsidian 收进菜单）。 */}
            <span class="note-action-group">
              <span class="toolbar-divider" aria-hidden="true" />
              {onCopy != null && note != null && (
                /* 批6 (H21): 复制终于有了在途态——导出家族唯一漏 busy 的按钮 */
                <button class="btn small" onClick={onCopy} disabled={copyBusy}>
                  {copyBusy ? '复制中…' : '复制 Markdown'}
                </button>
              )}
              <NoteExportMenu
                onExportAnki={onExportAnki != null && note != null ? () => onExportAnki() : undefined}
                onExport={onExport != null && note != null ? () => onExport() : undefined}
                onExportObsidian={onExportObsidian != null && note != null ? () => onExportObsidian() : undefined}
                exportBusy={exportBusy}
              />
            </span>
            {/* 主行动：A5/D9 (plan 2026-09-13) 的「主行动在最后、贴右缘」沿用——改为挂在
                主行动组上（组内仍居末），640 轴上不再被 wrap 扔到孤行。 */}
            <span class="note-action-group note-action-primary">
              <span class="toolbar-divider" aria-hidden="true" />
              {onExportPdf != null && (
                /* 批5 (plan 2026-09-28 H11): PDF 与其它导出串行化——任一导出在途
                   时本按钮也禁用（否则两个原生保存框同时弹）。在途的正是 PDF 时
                   读「生成 PDF 中…」，别的导出在途时读「导出中…」（与菜单同口径）。 */
                <button
                  class="btn small primary note-pdf-btn"
                  onClick={onExportPdf}
                  disabled={pdfBusy || exportBusy != null}
                >
                  {pdfBusy ? '生成 PDF 中…' : exportBusy != null ? '导出中…' : '导出 PDF 讲义'}
                </button>
              )}
            </span>
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
          {health.warnCount > 0 && onRepair != null && (
            <button
              class="btn small note-repair-btn"
              title="只按体检问题修，不重新发送画面；修不好就保留原稿"
              onClick={onRepair}
              disabled={repairBusy || regenBusy}
            >
              {repairBusy ? '补全中…' : '按体检结果补全'}
            </button>
          )}
          {health.warnCount > 0 && onRegenerate != null && (
            <button class="btn small" onClick={onRegenerate} disabled={regenBusy || repairBusy}>
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
          {coverSrc != null && <img class="note-cover" src={coverSrc} alt="" loading="lazy" />}
          {/* 批3 (plan 2026-09-20, P1/D8): 没有落库封面且是 B 站源时才给这个入口——
              导入时只抓一次，失败即静默放弃；012 之前导入的课时根本没有封面。 */}
          {coverDataUrl == null && courseSource === 'bilibili' && onBackfillCover != null && (
            <button
              class="btn small ghost note-cover-backfill"
              title="从 B 站重新取一次封面（此前抓取失败或导入时还没有这个能力）"
              disabled={coverBackfillBusy}
              onClick={onBackfillCover}
            >
              {coverBackfillBusy ? '获取中…' : '重新获取封面'}
            </button>
          )}
          <h2 class={`note-title${lesson.courseName.length > 28 ? ' note-title-long' : ''}`} title={lesson.courseName}>
            {lesson.courseName}
          </h2>
          <p class="note-meta">{[lesson.teacher, lesson.lessonTitle].filter((x): x is string => x != null && x !== '').join(' · ')}</p>
          {/* C1 (plan 2026-09-19): 章节 chips + 阅读时长——第一屏就知道“这篇多长、分几块、怎么跳”。 */}
          {(note.chapters ?? []).length > 0 && (
            <nav class="note-chapter-chips" aria-label="章节导航">
              {note.chapters.map((c) => (
                <button key={c.at} class="chapter-chip" onClick={() => jumpToChapter(c.at)} title={`${formatTime(c.at)} ${toPlainText(c.summary)}`}>
                  {/* 批4 (H3): chip 文字与 summary tooltip 都是模型文本 */}
                  <InlineText text={c.title} />
                </button>
              ))}
            </nav>
          )}
          <p class="note-readtime">{`约 ${Math.max(1, Math.round(noteReadMinutes(note)))} 分钟读完`}</p>
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
                  onOpenLesson={onOpenLesson} onUpgradeCourse={onUpgradeCourse} upgradeBusy={upgradeBusy} onExportCourseObsidian={onExportCourseObsidian} exportBusy={exportBusy} />
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
                  onOpenLesson={onOpenLesson} onUpgradeCourse={onUpgradeCourse} upgradeBusy={upgradeBusy} onExportCourseObsidian={onExportCourseObsidian} exportBusy={exportBusy} />
            </>
          ) : null}
        </>
      ) : (
        <>
        {view === 'detailed' && note != null && ((note.chapters ?? []).length > 0 || note.concepts.length > 0) && (
          <nav class="note-toc-sticky" aria-label="本页目录">
            {note.chapters.map((c) => (
              <button
                key={`c-${c.at}`}
                class={`toc-item${tocActive === `chapter:${c.at}` ? ' active' : ''}`}
                onClick={() => {
                  setTocActive(`chapter:${c.at}`)
                  const target = document.querySelector(`[data-chapter-at="${c.at}"]`)
                  if (target != null && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' })
                }}
              >
                <span class="toc-item-at">{formatTime(c.at)}</span>
                <InlineText text={c.title} />
              </button>
            ))}
            {note.concepts.map((c) => (
              <button
                key={`k-${c.term}`}
                class={`toc-item toc-concept${tocActive === `concept:${c.term}` ? ' active' : ''}`}
                onClick={() => {
                  setTocActive(`concept:${c.term}`)
                  jumpToConcept(c.term)
                }}
                title={`概念：${toPlainText(c.term)}（点击定位）`}
              >
                <InlineText text={c.term} />
              </button>
            ))}
          </nav>
        )}
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
              onOpenFullMap={() => setFullMapOpen(true)}
            />
          ) : (
            sections.map((section) => (
              <ErrorBoundary key={section.heading} area="note-view">
              <section key={section.heading} class="note-section">
                <h3>{section.heading}</h3>
<NoteBlocks blocks={section.blocks} getAttachment={getAttachment} manifest={attachmentManifest} version={attachmentVersion} onOpenSource={onOpenSource} />
                </section>
              </ErrorBoundary>
            ))
          )}
          {view === 'detailed' && (
            <section class="note-section">
              <h3>课堂画面</h3>
              <ErrorBoundary area="note-gallery">
<EvidenceGallery note={note} getAttachment={getAttachment} manifest={attachmentManifest} version={attachmentVersion} onOpenSource={onOpenSource} onRefetchFrames={courseSource === 'bilibili' ? onRefetchFrames : undefined} />
              </ErrorBoundary>
            </section>
          )}
        </div>
        </>
      )}
      {/* P51: 导图全图浏览弹层——只在思维导图视图开过；换视图/换笔记都随手关。 */}
      {fullMapOpen && note != null && (
        <MindMapFullDialog
          tree={note.knowledgeTree}
          concepts={note.concepts}
          conceptLinks={note.conceptLinks}
          onViewDetailed={jumpToConcept}
          onExportSvg={onExportSvg}
          onExportPng={onExportPng}
          exportBusy={exportBusy}
          onClose={() => setFullMapOpen(false)}
        />
      )}
      {/* 批5: feedback polish — end of the note, every view except the mindmap
          (the map is a canvas, not prose to revise). */}
      {note != null && view !== 'mindmap' && onPolish != null && <FeedbackSection busy={polishBusy} onSubmit={onPolish} />}
    </div>
  )
}
