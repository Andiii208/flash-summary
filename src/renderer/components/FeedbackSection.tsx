/**
 * 批5 (plan 2026-09-07 v07): note feedback — the user picks what's wrong
 * (tag chips) and optionally adds free text; submitting sends the latest
 * note back to the model for a second-pass polish (a new version).
 */
import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { FEEDBACK_TAGS } from '../../shared/feedback-tags'

export interface FeedbackSectionProps {
  busy: boolean
  onSubmit: (feedback: { tags: string[]; text: string }) => void
}

export function FeedbackSection({ busy, onSubmit }: FeedbackSectionProps): JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [text, setText] = useState('')
  const nothingPicked = selected.size === 0 && text.trim() === ''
  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const submit = (): void => {
    if (busy || nothingPicked) return
    onSubmit({ tags: [...selected], text: text.trim() })
  }
  return (
    <section class="note-section feedback-section" data-testid="feedback-section" aria-label="笔记反馈">
      <h3>笔记不满意？告诉模型哪里不足</h3>
      <p class="feedback-hint">勾选问题（可多选）后提交，模型会基于本讲内容对笔记做二次润色，生成新版本。</p>
      <div class="feedback-tags" role="group" aria-label="选择笔记的不足之处">
        {FEEDBACK_TAGS.map((tag) => (
          <button
            key={tag.id}
            class={`feedback-tag${selected.has(tag.id) ? ' active' : ''}`}
            aria-pressed={selected.has(tag.id)}
            disabled={busy}
            onClick={() => {
              toggle(tag.id)
            }}
          >
            {tag.label}
          </button>
        ))}
      </div>
      <textarea
        class="feedback-text"
        placeholder="补充说明（可选）：比如「第 3 节的推导没看懂，再展开讲讲」"
        value={text}
        rows={2}
        disabled={busy}
        onInput={(e) => {
          setText((e.target as HTMLTextAreaElement).value)
        }}
      />
      <div class="feedback-actions">
        <button class="btn small primary" disabled={busy || nothingPicked} onClick={submit}>
          {busy ? '润色中…（约需 1-2 分钟）' : '提交反馈，润色笔记'}
        </button>
      </div>
    </section>
  )
}
