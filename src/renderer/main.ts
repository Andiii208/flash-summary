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

  // Manual fallback (spec §2): register a course/lesson by id.
  left.appendChild(el('h3', 'subheading', '手动添加（后备）'))
  const manualCourse = el('input', 'qa-input') as HTMLInputElement
  manualCourse.placeholder = '课程 ID'
  const manualLesson = el('input', 'qa-input') as HTMLInputElement
  manualLesson.placeholder = '课时 ID（回放页可查）'
  const manualBtn = el('button', 'btn small', '添加课程')
  left.append(manualCourse, manualLesson, manualBtn)

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

  // ---- center bottom: provider settings ----
  center.appendChild(el('h2', undefined, 'Provider 设置'))
  const provName = el('input', 'qa-input') as HTMLInputElement
  provName.placeholder = '名称（如 OpenAI）'
  const provUrl = el('input', 'qa-input') as HTMLInputElement
  provUrl.placeholder = 'Base URL（https://api.openai.com/v1）'
  const provKey = el('input', 'qa-input') as HTMLInputElement
  provKey.placeholder = 'API Key（仅存内存，DPAPI 加密落库）'
  provKey.type = 'password'
  const provModel = el('select', 'qa-input') as HTMLSelectElement
  for (const cap of ['asr', 'multimodal', 'text']) {
    const opt = document.createElement('option')
    opt.value = cap
    opt.textContent = cap === 'asr' ? 'ASR 转写' : cap === 'multimodal' ? '多模态总结' : '文本问答'
    provModel.appendChild(opt)
  }
  const provModelName = el('input', 'qa-input') as HTMLInputElement
  provModelName.placeholder = '模型名（如 whisper-1 / gpt-4o）'
  const provSaveBtn = el('button', 'btn small', '保存并绑定')
  const provMsg = el('p', 'msg')
  const provList = el('div', 'list')
  center.append(provName, provUrl, provKey, provModel, provModelName, provSaveBtn, provMsg, provList)

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

  // Manual fallback: register course/lesson rows by id, then allow tasks.
  manualBtn.addEventListener('click', () => {
    void (async () => {
      const cid = manualCourse.value.trim()
      const lid = manualLesson.value.trim()
      if (cid === '' || lid === '') {
        show(courseMsg, '请填写课程 ID 和课时 ID', true)
        return
      }
      const res = (await bridge.school.addManualCourse(cid, lid)) as Res<{ courseId: string; lessonId: string }>
      if (!res.ok) {
        show(courseMsg, res.error, true)
        return
      }
      manualCourse.value = ''
      manualLesson.value = ''
      currentLesson = lid
      show(courseMsg, `已添加课程 ${cid}，课时 ${lid} 已选中`)
      show(taskState, `已选课时 ${lid}`)
    })().catch((e) => show(courseMsg, (e as Error).message, true))
  })

  // Provider settings: save provider then bind capability, in one action.
  provSaveBtn.addEventListener('click', () => {
    void (async () => {
      const name = provName.value.trim()
      const baseUrl = provUrl.value.trim()
      const apiKey = provKey.value
      const capability = provModel.value
      const model = provModelName.value.trim()
      if (name === '' || baseUrl === '' || model === '') {
        show(provMsg, '名称、Base URL、模型名必填', true)
        return
      }
      const saved = (await bridge.providers.save({ name, baseUrl, apiKey })) as Res<{ id: string }>
      if (!saved.ok) {
        show(provMsg, saved.error, true)
        return
      }
      const bound = (await bridge.providers.bind(capability, saved.value.id, model)) as Res<boolean>
      if (!bound.ok) {
        show(provMsg, bound.error, true)
        return
      }
      show(provMsg, `已保存并绑定 ${capability} → ${name}/${model}`)
      provKey.value = ''
      await refreshProviders()
    })().catch((e) => show(provMsg, (e as Error).message, true))
  })

  function refreshProviders(): Promise<void> {
    return (async () => {
      const res = (await bridge.providers.list()) as Res<{ providers: Array<{ id: string; name: string; hasKey: boolean }>; bindings: Array<{ capability: string; providerId: string; model: string }> }>
      if (!res.ok) {
        show(provMsg, res.error, true)
        return
      }
      provList.textContent = ''
      for (const p of res.value.providers) {
        const binding = res.value.bindings.find((b) => b.providerId === p.id)
        const boundCaps = res.value.bindings.filter((b) => b.providerId === p.id).map((b) => b.capability).join(', ')
        provList.appendChild(
          el('div', 'item', `${p.name} — ${boundCaps || '未绑定'}${binding ? `（${binding.model}）` : ''}${p.hasKey ? ' ✓' : ' 无Key'}`)
        )
      }
      if (res.value.providers.length === 0) provList.appendChild(el('div', 'item', '尚无 Provider，先在上方添加'))
    })()
  }
  void refreshProviders()

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
