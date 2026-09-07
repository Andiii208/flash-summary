import { useState } from 'preact/hooks'
import type { JSX } from 'preact'

export interface ManualAddProps {
  /** Resolves to true on success — only then are the inputs cleared (批5:
   *  a failed add must keep the ids; they are the expensive-to-retype part). */
  onAdd: (courseId: string, lessonId: string) => Promise<boolean>
}

/** Spec §2 fallback: register a course/lesson by id when the API list is empty. */
export function ManualAdd({ onAdd }: ManualAddProps): JSX.Element {
  const [courseId, setCourseId] = useState('')
  const [lessonId, setLessonId] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = (): void => {
    if (busy || courseId.trim() === '' || lessonId.trim() === '') return
    void (async () => {
      setBusy(true)
      try {
        if (await onAdd(courseId.trim(), lessonId.trim())) {
          setCourseId('')
          setLessonId('')
        }
      } finally {
        setBusy(false)
      }
    })()
  }
  const onEnter = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && (e as unknown as { isComposing?: boolean }).isComposing !== true) {
      e.preventDefault()
      submit()
    }
  }
  return (
    <details class="manual-fallback">
      <summary>高级：手动添加课程 ID</summary>
      <input class="qa-input" value={courseId} placeholder="课程 ID（如 1690625）" onInput={(e) => setCourseId((e.target as HTMLInputElement).value)} onKeyDown={onEnter} />
      <input class="qa-input" value={lessonId} placeholder="课时 ID（平台回放页地址里可查到）" title="在平台播放页的地址/链接信息里找到课时 ID，粘贴到这里" onInput={(e) => setLessonId((e.target as HTMLInputElement).value)} onKeyDown={onEnter} />
      <button class="btn small" disabled={busy} onClick={submit}>
        {busy ? '添加中…' : '添加课程与课时'}
      </button>
    </details>
  )
}
