import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { Maximize2, X } from 'lucide-preact'
import type { QaRecentInfo } from '../../shared/bridge'
import { formatRelativeStamp } from '../../shared/format'
import { formatTime } from '../../shared/notes/evidence'
import { MdLite } from './MdLite'
import { EmptyState } from './EmptyState'
import { useModalScrollLock } from '../ui/use-modal-scroll-lock'
import { useFocusTrap } from '../ui/use-focus-trap'
import { isTopmostModalLayer } from '../ui/modal-layer'

export interface QaEntry {
  question: string
  answer: string
  /** 批C: when the exchange happened (pending bubbles have none yet). */
  createdAt?: string
  /** 批C: true while the answer is in flight — renders as a pending bubble. */
  pending?: boolean
  /** 批4: set on failure — the bubble stays in the transcript with a retry,
      instead of the exchange vanishing with a 6.5s toast. */
  error?: string
}

/** 批2 (plan 2026-09-22-wide-screen-blank-space)：坞内「目录」tab 的章节投影——
    只读结构（与 NoteViewer 的 note.chapters 同形），锚点跳转复用其
    data-chapter-at DOM 契约，不引入第二个数据源。 */
export interface QaChapter {
  at: number
  title: string
  summary: string
}

export interface QaDockProps {
  entries: QaEntry[]
  busy: boolean
  /** False when no lesson is selected — the input then reads as unavailable instead of silently no-op'ing. */
  hasLesson: boolean
  /** P37 (plan 2026-09-21): false 时输入不可用——追问只针对已有笔记的课时
      （主侧 qa:ask 同款硬门禁；此前无笔记也放行，回答退化成「基于转写」甚至
      「不依赖课时材料的一般性问题」，用户明示没必要）。 */
  hasNote?: boolean
  onAsk: (question: string) => void
  /** 批B: recent exchanges across lessons, shown as the empty state. */
  recent?: QaRecentInfo[]
  /** 批B: opening a recent exchange selects that lesson globally. */
  onOpenLesson?: (lessonId: string) => void
  /** 批2: 本篇笔记的章节——「目录」tab 与空态建议问题的数据源（只读）。 */
  chapters?: QaChapter[]
  /** P36: 收起成右缘悬浮入口钮（App 据 qaDockMode 切换渲染坞与入口钮）。 */
  onCollapse?: () => void
}

/**
 * 批C: «刚刚/N 分钟前/…» for fresh exchanges, a full stamp once a week old.
 * 批7 (T48): 实现搬到 shared/format.ts（时间戳全应用一份），这里只留名字给既有
 * 调用点与测试。
 */
export function qaTimeLabel(iso: string, now = new Date()): string {
  return formatRelativeStamp(iso, now)
}

/** P50-2 与 sticky 目录同渠道：章节锚点 scrollIntoView（存在性守卫，happy-dom 下 no-op）。 */
function jumpToChapter(at: number): void {
  const target = document.querySelector(`[data-chapter-at="${at}"]`)
  if (target != null && typeof (target as HTMLElement).scrollIntoView === 'function') target.scrollIntoView({ block: 'start' })
}

/**
 * P36 (plan 2026-09-21): 追问右坞——从 QaPanel（顶部 tab 的整页形态）搬迁而来，
 * 断言随迁（见 tests/components/qa-dock.test.tsx）。与 QaPanel 的差异：
 * ① 紧凑头（标题 + 收起键，不再用 PageHeader 的整页题头）；P44（2026-09-22）删掉
 *    头部 LessonChip 课时切换器——用户明示「本身就在笔记内部针对当前笔记提问，
 *    不需要这个」：切课时在侧栏/题头 chip/顶栏面包屑三处都可做，坞里是冗余的，
 *    而且在窄卡片里它正是溢出源；
 * ② hasNote 从「软提示」改为硬门禁（输入 disabled + 说明请先生成笔记）；
 * ③ 根元素 .qa-panel → .qa-dock（单一 fixed 形态：2026-09-22 批2 起重写为
 *    右侧悬浮小卡片，右缘垂直居中、无断点，样式在 style.css）。
 * 批2 (plan 2026-09-22-wide-screen-blank-space)：R1+ 升格——
 * ① 头部从「追问 + 收起」改为**分段 tab（追问 / 目录）**——坞从「一个聊天框」
 *    升格为「笔记副驾驶面板」，目录吃掉笔记页右侧空白的一大块；tab 基态复用
 *    .seg-tabs 基元（选择器列表在 style.css 顶部基元块），不新增第三套 tab 样式；
 * ② 空对话态给**建议问题**（章节标题现成数据，点一下即问）；
 * ③ 长答案可**全宽查看**——挂 .fullscreen-overlay 基元 + scroll lock + focus trap +
 *    Esc 只关本层（与 CourseBrowser 同款挂法），窄卡里挤着的长回答有了出口。
 */
export function QaDock({ entries, busy, hasLesson, hasNote = true, onAsk, recent = [], onOpenLesson, chapters = [], onCollapse }: QaDockProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [dockTab, setDockTab] = useState<'qa' | 'toc'>('qa')
  const [wideIndex, setWideIndex] = useState<number | null>(null)
  const wideRef = useRef<HTMLDivElement>(null)
  const askable = hasLesson && hasNote && !busy
  const submit = (): void => {
    const q = draft.trim()
    if (q === '' || !askable) return
    setDraft('')
    onAsk(q)
  }
  const suggestions = useMemo(
    () => chapters.slice(0, 3).map((c) => `「${c.title.length > 16 ? `${c.title.slice(0, 16)}…` : c.title}」讲了什么？`),
    [chapters]
  )
  // 全宽查看：与四个自绘弹层同款挂法（scroll lock + focus trap + Esc 只关最上层）。
  const wideOpen = wideIndex != null && entries[wideIndex] != null
  useModalScrollLock(wideOpen)
  useFocusTrap(wideOpen, wideRef)
  useEffect(() => {
    if (!wideOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isTopmostModalLayer(wideRef.current)) setWideIndex(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wideOpen])
  return (
    <section class="qa-dock" data-testid="qa-dock" aria-label="追问">
      <header class="qa-dock-head">
        {/* 批2: tab 段取代「追问」二字标题——「追问 | 目录」本身就是标题；无章节时
            目录 tab 禁用并说清原因。 */}
        <div class="qa-dock-tabs" role="tablist" aria-label="坞内视图">
          <button role="tab" class={dockTab === 'qa' ? 'active' : ''} aria-selected={dockTab === 'qa'} onClick={() => setDockTab('qa')}>
            追问
          </button>
          <button
            role="tab"
            class={dockTab === 'toc' ? 'active' : ''}
            aria-selected={dockTab === 'toc'}
            disabled={chapters.length === 0}
            title={chapters.length === 0 ? '这篇笔记没有章节' : '跳到本篇某一章'}
            onClick={() => setDockTab('toc')}
          >
            目录
          </button>
        </div>
        {hasLesson ? null : <span class="qa-dock-no-lesson">未选择课时</span>}
        {onCollapse != null && (
          <button class="btn small ghost qa-dock-collapse" onClick={onCollapse} title="收起追问（需要时点右缘「追问」钮再打开）">
            收起
          </button>
        )}
      </header>
      {dockTab === 'toc' ? (
        <nav class="qa-toc" aria-label="本页目录" data-testid="qa-toc">
          {chapters.map((c) => (
            <button key={c.at} class="qa-toc-item" data-testid="qa-toc-item" title={c.summary} onClick={() => jumpToChapter(c.at)}>
              <span class="qa-toc-time">{formatTime(c.at)}</span>
              <span class="qa-toc-title">{c.title}</span>
            </button>
          ))}
        </nav>
      ) : (
        <>
      <div class="qa-log">
        {entries.length === 0 && hasLesson && (
          <p class="msg">{hasNote ? '针对当前课时的笔记提问。' : '此课时尚无笔记——请先为此课时生成笔记，再回来提问。'}</p>
        )}
        {/* 批2: 空对话 + 有笔记 = 建议问题入场（章节标题现成数据；没有章节的笔记不渲染）。 */}
        {entries.length === 0 && hasLesson && hasNote && suggestions.length > 0 && (
          <div class="qa-suggest" data-testid="qa-suggest">
            <p class="msg">从一章问起：</p>
            {suggestions.map((q) => (
              <button key={q} class="chip" disabled={busy} onClick={() => onAsk(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        {/* A3 (plan 2026-09-13): the hero card only for the truly-empty case —
            with recent Q&A below it, «从一条追问开始» contradicted the rows
            under it; a one-line lead-in replaces the card there. */}
        {entries.length === 0 && !hasLesson && recent.length === 0 && (
          <EmptyState title="从一条追问开始" hint="选择课时后即可针对该课时的笔记提问；已有的追问会列在下方。" />
        )}
        {entries.length === 0 && !hasLesson && recent.length > 0 && onOpenLesson != null && (
          <>
            <p class="msg">选择课时后即可针对该课时的笔记提问；点下面一条可回到那次追问。</p>
            <div class="qa-recent" data-testid="qa-recent">
            {recent.map((r, i) => {
              const where = [r.courseName, r.lessonTitle].filter((s): s is string => s != null && s !== '').join(' · ')
              return (
                <button
                  key={`${r.lessonId}-${i}`}
                  class="item qa-recent-row"
                  data-testid="qa-recent-row"
                  title={`${where}${where !== '' ? ' — ' : ''}${r.question}`}
                  onClick={() => onOpenLesson(r.lessonId)}
                >
                  <span class="qa-recent-where">{where !== '' ? where : r.lessonId}</span>
                  <span class="qa-recent-q">{r.question}</span>
                  {/* 批6: 相对时间与对话流统一（超一周由 qaTimeLabel 回退绝对时间）。 */}
                  <span class="qa-recent-time">{qaTimeLabel(r.createdAt)}</span>
                </button>
              )
            })}
            </div>
          </>
        )}
        {entries.map((e, i) => (
          <div key={i} class="qa-pair">
            <p class="qa-q">{e.question}</p>
            {e.pending ? (
              <div class="qa-a pending" data-testid="qa-pending">
                思考中…
              </div>
            ) : e.error != null ? (
              // 批4: 失败永久可见于对话流（此前只走一次 6.5s toast，问题像蒸发）。
              <div class="qa-a qa-error" data-testid="qa-error">
                <span class="ai-tag" aria-hidden="true">
                  AI
                </span>
                <p class="qa-error-msg">回答失败：{e.error}</p>
                <button class="btn small" disabled={busy} title={busy ? '上一条还在回答中' : '用同一个问题再问一次'} onClick={() => onAsk(e.question)}>
                  重试
                </button>
              </div>
            ) : (
              <div class="qa-a">
                <span class="ai-tag" aria-hidden="true">
                  AI
                </span>
                {/* A6: model answers render as markdown-lite; single newlines are
                    promoted to paragraph breaks (answers are not md documents). */}
                <MdLite text={e.answer.replace(/\r?\n/g, '\n\n')} />
                {e.createdAt != null && <span class="qa-time">{qaTimeLabel(e.createdAt)}</span>}
                {/* 批2: 长答案出口——窄卡里挤着的回答进全宽查看层。 */}
                <button
                  class="qa-wide-open"
                  aria-label="全宽查看这条回答"
                  title="全宽查看"
                  data-testid="qa-wide-open"
                  onClick={() => setWideIndex(i)}
                >
                  <Maximize2 size={12} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        ))}
        {/* Fallback pending hint: only when busy without an optimistic bubble
            (e.g. a retry path) so «思考中» never renders twice. */}
        {busy && !entries.some((e) => e.pending === true) && <p class="qa-a pending">思考中…</p>}
      </div>
      {/* 批4: busy 时 Enter 不再静默无回应——输入框上方说明原因。 */}
      {busy && (
        <p class="qa-busy-hint" data-testid="qa-busy-hint">
          上一条还在回答中，请稍候再提问
        </p>
      )}
      <div class="qa-input-row">
        <textarea
          class="qa-input"
          rows={2}
          value={draft}
          /* P49-3: placeholder 只留一行「针对当前课时提问…」——旧值把 Enter/Shift+Enter
             说明也塞在里面，窄卡里折成 3 行、把输入区撑得又高又挤（Andiii 截图）。快捷键
             说明移到 title（悬停可见），空态提示行「针对当前课时的笔记提问。」保留。 */
          title="Enter 提问，Shift+Enter 换行"
          placeholder={
            hasLesson
              ? hasNote
                ? '针对当前课时提问…'
                : '此课时尚无笔记——请先为此课时生成笔记'
              : '先选择一条笔记或课时'
          }
          disabled={!askable}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            // A5: an IME composition Enter (pinyin confirm) must not submit.
            // Preact forwards the native KeyboardEvent — isComposing lives on it.
            if (e.key === 'Enter' && !e.shiftKey && (e as unknown as KeyboardEvent).isComposing !== true) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button class="btn primary" onClick={submit} disabled={!askable || draft.trim() === ''}>
          提问
        </button>
      </div>
        </>
      )}
      {/* 批2: 全宽查看层——挂 .fullscreen-overlay 基元（成员不再自写 position/inset/
          z-index/遮罩/padding），卡片自身只管尺寸与内容；右上关闭键 + aria-label
          （SKILL §5 视图类弹层形制）。 */}
      {wideOpen && wideIndex != null && (
        <div class="fullscreen-overlay qa-wide" role="dialog" aria-modal="true" aria-label="回答全宽查看" ref={wideRef}>
          <div class="qa-wide-card" data-testid="qa-wide">
            <header class="qa-wide-head">
              <h3>{entries[wideIndex].question}</h3>
              <button class="btn small ghost" aria-label="关闭全宽查看" title="关闭（Esc）" onClick={() => setWideIndex(null)}>
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </header>
            <div class="qa-wide-body">
              <MdLite text={entries[wideIndex].answer.replace(/\r?\n/g, '\n\n')} />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
