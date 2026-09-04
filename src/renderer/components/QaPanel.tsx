import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { QaRecentInfo } from '../../shared/bridge'
import { MdLite } from './MdLite'
import { PageHeader } from './PageHeader'
import { LessonChip, type LessonChipLesson } from './LessonChip'

export interface QaEntry {
  question: string
  answer: string
  /** 批C: when the exchange happened (pending bubbles have none yet). */
  createdAt?: string
  /** 批C: true while the answer is in flight — renders as a pending bubble. */
  pending?: boolean
}

export interface QaPanelProps {
  entries: QaEntry[]
  busy: boolean
  /** False when no lesson is selected — the input then reads as unavailable instead of silently no-op'ing. */
  hasLesson: boolean
  /** 批A: identity of the selection for the header chip. */
  lessonContext?: { courseName: string; lessonTitle: string; lessonId?: string } | null
  /** 批A: sibling lessons for the chip's quick-switch dropdown. */
  lessonOptions?: LessonChipLesson[]
  /** 批A: chip dropdown selection — switches lesson, keeps the qa tab. */
  onSelectLesson?: (lessonId: string) => void
  /** 批C: false once the lesson is known to have no note — the input then
   *  says answers won't be note-based (asking still allowed, not gated). */
  hasNote?: boolean
  onAsk: (question: string) => void
  /** 批B: recent exchanges across lessons, shown as the empty state. */
  recent?: QaRecentInfo[]
  /** 批B: opening a recent exchange selects that lesson globally. */
  onOpenLesson?: (lessonId: string) => void
}

/** Short «YYYY-MM-DD HH:mm» stamp for the recent-QA rows. */
function recentStamp(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}

/** 批C: «刚刚/N 分钟前/…» for fresh exchanges, a full stamp once a week old. */
export function qaTimeLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = now.getTime() - d.getTime()
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`
  if (diffMs < 7 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)} 天前`
  return recentStamp(iso)
}

/** Follow-up Q&A chat flow (no streaming in MVP — optimistic pending bubble). */
export function QaPanel({ entries, busy, hasLesson, lessonContext = null, lessonOptions, onSelectLesson, hasNote = true, onAsk, recent = [], onOpenLesson }: QaPanelProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const askable = hasLesson && !busy
  const submit = (): void => {
    const q = draft.trim()
    if (q === '' || !askable) return
    setDraft('')
    onAsk(q)
  }
  const chip =
    lessonContext != null ? (
      <LessonChip
        courseName={lessonContext.courseName}
        lessonTitle={lessonContext.lessonTitle}
        lessons={lessonOptions}
        currentLessonId={lessonContext.lessonId}
        onSelectLesson={onSelectLesson}
      />
    ) : undefined
  return (
    <section class="qa-panel">
      <PageHeader title="追问" chip={chip} />
      <div class="qa-log">
        {entries.length === 0 && hasLesson && (
          <p class="msg">{hasNote ? '针对当前课时的笔记提问。' : '此课时尚无笔记——先生成笔记会让追问更有的放矢；也可以直接提问。'}</p>
        )}
        {entries.length === 0 && !hasLesson && recent.length > 0 && onOpenLesson != null && (
          <div class="qa-recent" data-testid="qa-recent">
            <p class="msg">选择课时后即可针对笔记提问 — 最近追问：</p>
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
                  <span class="qa-recent-time">{recentStamp(r.createdAt)}</span>
                </button>
              )
            })}
          </div>
        )}
        {entries.length === 0 && !hasLesson && (recent.length === 0 || onOpenLesson == null) && (
          <p class="msg">选择课时后即可针对笔记提问。</p>
        )}
        {entries.map((e, i) => (
          <div key={i} class="qa-pair">
            <p class="qa-q">{e.question}</p>
            {e.pending ? (
              <div class="qa-a pending" data-testid="qa-pending">
                思考中…
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
      <div class="qa-input-row">
        <textarea
          class="qa-input"
          rows={2}
          value={draft}
          placeholder={
            hasLesson
              ? hasNote
                ? '针对当前课时提问…（Enter 提问，Shift+Enter 换行）'
                : '此课时尚无笔记——仍可提问，但回答不基于笔记（Enter 发送）'
              : '先选择一条笔记或课时'
          }
          disabled={!hasLesson}
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
