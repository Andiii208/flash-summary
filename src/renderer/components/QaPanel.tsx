import { useState } from 'preact/hooks'
import type { JSX } from 'preact'

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
}

/** Lesson Q&A chat flow (no streaming in MVP — busy state only). */
export function QaPanel({ entries, busy, hasLesson, onAsk }: QaPanelProps): JSX.Element {
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
        {entries.length === 0 && <p class="msg">{hasLesson ? '针对当前课时的笔记提问。' : '选择课时后即可针对笔记提问。'}</p>}
        {entries.map((e, i) => (
          <div key={i} class="qa-pair">
            <p class="qa-q">问：{e.question}</p>
            <p class="qa-a">答：{e.answer}</p>
          </div>
        ))}
        {busy && <p class="qa-a pending">思考中…</p>}
      </div>
      <div class="qa-input-row">
        <input
          class="qa-input"
          value={draft}
          placeholder={hasLesson ? '针对当前课时提问…' : '先在左侧选择一个课时'}
          disabled={!hasLesson}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button class="btn primary" onClick={submit} disabled={!askable || draft.trim() === ''}>
          提问
        </button>
      </div>
    </section>
  )
}
