import { useState } from 'preact/hooks'
import type { JSX } from 'preact'

export interface ManualAddProps {
  onAdd: (courseId: string, lessonId: string) => void
}

/** Spec §2 fallback: register a course/lesson by id when the API list is empty. */
export function ManualAdd({ onAdd }: ManualAddProps): JSX.Element {
  const [courseId, setCourseId] = useState('')
  const [lessonId, setLessonId] = useState('')
  const submit = (): void => {
    if (courseId.trim() === '' || lessonId.trim() === '') return
    onAdd(courseId.trim(), lessonId.trim())
    setCourseId('')
    setLessonId('')
  }
  return (
    <details class="manual-fallback">
      <summary>高级：手动添加课程 ID</summary>
      <input class="qa-input" value={courseId} placeholder="课程 ID" onInput={(e) => setCourseId((e.target as HTMLInputElement).value)} />
      <input class="qa-input" value={lessonId} placeholder="课时 ID（回放页可查）" onInput={(e) => setLessonId((e.target as HTMLInputElement).value)} />
      <button class="btn small" onClick={submit}>
        添加课程
      </button>
    </details>
  )
}
