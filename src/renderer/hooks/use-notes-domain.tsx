/**
 * Notes domain (批8, plan 2026-09-19 D5): lesson note + attachments + the
 * cross-lesson library + the export family + regenerate/polish/存量升级 +
 * course map. Reads the bridge, the toasts and the export copyright guard;
 * the app shell composes it into useAppState (use-config-domain 同范式).
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { render } from 'preact'
import type { AttachmentManifestEntry, CourseTreeInfo, LatestNoteResult, NoteAttachmentInfo, NoteHealthInfo, NoteIndexInfo, SeuSummaryBridge } from '../../shared/bridge'
import type { Note } from '../../shared/notes/schema'
import type { ApiResult } from '../../shared/api-result'
import { noteToMarkdown } from '../../shared/notes/markdown'
import { treeToSvgDocument } from '../../shared/notes/mindmap-svg'
import { svgToPngBase64 } from '../rasterize-svg'
import { PrintHandout } from '../components/PrintHandout'
import type { CourseMapInfo } from '../components/CourseMapDialog'
import type { Toast } from './use-config-domain'

/** 2026-09-04: wait for every <img> in the print handout to decode before
 * printing — printToPDF snapshots the live DOM, undecoded images come out blank. */
function waitForImages(root: HTMLElement): Promise<void> {
  const images = [...root.querySelectorAll('img')]
  return Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          })
    )
  ).then(() => undefined)
}

/** 批C 批3: 分页步长（「显示更多」每次加一页）。与主进程默认上限的关系：
 *  首次取的就是主进程默认值（笔记 200）之外更小的**首屏页**，
 *  用户点「显示更多」按页加长——列表越长越慢，所以不一次全给。 */
const NOTE_PAGE = 100

export interface NotesDomain {
    note: Note | null
    /** 批2 (plan 2026-09-20, P7): 转写摘引命中率（main 侧算，随 loadNote 设置/清空）。
     *  喂给 NoteViewer 的**同一个** noteHealth，徽标与升级列表从此同源。 */
    noteTranscriptHitRate: { hits: number; total: number } | null
    /** 课时笔记/附件/库索引加载——挂载、换课、任务完成、regen 后都经这里刷。 */
    loadNote: (lessonId: string) => Promise<void>
    loadAttachments: (lessonId: string) => Promise<void>
    loadNoteIndex: () => Promise<void>
    /** 批B: cross-lesson note library (notes tab empty state). */
    noteIndex: NoteIndexInfo[]
    /** 批C: 笔记库总数（> noteIndex.length 即为被截断）。 */
    noteIndexTotal: number
    /** 批C 批2: 笔记库搜索词与 setter。 */
    noteQuery: string
    setNoteQuery: (value: string) => void
    /** 批C 批3: 「显示更多」——按页加长列表（不改主进程上限，走 limit 参数）。 */
    showMoreNotes: () => void
    /** 质量批4: 存量升级对话框数据 + 逐课运行状态（笔记库课程组入口）。 */
    noteUpgrade: { open: boolean; courseId: string; label: string; loading: boolean; items: NoteHealthInfo[] }
    /** 批2 (plan 2026-09-20, P17): 「升级旧笔记」按钮的在途态（课程体检在飞）。
     *  与 noteUpgrade.loading 区分——后者是对话框内列表的加载态。 */
    noteUpgradeLoading: boolean
    /** 批2 (plan 2026-09-20, P4): failed 是 lessonId → 失败原因——此前只记「失败」，
     *  用户看不到是任务占用、未绑模型还是超时（同一批每课同一个隐藏原因）。 */
    noteUpgradeRun: { busy: boolean; running: ReadonlySet<string>; done: ReadonlySet<string>; failed: ReadonlyMap<string, string> }
    openNoteUpgrade: (courseId: string, label: string) => void
    closeNoteUpgrade: () => void
    runNoteUpgrade: (lessonIds: string[]) => void
    exportNote: (lessonId: string) => void
    /** Obsidian 批1: structured vault export. */
    exportNoteObsidian: (lessonId: string) => void
    /** Obsidian 批2: whole-course vault export. */
    exportCourseObsidian: (courseId: string, label: string) => void
    /** 2026-09-04 roadmap 2.2: export Anki TSV decks (concepts + quiz). */
    exportNoteAnki: (lessonId: string) => void
    /** M3.3 (map expansion): export the knowledge tree as a standalone SVG. */
    exportNoteSvg: (lessonId: string) => void
    /** 批5: 位图导出（渲染层光栅化）。 */
    exportNotePng: (lessonId: string, note: Note) => void
    /** M4.1 (map expansion): open the course-level mind map dialog. */
    openCourseMap: (courseId: string) => void
    courseMap: CourseMapInfo | null
    closeCourseMap: () => void
    copyNote: () => void
    /** 2026-09-04: regenerate + attachments + PDF handout for the note views. */
    attachmentManifest: AttachmentManifestEntry[]
    getAttachment: (ref: string) => NoteAttachmentInfo | null | undefined
    attachmentVersion: number
    /** 批 A2: 课时封面 data URL（无封面 null，NoteViewer 用首帧兜底）。 */
    coverDataUrl: string | null
    noteRegenBusy: boolean
    regenerateNote: (lessonId: string) => void
    /** 批2 (plan 2026-09-20, P2): 定向补全在途态（只按体检问题修，不发图）。 */
    noteRepairBusy: boolean
    /** 批2: 对已存盘的最新版笔记按体检问题补全一次。 */
    repairNote: (lessonId: string) => void
    /** 批5: feedback polish (busy + submit → new note version). */
    notePolishBusy: boolean
    polishNote: (lessonId: string, feedback: { tags: string[]; text: string }) => void
    pdfBusy: boolean
    /** 健康巡查 2026-09-12 批5: the in-flight export kind (null = idle). */
    exportBusy: string | null
    /** 健康巡查 2026-09-12 批5: course-map aggregation in flight. */
    courseMapBusy: boolean
    exportNotePdf: (lessonId: string) => void
    /** 批A: 换课/退出登录时清掉本域残留（note + manifest + 解析缓存）。 */
    clearLessonData: () => void
}

export interface NotesDomainDeps {
  /** 选课 ref——与 tasks/qa 域共用同一把尺：慢响应不得覆盖当前课时。 */
  lessonRef: { current: string }
  /** 声明批4: 导出版权提醒包装（settings 与 optOut 在 config 域，经此注入）。 */
  guardExport: (run: () => void) => void
  /** PDF 导出与复制依赖原样保留（课程/课时身份查树）。 */
  tree: CourseTreeInfo[]
  currentLesson: string
}

export function useNotesDomain(bridge: SeuSummaryBridge, toast: Toast, deps: NotesDomainDeps): NotesDomain {
  const { lessonRef, guardExport, tree, currentLesson } = deps

  const [note, setNote] = useState<Note | null>(null)
  /** 批2 (P7): 与笔记一起到达的转写命中率（渲染层自己算不出来——没有转写）。 */
  const [noteTranscriptHitRate, setNoteTranscriptHitRate] = useState<{ hits: number; total: number } | null>(null)
  /** 批B: cross-lesson note library + recent Q&A (tab empty states). */
  const [noteIndex, setNoteIndex] = useState<NoteIndexInfo[]>([])
  /** 批C: 列表的**总数**（不受 LIMIT 影响）——界面据此如实说明是否被截断。 */
  const [noteIndexTotal, setNoteIndexTotal] = useState(0)
  /** 批C 批2: 笔记库搜索词（主进程过滤，见 ipc.ts notes:list）。 */
  const [noteQuery, setNoteQuery] = useState('')
  /** 批C 批3: 分页步长——「显示更多」每次加一页（沿用 M3-2 的「分块 + 显式展开」）。 */
  const [noteLimit, setNoteLimit] = useState(NOTE_PAGE)

  // 既有 7 处 `void loadNoteIndex()` / `loadGlobalHistory()` 想的是「按当前口径重取」，
  // 所以把当前口径放 ref 里读，调用点不必逐个改签名。
  const noteListRef = useRef({ keyword: '', limit: NOTE_PAGE })
  noteListRef.current = { keyword: noteQuery.trim(), limit: noteLimit }

  /** F4 (review): attachment MANIFEST (identity only) + lazily resolved data.
  /** 2026-09-04: lesson attachment identities for the note views. */
  const [attachmentManifest, setAttachmentManifest] = useState<AttachmentManifestEntry[]>([])
  /** Bumped per resolved image so lazy views re-render. */
  const [attachmentVersion, setAttachmentVersion] = useState(0)
  /** 批 A2 (plan 2026-09-19): 课时封面 data URL（B 站导入落盘；无封面为 null）。 */
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null)
  const [noteRegenBusy, setNoteRegenBusy] = useState(false)
  // 质量批4 (plan 2026-09-08 note-quality-overhaul): 存量升级——对话框与逐课状态。
  const [noteUpgrade, setNoteUpgrade] = useState<{ open: boolean; courseId: string; label: string; loading: boolean; items: NoteHealthInfo[] }>({
    open: false,
    courseId: '',
    label: '',
    loading: false,
    items: []
  })
  const [noteUpgradeRun, setNoteUpgradeRun] = useState<{ busy: boolean; running: ReadonlySet<string>; done: ReadonlySet<string>; failed: ReadonlyMap<string, string> }>({
    busy: false,
    running: new Set(),
    done: new Set(),
    failed: new Map()
  })
  /** 批2 (P17): 「升级旧笔记」入口的在途态 + 同 tick 连点守卫。 */
  const [noteUpgradeLoading, setNoteUpgradeLoading] = useState(false)
  const noteUpgradeLoadingRef = useRef(false)
  // 批5: feedback polish busy state (independent of regenerate).
  const [notePolishBusy, setNotePolishBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  // 健康巡查 2026-09-12 批5: one export in flight at a time — double-clicking
  // an export button used to open two native save dialogs. The kind names the
  // running export so its own button can read «导出中…»; the ref guard closes
  // the same-tick double-click race the state alone would miss.
  const [exportBusy, setExportBusy] = useState<string | null>(null)
  const exportBusyRef = useRef<string | null>(null)
  /** M4.1: open course-level mind map (null = closed). */
  const [courseMap, setCourseMap] = useState<CourseMapInfo | null>(null)

  // All three lesson-scoped loaders guard on lessonRef: a slow response for
  // a previously selected lesson must not overwrite the current one's panel.
  const loadNote = useCallback(async (lessonId: string): Promise<void> => {
    setCoverDataUrl(null)
    // 批2 (P7): 换课时先清掉上一课的转写命中率——否则徽标会拿旧课的指标算。
    setNoteTranscriptHitRate(null)
    const res = (await bridge.notes.latest(lessonId)) as ApiResult<LatestNoteResult | null>
    if (res.ok && res.value != null && lessonRef.current === lessonId) {
      setNote(res.value.note)
      setNoteTranscriptHitRate(res.value.transcriptHitRate ?? null)
    }
    // 批 A2: 封面与笔记并行取（best-effort——拿不到就 null，首屏退回无图）。
    void (async () => {
      try {
        const cover = (await bridge.notes.cover(lessonId)) as ApiResult<string | null>
        if (lessonRef.current === lessonId) setCoverDataUrl(cover.ok ? (cover.value ?? null) : null)
      } catch {
        if (lessonRef.current === lessonId) setCoverDataUrl(null)
      }
    })()
  }, [bridge])

  // F4 (review): per-ref attachment cache. getAttachment returns undefined
  // while a fetch is in flight, and the view re-renders on arrival via
  // attachmentVersion — one small IPC per image instead of one giant one.
  const attachmentCache = useRef(new Map<string, NoteAttachmentInfo | null>())
  const attachmentInflight = useRef(new Set<string>())
  const loadAttachments = useCallback(
    async (lessonId: string): Promise<void> => {
      const res = await bridge.notes.attachments(lessonId)
      if (res.ok && res.value != null && lessonRef.current === lessonId) setAttachmentManifest(res.value)
    },
    [bridge]
  )
  const resolveAttachment = useCallback(
    (lessonId: string, ref: string): void => {
      const cacheKey = `${lessonId}:${ref}`
      if (attachmentCache.current.has(cacheKey) || attachmentInflight.current.has(cacheKey)) return
      attachmentInflight.current.add(cacheKey)
      void (async () => {
        try {
          const res = await bridge.notes.attachmentData(lessonId, ref)
          const value = res.ok ? (res.value ?? null) : null
          attachmentCache.current.set(cacheKey, value)
        } finally {
          attachmentInflight.current.delete(cacheKey)
          // 批4: 一批附件全部解析完成后一次 bump——逐张 bump 会让每个关键帧都
          // 触发整棵笔记树重渲染；in-flight 集合清空即这一批结束。
          if (attachmentInflight.current.size === 0 && lessonRef.current === lessonId) {
            setAttachmentVersion((v) => v + 1)
          }
        }
      })()
    },
    [bridge]
  )
  const getAttachment = useCallback(
    (ref: string): NoteAttachmentInfo | null | undefined => {
      const lessonId = lessonRef.current
      const cacheKey = `${lessonId}:${ref}`
      const cached = attachmentCache.current.get(cacheKey)
      if (cached !== undefined || attachmentCache.current.has(cacheKey)) return cached ?? null
      if (lessonId !== '') resolveAttachment(lessonId, ref)
      return undefined
    },
    [resolveAttachment]
  )
  /** PDF print needs EVERY image before rendering (waitForImages semantics). */
  const loadAllAttachments = useCallback(
    async (lessonId: string): Promise<NoteAttachmentInfo[]> => {
      const results = await Promise.all(
        attachmentManifest.map(async (entry) => {
          const res = await bridge.notes.attachmentData(lessonId, entry.ref)
          return res.ok ? (res.value ?? null) : null
        })
      )
      return results.filter((a): a is NoteAttachmentInfo => a != null)
    },
    [bridge, attachmentManifest]
  )

  /** 批B: cross-lesson library + recent Q&A feed the tab empty states. */
  const loadNoteIndex = useCallback(async (): Promise<void> => {
    const { keyword, limit } = noteListRef.current
    const res = await bridge.notes.list({ ...(keyword === '' ? {} : { keyword }), limit })
    if (res.ok && res.value != null) {
      setNoteIndex(res.value.items)
      setNoteIndexTotal(res.value.total)
    }
  }, [bridge])

  // 批C 批2/批3: 搜索词或分页步长变化 → 去抖重取（每次按键都打一次 IPC 没必要）。
  useEffect(() => {
    const timer = setTimeout(() => void loadNoteIndex(), 200)
    return () => clearTimeout(timer)
  }, [noteQuery, noteLimit, loadNoteIndex])

  /** 健康巡查 2026-09-12 批5: serialize the export family (markdown /
   *  obsidian / anki / course-obsidian / svg) — native save dialogs must not
   *  stack. While busy, every export button disables and the triggering one
   *  reads «导出中…». PDF keeps its own pdfBusy (in-page render, pre-existing). */
  const withExportBusy = useCallback((kind: string, run: () => Promise<void>): void => {
    if (exportBusyRef.current != null) return
    exportBusyRef.current = kind
    setExportBusy(kind)
    void run().finally(() => {
      exportBusyRef.current = null
      setExportBusy(null)
    })
  }, [])

  const runExportNote = useCallback(
    (lessonId: string): void => {
      withExportBusy('markdown', async () => {
        const res = await bridge.notes.exportMarkdown(lessonId)
        if (!res.ok) {
          toast(res.error ?? '导出失败', 'error')
          return
        }
        if (res.value?.canceled) return
        // 批E: close the loop — the exports folder is one click away.
        const filePath = res.value?.path ?? ''
        toast(`已导出：${filePath}`, 'success', {
          actionLabel: '打开所在文件夹',
          onAction: () => {
            void bridge.notes.revealFile(filePath)
          }
        })
      })
    },
    [bridge, toast, withExportBusy]
  )

  /** Obsidian 批1: structured export into the user's vault — first run asks
   *  for the vault root once, later runs overwrite the same file silently. */
  const runExportNoteObsidian = useCallback(
    (lessonId: string): void => {
      withExportBusy('obsidian', async () => {
        const res = await bridge.notes.exportObsidian(lessonId)
        if (!res.ok) {
          toast(res.error ?? '导出失败', 'error')
          return
        }
        if (res.value?.canceled) return
        const filePath = res.value?.path ?? ''
        toast(`已导出到 Obsidian 仓库（v${res.value?.version ?? '?'}）`, 'success', {
          actionLabel: '打开所在文件夹',
          onAction: () => {
            void bridge.notes.revealFile(filePath)
          }
        })
      })
    },
    [bridge, toast, withExportBusy]
  )

  /** Obsidian 批2: whole-course vault export (lessons + derived pages). */
  const runExportCourseObsidian = useCallback(
    (courseId: string, label: string): void => {
      withExportBusy('course-obsidian', async () => {
        const res = await bridge.notes.exportCourseObsidian(courseId)
        if (!res.ok) {
          toast(res.error ?? '导出失败', 'error')
          return
        }
        if (res.value?.canceled) return
        const exported = res.value?.exported ?? 0
        const skipped = res.value?.skipped ?? 0
        // 批3 (P23): 失败篇目带原因到达——此前 vault 不可写时界面只说「N 个课时
        // 无笔记已跳过」，用户以为那些课时只是没有笔记。失败优先于跳过说。
        const failures = res.value?.failures ?? []
        if (failures.length > 0) {
          const reasons = failures.slice(0, 2).map((f) => f.reason).join('；')
          const noNote = Math.max(0, skipped - failures.length)
          const noNoteSuffix = noNote > 0 ? `，另有 ${noNote} 个课时无笔记` : ''
          toast(`已将《${label}》导出 ${exported} 篇，${failures.length} 篇失败：${reasons}；详见日志${noNoteSuffix}`, 'info')
          return
        }
        const skipSuffix = skipped > 0 ? `，${skipped} 个课时无笔记已跳过` : ''
        toast(`已将《${label}》${exported} 个课时导出到 Obsidian 仓库（含概念聚合页）${skipSuffix}`, 'success')
      })
    },
    [bridge, toast, withExportBusy]
  )

  /** 2026-09-04 roadmap 2.2: Anki TSV decks — toast carries a reveal action. */
  const runExportNoteAnki = useCallback(
    (lessonId: string): void => {
      withExportBusy('anki', async () => {
        const res = await bridge.notes.exportAnki(lessonId)
        if (!res.ok) {
          toast(res.error ?? '导出失败', 'error')
          return
        }
        const value = res.value
        if (value == null || value.canceled || value.paths.length === 0) return
        toast(`已导出 ${value.paths.length} 个牌堆文件`, 'success', {
          actionLabel: '打开所在文件夹',
          onAction: () => void bridge.notes.revealFile(value.paths[0] ?? '')
        })
      })
    },
    [bridge, toast, withExportBusy]
  )

  /** M3.3 (map expansion): export the knowledge tree as a standalone SVG. */
  const runExportNoteSvg = useCallback(
    (lessonId: string): void => {
      withExportBusy('svg', async () => {
        const res = await bridge.notes.exportSvg(lessonId)
        if (!res.ok) {
          toast(res.error ?? '导出失败', 'error')
          return
        }
        if (res.value?.canceled) return
        const filePath = res.value?.path ?? ''
        toast(`已导出：${filePath}`, 'success', {
          actionLabel: '打开所在文件夹',
          onAction: () => {
            void bridge.notes.revealFile(filePath)
          }
        })
      })
    },
    [bridge, toast, withExportBusy]
  )

  /**
   * 批5 (plan 2026-09-17 item 3): 导图位图导出。
   *
   * 分工：渲染层用 `treeToSvgDocument` 自己产 SVG（纯函数，不必经 IPC 往返）→
   * canvas 光栅化（canvas 只在渲染层有）→ 把 PNG base64 交给 main 落盘。
   * main 侧只解码 + 校验魔数 + 写文件，于是**零新依赖**（无需图像编码器）。
   */
  const runExportNotePng = useCallback(
    (lessonId: string, note: Note): void => {
      withExportBusy('png', async () => {
        try {
          const doc = treeToSvgDocument(note.knowledgeTree, note.conceptLinks, note.knowledgeTree.title)
          const raster = await svgToPngBase64(doc.svg, doc.width, doc.height)
          const res = await bridge.notes.exportPng(lessonId, raster.base64)
          if (!res.ok) {
            toast(res.error ?? '导出失败', 'error')
            return
          }
          if (res.value?.canceled) return
          const filePath = res.value?.path ?? ''
          toast(`已导出：${filePath}`, 'success', {
            actionLabel: '打开所在文件夹',
            onAction: () => {
              void bridge.notes.revealFile(filePath)
            }
          })
        } catch (e) {
          toast((e as Error).message || '导出失败', 'error')
        }
      })
    },
    [bridge, toast, withExportBusy]
  )

  /** M4.1 (map expansion): aggregate the course's latest trees into one map. */
  const [courseMapBusy, setCourseMapBusy] = useState(false)
  const openCourseMap = useCallback(
    (courseId: string): void => {
      // 健康巡查 2026-09-12 批5: aggregation can take seconds on large
      // courses — the button must say so and not re-trigger.
      if (courseMapBusy) return
      setCourseMapBusy(true)
      void (async () => {
        try {
          const res = await bridge.notes.courseTree(courseId)
          if (!res.ok) {
            toast(res.error ?? '课程导图打开失败', 'error')
            return
          }
          const value = res.value
          if (value == null) return
          // The merged tree's root title IS the course name (filled main-side).
          setCourseMap({
            courseName: value.tree.title,
            tree: value.tree,
            lessons: value.lessons,
            skipped: value.skipped
          })
        } finally {
          setCourseMapBusy(false)
        }
      })()
    },
    [bridge, toast, courseMapBusy]
  )

  /** 2026-09-04: regenerate the note from stored transcripts/keyframes. */
  const regenerateNote = useCallback(
    (lessonId: string): void => {
      void (async () => {
        setNoteRegenBusy(true)
        try {
          const res = await bridge.notes.regenerate(lessonId)
          if (!res.ok) {
            toast(res.error ?? '重新生成失败', 'error')
            return
          }
          // Citation quality signal (roadmap 1.3): hidden when nothing cited.
          const result = res.value
          if (result == null) {
            toast('重新生成失败：返回数据缺失', 'error')
            return
          }
          const hitSuffix = result.hitRate.total > 0 ? `，引用命中 ${result.hitRate.hits}/${result.hitRate.total}` : ''
          // 批1: 转写摘引可核验率（与视觉锚分列，口径不同）——同样无可判时隐藏。
          const quoteSuffix =
            result.transcriptHitRate != null && result.transcriptHitRate.total > 0
              ? `，摘引可核验 ${result.transcriptHitRate.hits}/${result.transcriptHitRate.total}`
              : ''
          // F2 (review): fabricated refs are dropped before persisting — say so.
          const dropSuffix = (result.droppedRefs ?? 0) > 0 ? `，剔除 ${result.droppedRefs} 条无效引用` : ''
          // 批3: 归一层丢弃计数——「模型没写」与「写了但被拦下」是两种问题，后者此前
          // 在界面上完全不可见（用户只看到「内容有点少」）。
          const normalizedTotal = Object.values(result.normalizationDropped ?? {}).reduce((acc, n) => acc + n, 0)
          const normalSuffix = normalizedTotal > 0 ? `，${normalizedTotal} 项格式不合法已丢弃` : ''
          // A1: 绑定模型无视觉时说清楚——否则用户看到「没图」会以为系统坏了，而那本来就是合法降级。
  const visionSuffix = result.visionCapable === false ? '，当前模型无视觉能力，画面靠时间就近对齐' : ''

  // A3: 真的零素材（风控/无流）与“模型看不见”不同囸——原因要说清楚。
  const assetSuffix =
    result.visualAssets != null && result.visualAssets.keyframes === 0 && result.visualAssets.ppt === 0
      ? '，本课时未取得画面素材（视频流可能被平台拦截，重试导入可能恢复）'
      : ''
  // B4 (plan 2026-09-19): 越界 at 被铳制时说一声——用户该知道「刚才有几个时间点是模型外推的」。
          const clampSuffix = (result.clampedTimes ?? 0) > 0 ? `，${result.clampedTimes} 个越界时间已校正` : ''
          // 批3: 返修真的发生时把「N 项 → M 项」说出来——否则用户不知道系统改善过什么。
          const repairSuffix =
            result.health?.repaired === true && result.health.warnCountBeforeRepair != null
              ? `，体检 ${result.health.warnCountBeforeRepair} 项 → ${result.health.warnCount} 项`
              : ''
          toast(`已生成第 ${result.version} 版笔记${hitSuffix}${quoteSuffix}${dropSuffix}${normalSuffix}${clampSuffix}${visionSuffix}${assetSuffix}${repairSuffix}`, 'success')
          await loadNote(lessonId)
          await loadNoteIndex()
        } finally {
          setNoteRegenBusy(false)
        }
      })()
    },
    [bridge, toast, loadNote, loadNoteIndex]
  )

  /** 批5 (plan 2026-09-07 v07): feedback polish — send the user's feedback and
   *  the latest note back to the model; the revision lands as version N+1. */
  const polishNote = useCallback(
    (lessonId: string, feedback: { tags: string[]; text: string }): void => {
      void (async () => {
        setNotePolishBusy(true)
        try {
          const res = await bridge.notes.polish(lessonId, feedback)
          if (!res.ok) {
            toast(res.error ?? '润色失败', 'error')
            return
          }
          const result = res.value
          if (result == null) {
            toast('润色失败：返回数据缺失', 'error')
            return
          }
          const hitSuffix = result.hitRate.total > 0 ? `，引用命中 ${result.hitRate.hits}/${result.hitRate.total}` : ''
          // 批1: 与重生成同形——转写摘引可核验率，无可判时隐藏。
          const quoteSuffix =
            result.transcriptHitRate != null && result.transcriptHitRate.total > 0
              ? `，摘引可核验 ${result.transcriptHitRate.hits}/${result.transcriptHitRate.total}`
              : ''
          const dropSuffix = (result.droppedRefs ?? 0) > 0 ? `，剔除 ${result.droppedRefs} 条无效引用` : ''
          toast(`已生成第 ${result.version} 版润色笔记${hitSuffix}${quoteSuffix}${dropSuffix}`, 'success')
          await loadNote(lessonId)
          await loadNoteIndex()
        } finally {
          setNotePolishBusy(false)
        }
      })()
    },
    [bridge, toast, loadNote, loadNoteIndex]
  )

  /**
   * 批2 (plan 2026-09-20, P2): 定向补全——体检面板的「按体检结果补全」。
   * 与 regenerate 的差别：不发图片、只跑一次、修不好就保留原稿（版本号不变）。
   * busy 三件套 + hook 侧 in-flight 守卫（ref 守住同 tick 连点，state 只管视觉）。
   */
  const [noteRepairBusy, setNoteRepairBusy] = useState(false)
  const noteRepairBusyRef = useRef(false)
  const repairNote = useCallback(
    (lessonId: string): void => {
      if (noteRepairBusyRef.current) return
      noteRepairBusyRef.current = true
      setNoteRepairBusy(true)
      void (async () => {
        try {
          const res = await bridge.notes.repair(lessonId)
          if (!res.ok) {
            toast(res.error ?? '补全失败', 'error')
            return
          }
          const result = res.value
          if (result == null) {
            toast('补全失败：返回数据缺失', 'error')
            return
          }
          // 「N 项 → M 项」只在真的采纳过返修时才说（口径与生成路径同一份体检）。
          if (result.repaired && result.health.warnCountBeforeRepair != null) {
            toast(`已补全：体检 ${result.health.warnCountBeforeRepair} 项 → ${result.health.warnCount} 项`, 'success')
          } else {
            toast('补完没有改善，已保留原稿', 'info')
          }
          await loadNote(lessonId)
          await loadNoteIndex()
        } finally {
          noteRepairBusyRef.current = false
          setNoteRepairBusy(false)
        }
      })()
    },
    [bridge, toast, loadNote, loadNoteIndex]
  )

  /** 质量批4: open the upgrade picker — fetch the course's per-lesson health. */
  const openNoteUpgrade = useCallback(
    (courseId: string, label: string): void => {
      // 批2 (plan 2026-09-20, P17): in-flight 守卫——连点两次此前会并发拉两次课程
      // 体检，晚到的响应覆盖先到的（用户看到的是哪一门课全看网络时序）。
      // ref 守同 tick 的连点，state 只管按钮的视觉与文案。
      if (noteUpgradeLoadingRef.current) return
      noteUpgradeLoadingRef.current = true
      setNoteUpgradeLoading(true)
      setNoteUpgrade({ open: true, courseId, label, loading: true, items: [] })
      setNoteUpgradeRun({ busy: false, running: new Set(), done: new Set(), failed: new Map() })
      void (async () => {
        try {
          const res = await bridge.notes.courseHealth(courseId)
          if (res.ok && res.value != null) {
            setNoteUpgrade((prev) => ({ ...prev, open: true, loading: false, items: res.value as NoteHealthInfo[] }))
          } else {
            setNoteUpgrade((prev) => ({ ...prev, open: false, loading: false }))
            toast(res.error ?? '读取体检结果失败', 'error')
          }
        } finally {
          noteUpgradeLoadingRef.current = false
          setNoteUpgradeLoading(false)
        }
      })()
    },
    [bridge, toast]
  )

  const closeNoteUpgrade = useCallback((): void => {
    setNoteUpgrade((prev) => ({ ...prev, open: false }))
    setNoteUpgradeRun({ busy: false, running: new Set(), done: new Set(), failed: new Map() })
  }, [])

  /** 质量批4: upgrade sequentially — one notes:regenerate per lesson (reuse
   *  stored transcripts/keyframes; the handler's own guards apply per call). */
  const runNoteUpgrade = useCallback(
    (lessonIds: string[]): void => {
      // 空载荷＝没有可跑的课时。**调用方（NoteUpgradeDialog）负责先裁掉已完成项，
      // 并据此禁用按钮**——这里直接返回，界面上不会出现「点了没反应」（评审补口：
      // 裁剪若只做在确认回调里，按钮会写着「升级所选（1）」却什么都不执行）。
      if (lessonIds.length === 0) return
      void (async () => {
        // 批2 (P6，含评审补口): 状态**跨轮累积**——done 记的是「这次会话里已经成功的
        // 课时」。此前每轮开头把 done/failed 清空，于是重试一轮之后上一轮的成功项又变回
        // idle：行上的「✓ 已升级」消失，第三次点击会把它们**再跑一遍全量生成**（正是
        // P6 要消灭的浪费），而对话框的「升级所选（N）」也跟着撒谎。同一课时永远只落在
        // done/failed 一边：成功把它从 failed 划掉，失败把它从 done 划掉。
        const done = new Set(noteUpgradeRun.done)
        const failed = new Map(noteUpgradeRun.failed)
        setNoteUpgradeRun({ busy: true, running: new Set(lessonIds), done: new Set(done), failed: new Map(failed) })
        setNoteRegenBusy(true)
        try {
          for (const lessonId of lessonIds) {
            const res = await bridge.notes.regenerate(lessonId)
            if (res.ok) {
              done.add(lessonId)
              failed.delete(lessonId)
            } else {
              // 批2 (P4): 记下每课的真实失败原因（res.error），不再只留一个「失败」。
              failed.set(lessonId, res.error ?? '未知原因')
              done.delete(lessonId)
            }
          }
          // 批2 (P5): 升级成功的是**当前打开的这一课**时，把笔记与徽标一起刷新——
          // 此前只刷库索引，用户停在被升级的课时上看到的还是旧版本与旧徽标，
          // 很容易读成「没生效」。刷库仍只此一次（逐课刷全库是 N 倍开销）。
          if (currentLesson !== '' && done.has(currentLesson)) await loadNote(currentLesson)
          await loadNoteIndex()
        } finally {
          setNoteRegenBusy(false)
          // 落状态时另拷一份，避免把 state 里的对象继续就地改。
          setNoteUpgradeRun({ busy: false, running: new Set(), done: new Set(done), failed: new Map(failed) })
        }
        // 批2 (P4): toast 汇总第一条真实原因，其余引导到行内（每行都写了原因）。
        const firstReason = failed.values().next().value ?? ''
        const failedSuffix =
          failed.size > 0 ? `，${failed.size} 个课时失败：${firstReason}${failed.size > 1 ? '；其余原因见各行' : ''}` : ''
        if (done.size > 0) toast(`已升级 ${done.size} 个课时笔记，体检徽标可复核结果${failedSuffix}`, failed.size > 0 ? 'info' : 'success')
        else toast('升级失败：所选课时都未能重新生成', 'error')
      })()
    },
    [bridge, toast, loadNote, loadNoteIndex, currentLesson, noteUpgradeRun]
  )

  /** 2026-09-04: full-lesson PDF handout (cover → mind map → body → gallery). */
  const runExportNotePdf = useCallback(
    (lessonId: string): void => {
      void (async () => {
        if (note == null) return
        setPdfBusy(true)
        const printRoot = document.getElementById('print-root')
        const previousTitle = document.title
        try {
          const dialog = await bridge.notes.exportPdfDialog(lessonId)
          if (!dialog.ok) {
            toast(dialog.error ?? '导出失败', 'error')
            return
          }
          if (dialog.value?.canceled || dialog.value?.path == null) return

          const course = tree.find((c) => c.lessons.some((l) => l.id === lessonId))
          const lessonInfo = course?.lessons.find((l) => l.id === lessonId)
          // Render the handout, then let every image decode before printing.
          // F4: the print path resolves the FULL manifest first.
          const printAttachments = await loadAllAttachments(lessonId)
          render(
            <PrintHandout
              note={note}
              attachments={printAttachments}
              courseName={course?.name ?? ''}
              lessonTitle={lessonInfo?.title ?? lessonId}
              teacher={course?.teacher}
              courTimes={course?.courTimes}
              classroom={course?.classroom}
              generatedAt={new Date().toLocaleString('zh-CN')}
            />,
            printRoot!
          )
          await waitForImages(printRoot!)
          // 批4: the per-page print header reads the document title — lend it
          // the course·lesson identity for the print, then hand it back.
          document.title = `${course?.name ?? ''} · ${lessonInfo?.title ?? lessonId}`
          // E3 (review): the token, not the path — main decides where to write.
          const res = await bridge.notes.exportPdfWrite(dialog.value.token ?? '')
          if (!res.ok) {
            toast(res.error ?? 'PDF 生成失败', 'error')
            return
          }
          const filePath = res.value?.path ?? ''
          toast(
            `已导出 PDF（${Math.round((res.value?.bytes ?? 0) / 1024)} KB）：${filePath}`,
            'success',
            {
              actionLabel: '打开所在文件夹',
              onAction: () => {
                void bridge.notes.revealFile(filePath)
              }
            }
          )
        } finally {
          document.title = previousTitle
          render(null, printRoot!)
          setPdfBusy(false)
        }
      })()
    },
    [bridge, toast, note, attachmentManifest, loadAllAttachments, tree]
  )

  const runCopyNote = useCallback((): void => {
    if (note == null) return
    void navigator.clipboard
      .writeText(noteToMarkdown(note, '课程笔记'))
      .then(() => toast('已复制 Markdown 到剪贴板', 'success'))
      .catch(() => toast('复制失败', 'error'))
  }, [note, tree, currentLesson, toast])

  // 声明批4: 七个导出出口统一从这里出去——出口清单与 spec §9「每个导出路径都提示」
  // 一一对应：PDF 讲义 / Markdown / 剪贴板 / Anki / Obsidian 单课时 / Obsidian 整课 /
  // 导图 SVG。**新增导出路径必须在这里包一层**，否则会绕过版权提醒。
  const exportNote = useCallback((lessonId: string): void => guardExport(() => runExportNote(lessonId)), [guardExport, runExportNote])
  const exportNoteObsidian = useCallback((lessonId: string): void => guardExport(() => runExportNoteObsidian(lessonId)), [guardExport, runExportNoteObsidian])
  const exportCourseObsidian = useCallback(
    (courseId: string, label: string): void => guardExport(() => runExportCourseObsidian(courseId, label)),
    [guardExport, runExportCourseObsidian]
  )
  const exportNoteAnki = useCallback((lessonId: string): void => guardExport(() => runExportNoteAnki(lessonId)), [guardExport, runExportNoteAnki])
  const exportNoteSvg = useCallback((lessonId: string): void => guardExport(() => runExportNoteSvg(lessonId)), [guardExport, runExportNoteSvg])
  const exportNotePng = useCallback((lessonId: string, note: Note): void => guardExport(() => runExportNotePng(lessonId, note)), [guardExport, runExportNotePng])
  const exportNotePdf = useCallback((lessonId: string): void => guardExport(() => runExportNotePdf(lessonId)), [guardExport, runExportNotePdf])
  const copyNote = useCallback((): void => guardExport(runCopyNote), [guardExport, runCopyNote])


  /** 批A: 换课/退出登录时清掉本域残留（note + manifest + 解析缓存）。 */
  const clearLessonData = useCallback((): void => {
    setNote(null)
    setNoteTranscriptHitRate(null)
    setAttachmentManifest([])
    attachmentCache.current.clear()
  }, [])

  return {
    note,
    noteTranscriptHitRate,
    loadNote,
    loadAttachments,
    loadNoteIndex,
    noteIndex,
    noteIndexTotal,
    noteQuery,
    setNoteQuery,
    showMoreNotes: () => setNoteLimit((n) => n + NOTE_PAGE),
    noteUpgrade,
    noteUpgradeLoading,
    noteUpgradeRun,
    openNoteUpgrade,
    closeNoteUpgrade,
    runNoteUpgrade,
    attachmentManifest,
    getAttachment,
    attachmentVersion,
    coverDataUrl,
    noteRegenBusy,
    regenerateNote,
    noteRepairBusy,
    repairNote,
    notePolishBusy,
    polishNote,
    pdfBusy,
    exportBusy,
    courseMapBusy,
    exportNotePdf,
    exportNote,
    exportNoteObsidian,
    exportCourseObsidian,
    exportNoteAnki,
    exportNoteSvg,
    exportNotePng,
    openCourseMap,
    courseMap,
    closeCourseMap: () => setCourseMap(null),
    copyNote,
    clearLessonData
  }
}
