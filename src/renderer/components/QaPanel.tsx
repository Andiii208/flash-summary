import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { QaRecentInfo } from '../../shared/bridge'
import { MdLite } from './MdLite'

export interface QaEntry {
  question: string
  answer: string
}

export interface QaPanelProps {
  entries: QaEntry[]
  busy: boolean
  /** False when no lesson is selected — the input then reads as unavailable instead of silently no-op'ing. */
  hasLesson: boolean
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

/** Follow-up Q&A chat flow (no streaming in MVP — busy state only). */
export function QaPanel({ entries, busy, hasLesson, onAsk, recent = [], onOpenLesson }: QaPanelProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const askable = hasLesson && !busy
  const submit = (): void => {
    const q = draft.trim()
    if (q === '' || !askable) return
    setDraft('')
    onAsk(q)
  }
  return (
    <section class="qa-panel">
      <h2>本课时追问</h2>
      <div class="qa-log">
        {entries.length === 0 && hasLesson && <p class="msg">针对当前课时的笔记提问。</p>}
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
            <div class="qa-a">
              <span class="ai-tag" aria-hidden="true">
                AI
              </span>
              {/* A6: model answers render as markdown-lite; single newlines are
                  promoted to paragraph breaks (answers are not md documents). */}
              <MdLite text={e.answer.replace(/\r?\n/g, '\n\n')} />
            </div>
          </div>
        ))}
        {busy && <p class="qa-a pending">思考中…</p>}
      </div>
      <div class="qa-input-row">
        <textarea
          class="qa-input"
          rows={2}
          value={draft}
          placeholder={hasLesson ? '针对当前课时提问…（Enter 提问，Shift+Enter 换行）' : '先选择一条笔记或课时'}
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
