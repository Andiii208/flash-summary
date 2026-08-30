/**
 * Note reading UI: renders the four views from one structured note JSON.
 * Vanilla DOM (no framework) — the MVP keeps the renderer simple.
 */
import type { Note } from '../shared/notes/schema'
import { projectNote, VIEW_IDS, type ViewId } from '../shared/notes/views'

export interface NoteViewerHandle {
  setNote: (note: Note) => void
  setView: (view: ViewId) => void
  root: HTMLElement
}

export function createNoteViewer(root: HTMLElement, initialNote: Note | null): NoteViewerHandle {
  let note = initialNote
  let view: ViewId = 'detailed'

  const tabs = document.createElement('nav')
  tabs.className = 'note-tabs'
  for (const id of VIEW_IDS) {
    const btn = document.createElement('button')
    btn.dataset.view = id
    btn.textContent = labelOf(id)
    btn.addEventListener('click', () => setView(id))
    tabs.appendChild(btn)
  }

  const body = document.createElement('div')
  body.className = 'note-body'
  root.appendChild(tabs)
  root.appendChild(body)

  function render(): void {
    for (const btn of Array.from(tabs.children) as HTMLButtonElement[]) {
      btn.classList.toggle('active', btn.dataset.view === view)
    }
    body.textContent = ''
    if (note == null) {
      body.textContent = '尚无笔记'
      return
    }
    for (const section of projectNote(note, view)) {
      const h = document.createElement('h2')
      h.textContent = section.heading
      body.appendChild(h)
      const pre = document.createElement('pre')
      pre.textContent = section.lines.join('\n')
      body.appendChild(pre)
    }
  }

  function setView(v: ViewId): void {
    view = v
    render()
  }

  return { setNote: (n: Note) => { note = n; render() }, setView, root }
}

function labelOf(view: ViewId): string {
  switch (view) {
    case 'detailed':
      return '详细笔记'
    case 'standard':
      return '标准总结'
    case 'key_points':
      return '要点'
    case 'methodology':
      return '方法论'
    default: {
      const exhaustive: never = view
      return exhaustive
    }
  }
}
