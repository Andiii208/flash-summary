import './style.css'
import type { Note } from '../shared/notes/schema'
import type { SeuSummaryBridge } from '../shared/bridge'
import { createNoteViewer } from './note-viewer'

const api = (window as unknown as { seuSummary?: SeuSummaryBridge }).seuSummary

interface CourseRow { id: string; name: string; term?: string; teacher?: string }
type Res<T> = { ok: true; value: T } | { ok: false; error: string; kind?: string }

function assertBridge(): SeuSummaryBridge {
  if (api == null) throw new Error('应用桥接不可用（preload 未加载）')
  return api
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

function show(el_: HTMLElement, msg: string, isError = false): void {
  el_.textContent = msg
  el_.classList.toggle('error', isError)
}

export function boot(): void {
  const root = document.getElementById('app')
  if (!root) return
  root.textContent = ''

  let bridge: SeuSummaryBridge
  try {
    bridge = assertBridge()
  } catch (e) {
    root.appendChild(el('p', 'error', (e as Error).message))
    return
  }

  // ---- layout ----
  const header = el('header', 'topbar')
  const title = el('h1', undefined, 'SEU Summary')
  const sessionBtn = el('button', 'btn', '登录 CAS')
  header.append(title, sessionBtn)

  const main = el('main', 'layout')
  const left = el('section', 'pane')
  const center = el('section', 'pane')
  const right = el('section', 'pane')
  main.append(left, center, right)
  root.append(header, main)

  // ---- left: courses ----
  left.appendChild(el('h2', undefined, '课程'))
  const refreshBtn = el('button', 'btn small', '刷新课程')
  const courseList = el('div', 'list')
  const courseMsg = el('p', 'msg')
  left.append(refreshBtn, courseMsg, courseList)

  let currentLesson = ''
  let currentTask = ''

  // ---- center: tasks ----
  center.appendChild(el('h2', undefined, '任务'))
  const createTaskBtn = el('button', 'btn small', '为此课时创建任务')
  const runBtn = el('button', 'btn small', '运行任务')
  const retryBtn = el('button', 'btn small', '重试任务')
  const taskMsg = el('p', 'msg')
  const taskState = el('p', 'task-state', '无任务')
  center.append(createTaskBtn, runBtn, retryBtn, taskMsg, taskState)

  // ---- right: note viewer + qa ----
  right.appendChild(el('h2', undefined, '笔记'))
  const noteRoot = el('div', 'note-root')
  right.appendChild(noteRoot)
  const viewer = createNoteViewer(noteRoot, null)

  right.appendChild(el('h2', undefined, '本课时追问'))
  const qaLog = el('div', 'qa-log')
  const qaInput = el('input', 'qa-input') as HTMLInputElement
  qaInput.placeholder = '针对当前课时提问…'
  const qaBtn = el('button', 'btn small', '提问')
  right.append(qaLog, qaInput, qaBtn)

  // ---- behaviors ----
  sessionBtn.addEventListener('click', () => {
    void (async () => {
      try {
        const res = (await bridge.school.login()) as Res<{ state: string }>
        show(sessionBtn, res.ok ? '已登录' : `登录失败: ${res.error}`, !res.ok)
      } catch (e) {
        show(sessionBtn, (e as Error).message, true)
      }
    })()
  })

  function refreshCourses(): void {
    void (async () => {
      const res = (await bridge.school.listCourses()) as Res<CourseRow[]>
      if (!res.ok) {
        show(courseMsg, res.error, true)
        return
      }
      courseMsg.textContent = ''
      courseList.textContent = ''
      for (const course of res.value) {
        const item = el('div', 'item', `${course.name}（${course.term ?? course.teacher ?? course.id}）`)
        courseList.appendChild(item)
      }
      if (res.value.length === 0) show(courseMsg, '暂无课程，请先登录 CAS')
    })().catch((e) => show(courseMsg, (e as Error).message, true))
  }
  refreshBtn.addEventListener('click', refreshCourses)

  createTaskBtn.addEventListener('click', () => {
    void (async () => {
      if (currentLesson === '') {
        show(taskMsg, '请先从左侧选择课时', true)
        return
      }
      const res = (await bridge.tasks.create(currentLesson)) as Res<{ id: string }>
      if (!res.ok) {
        show(taskMsg, res.error, true)
        return
      }
      currentTask = res.value.id
      show(taskState, `任务 ${currentTask}：pending`)
    })().catch((e) => show(taskMsg, (e as Error).message, true))
  })

  runBtn.addEventListener('click', () => {
    void (async () => {
      if (currentTask === '') {
        show(taskMsg, '还没有任务', true)
        return
      }
      show(taskState, '任务运行中…')
      const res = (await bridge.tasks.run(currentTask)) as Res<{ result: string; task?: { state: string; error_message: string | null } }>
      if (!res.ok) {
        show(taskState, `运行失败: ${res.error}`)
        return
      }
      show(taskState, `任务 ${currentTask}：${res.value.task?.state ?? res.value.result}${res.value.task?.error_message ? ` — ${res.value.task.error_message}` : ''}`)
    })().catch((e) => show(taskState, (e as Error).message))
  })

  retryBtn.addEventListener('click', () => {
    void (async () => {
      if (currentTask === '') {
        show(taskMsg, '还没有任务', true)
        return
      }
      const res = (await bridge.tasks.retry(currentTask)) as Res<{ result: string; task?: { state: string; error_message: string | null } }>
      if (!res.ok) {
        show(taskState, `重试失败: ${res.error}`)
        return
      }
      show(taskState, `任务 ${currentTask}：${res.value.task?.state ?? res.value.result}${res.value.task?.error_message ? ` — ${res.value.task.error_message}` : ''}`)
    })().catch((e) => show(taskState, (e as Error).message))
  })

  qaBtn.addEventListener('click', () => {
    void (async () => {
      const question = qaInput.value.trim()
      if (question === '' || currentLesson === '') return
      qaInput.value = ''
      qaLog.appendChild(el('p', 'qa-q', `问：${question}`))
      const res = (await bridge.qa.ask(currentLesson, question)) as Res<{ answer: string }>
      qaLog.appendChild(el('p', res.ok ? 'qa-a' : 'qa-a error', res.ok ? `答：${res.value.answer}` : `失败：${res.error}`))
    })().catch((e) => qaLog.appendChild(el('p', 'qa-a error', (e as Error).message)))
  })

  // Boot: reflect session state.
  void (async () => {
    const res = (await bridge.school.session()) as Res<{ state: string }>
    if (res.ok && res.value.state === 'logged_in') show(sessionBtn, '已登录')
  })().catch(() => undefined)

  // Expose lesson selection for tests/manual wiring (no-op by default).
  ;(window as unknown as { __selectLesson?: (id: string) => void }).__selectLesson = (id: string) => {
    currentLesson = id
    show(taskState, `已选课时 ${id}`)
    void (async () => {
      const res = (await bridge.notes.latest(id)) as Res<Note | null>
      if (res.ok && res.value != null) viewer.setNote(res.value)
    })().catch(() => undefined)
  }
}

boot()
