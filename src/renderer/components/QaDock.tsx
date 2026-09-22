import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { QaRecentInfo } from '../../shared/bridge'
import { formatRelativeStamp } from '../../shared/format'
import { MdLite } from './MdLite'
import { EmptyState } from './EmptyState'

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
  /** P36: 收起成右缘悬浮入口钮（App 据 qaDockOpen 切换渲染坞与入口钮）。 */
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
 */
export function QaDock({ entries, busy, hasLesson, hasNote = true, onAsk, recent = [], onOpenLesson, onCollapse }: QaDockProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const askable = hasLesson && hasNote && !busy
  const submit = (): void => {
    const q = draft.trim()
    if (q === '' || !askable) return
    setDraft('')
    onAsk(q)
  }
  return (
    <section class="qa-dock" data-testid="qa-dock" aria-label="追问">
      <header class="qa-dock-head">
        <span class="qa-dock-title">追问</span>
        {hasLesson ? null : <span class="qa-dock-no-lesson">未选择课时</span>}
        {onCollapse != null && (
          <button class="btn small ghost qa-dock-collapse" onClick={onCollapse} title="收起追问（需要时点右缘「追问」钮再打开）">
            收起
          </button>
        )}
      </header>
      <div class="qa-log">
        {entries.length === 0 && hasLesson && (
          <p class="msg">{hasNote ? '针对当前课时的笔记提问。' : '此课时尚无笔记——请先为此课时生成笔记，再回来提问。'}</p>
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
    </section>
  )
}
