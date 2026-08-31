import './style.css'
import type { Note } from '../shared/notes/schema'
import type { CourseTreeInfo, SeuSummaryBridge, TaskProgressInfo, TaskRowInfo } from '../shared/bridge'
import { withSessionRetry } from '../shared/session-retry'
import { createToastArea, type ShowToast } from './toast'
import { renderCourseTree } from './course-tree'
import { createNoteViewer } from './note-viewer'

const api = (window as unknown as { seuSummary?: SeuSummaryBridge }).seuSummary

type Res<T> = { ok: true; value: T } | { ok: false; error: string; kind?: string }

const STAGE_LABELS: Record<string, string> = {
  pending: '排队中',
  fetching_course: '拉取课程信息',
  downloading_video: '下载视频',
  extracting_audio: '提取音频',
  transcribing: '转写音频',
  extracting_visuals: '提取 PPT/关键帧',
  summarizing: '生成笔记',
  succeeded: '已完成',
  failed: '失败'
}

function assertBridge(): SeuSummaryBridge {
  if (api == null) throw new Error('应用桥接不可用（preload 未加载）')
  return api
}

function el<T extends HTMLElement = HTMLElement>(tag: string, className?: string, text?: string): T {
  const e = document.createElement(tag) as T
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

function stageLabel(state: string, stage: string | null): string {
  if (state === 'succeeded') return '已完成'
  if (state === 'failed') return `失败（${STAGE_LABELS[stage ?? ''] ?? stage ?? '未知阶段'}）`
  return STAGE_LABELS[state] ?? STAGE_LABELS[stage ?? ''] ?? state
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
  const toast = createToastArea(root)
  void bootApp(bridge, root, toast)
}

function bootApp(bridge: SeuSummaryBridge, root: HTMLElement, toast: ShowToast): void {
  // ---- layout ----
  const header = el('header', 'topbar')
  const title = el('h1', undefined, 'SEU Summary')
  const sessionBtn = el<HTMLButtonElement>('button', 'btn', '登录 CAS')
  header.append(title, sessionBtn)

  const main = el('main', 'layout')
  const left = el('section', 'pane')
  const center = el('section', 'pane')
  const right = el('section', 'pane')
  main.append(left, center, right)
  root.append(header, main)

  // ---- left: course tree + manual fallback ----
  left.appendChild(el('h2', undefined, '课程'))
  const courseList = el('div', 'list')
  const courseMsg = el('p', 'msg')
  left.append(courseList, courseMsg)
  left.appendChild(el('h3', 'subheading', '手动添加（后备）'))
  const manualCourse = el('input', 'qa-input') as HTMLInputElement
  manualCourse.placeholder = '课程 ID'
  const manualLesson = el('input', 'qa-input') as HTMLInputElement
  manualLesson.placeholder = '课时 ID（回放页可查）'
  const manualBtn = el<HTMLButtonElement>('button', 'btn small', '添加课程')
  left.append(manualCourse, manualLesson, manualBtn)

  // ---- center: task panel ----
  const taskSection = el('section')
  taskSection.appendChild(el('h2', undefined, '任务'))
  const lessonLabel = el('p', 'msg', '尚未选择课时')
  const createRunBtn = el<HTMLButtonElement>('button', 'btn', '创建并运行')
  const taskStatus = el('div', 'task-state', '无任务')
  const progressWrap = el('div', 'progress')
  const progressBar = el('div', 'progress-bar')
  progressWrap.appendChild(progressBar)
  const historyLabel = el('h3', 'subheading', '本课时历史任务')
  const historyList = el('div', 'list')
  taskSection.append(lessonLabel, createRunBtn, taskStatus, progressWrap, historyLabel, historyList)
  center.appendChild(taskSection)

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
  const provSaveBtn = el<HTMLButtonElement>('button', 'btn small', '保存并绑定')
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
  const qaBtn = el<HTMLButtonElement>('button', 'btn small', '提问')
  right.append(qaLog, qaInput, qaBtn)

  // ---- state ----
  let currentLesson = ''
  let currentTask = ''
  let runningTask = ''
  const collapsed = new Set<string>()

  // ---- behaviors ----
  const login = (): Promise<void> =>
    (async () => {
      await withBusy(sessionBtn, '登录中…', async () => {
        const res = (await bridge.school.login()) as Res<{ state: string }>
        if (!res.ok) {
          toast(res.error, 'error')
          return
        }
        sessionBtn.textContent = '已登录'
        toast('登录成功', 'success')
        await loadCourseTree()
      })
    })()

  sessionBtn.addEventListener('click', () => void login())

  async function loadCourseTree(): Promise<void> {
    courseMsg.textContent = ''
    courseMsg.classList.remove('error')
    await refreshSchoolCourses()
    const res = (await bridge.school.courseTree()) as Res<CourseTreeInfo[]>
    if (!res.ok) {
      show(courseMsg, res.error, true)
      return
    }
    renderTree(res.value)
    if (res.value.length === 0) show(courseMsg, '暂无课程，请先登录 CAS')
  }

  async function refreshSchoolCourses(): Promise<void> {
    const res = await withSessionRetry(() => bridge.school.listCourses() as Promise<Res<CourseRow[]>>, () => bridge.school.login())
    if (!res.ok) {
      toast(`${res.error}（仍显示本地课程）`, 'error')
      if (res.kind === 'session_expired') {
        sessionBtn.textContent = '会话过期，重新登录'
        sessionBtn.classList.add('attention')
      }
    }
  }

  function renderTree(tree: CourseTreeInfo[]): void {
    renderCourseTree(courseList, tree, collapsed, currentLesson, {
      onToggleCourse: (id) => {
        if (collapsed.has(id)) collapsed.delete(id)
        else collapsed.add(id)
        renderTree(tree)
      },
      onLessonSelect: (lessonId) => {
        currentLesson = lessonId
        selectLesson(lessonId)
        renderTree(tree)
      }
    })
  }

  function selectLesson(lessonId: string): void {
    lessonLabel.textContent = `已选课时 ${lessonId}`
    loadNote(lessonId)
    void loadHistory(lessonId)
  }

  async function loadNote(lessonId: string): Promise<void> {
    const res = (await bridge.notes.latest(lessonId)) as Res<Note | null>
    if (res.ok && res.value != null) viewer.setNote(res.value)
  }

  async function loadHistory(lessonId: string): Promise<void> {
    const res = (await bridge.tasks.list(lessonId)) as Res<TaskRowInfo[]>
    historyList.textContent = ''
    if (!res.ok) {
      historyList.appendChild(el('div', 'item', `读取失败：${res.error}`))
      return
    }
    for (const row of res.value) {
      historyList.appendChild(renderHistoryRow(row))
    }
    if (res.value.length === 0) historyList.appendChild(el('div', 'item', '暂无任务'))
  }

  function renderHistoryRow(row: TaskRowInfo): HTMLElement {
    const item = el('div', 'item', `${STAGE_LABELS[row.state] ?? row.state}（${row.failed_stage ?? '-'}）：${row.error_message ?? ''}`)
    if (row.state === 'failed') {
      const retry = el('button', 'btn small', '重试')
      retry.addEventListener('click', () => {
        currentTask = row.id
        void launchTask(row.id)
      })
      item.appendChild(retry)
    }
    return item
  }

  // ---- run pipeline (create + runAsync, one button) ----
  createRunBtn.addEventListener('click', () => {
    void (async () => {
      if (currentLesson === '') {
        toast('请先在左侧选择课时', 'error')
        return
      }
      if (runningTask !== '') {
        toast('已有任务在运行', 'info')
        return
      }
      await withBusy(createRunBtn, '提交中…', async () => {
        const created = (await bridge.tasks.create(currentLesson)) as Res<{ id: string }>
        if (!created.ok) {
          toast(created.error, 'error')
          return
        }
        currentTask = created.value.id
        await launchTask(currentTask)
      })
    })()
  })

  async function launchTask(taskId: string): Promise<void> {
    if (runningTask !== '') return
    runningTask = taskId
    setRunning(true)
    show(taskStatus, `任务 ${taskId}：排队中…`)
    const res = (await bridge.tasks.runAsync(taskId)) as Res<{ id: string; state: string }>
    if (!res.ok) {
      setRunning(false)
      show(taskStatus, `启动失败：${res.error}`, true)
      toast(res.error, 'error')
      return
    }
    show(taskStatus, `任务 ${taskId}：运行中…`)
  }

  // ---- progress channel ----
  bridge.tasks.onProgress((p) => {
    if (p.taskId === currentTask) renderProgress(p)
    if (p.state === 'succeeded') {
      runningTask = ''
      setRunning(false)
      renderProgress(p)
      toast(`任务 ${p.taskId} 完成`, 'success')
      void loadNote(currentLesson)
      void loadHistory(currentLesson)
    } else if (p.state === 'failed') {
      runningTask = ''
      setRunning(false)
      renderProgress(p)
      toast(p.message, 'error')
      if (p.kind === 'session_expired') {
        sessionBtn.textContent = '会话过期，重新登录'
        sessionBtn.classList.add('attention')
        toast('会话已过期，登录后将自动恢复此任务', 'info')
      }
    }
  })

  function renderProgress(p: TaskProgressInfo): void {
    show(taskStatus, `任务 ${p.taskId}：${stageLabel(p.state, p.stage)}${p.state === 'failed' ? ` — ${p.message}` : ''}`, p.state === 'failed')
    progressBar.style.width = `${Math.max(0, Math.min(100, p.percent))}%`
    progressWrap.classList.toggle('active', p.state !== 'succeeded' && p.state !== 'failed')
  }

  function setRunning(running: boolean): void {
    createRunBtn.disabled = running
    createRunBtn.classList.toggle('busy', running)
  }

  async function withBusy(btn: HTMLButtonElement, busyLabel: string, action: () => Promise<void>): Promise<void> {
    const original = btn.textContent ?? ''
    btn.disabled = true
    btn.textContent = busyLabel
    try {
      await action()
    } finally {
      btn.disabled = false
      btn.textContent = original
    }
  }

  // ---- manual fallback ----
  manualBtn.addEventListener('click', () => {
    void (async () => {
      const cid = manualCourse.value.trim()
      const lid = manualLesson.value.trim()
      if (cid === '' || lid === '') {
        toast('请填写课程 ID 和课时 ID', 'error')
        return
      }
      const res = (await bridge.school.addManualCourse(cid, lid)) as Res<{ courseId: string; lessonId: string }>
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      manualCourse.value = ''
      manualLesson.value = ''
      currentLesson = lid
      toast(`已添加课程 ${cid}，课时 ${lid} 已选中`, 'success')
      await loadCourseTree()
    })()
  })

  // ---- provider settings ----
  provSaveBtn.addEventListener('click', () => {
    void (async () => {
      await withBusy(provSaveBtn, '保存中…', async () => {
        const name = provName.value.trim()
        const baseUrl = provUrl.value.trim()
        const apiKey = provKey.value
        const capability = provModel.value
        const model = provModelName.value.trim()
        if (name === '' || baseUrl === '' || model === '') {
          toast('名称、Base URL、模型名必填', 'error')
          return
        }
        const saved = (await bridge.providers.save({ name, baseUrl, apiKey })) as Res<{ id: string }>
        if (!saved.ok) {
          toast(saved.error, 'error')
          return
        }
        const bound = (await bridge.providers.bind(capability, saved.value.id, model)) as Res<boolean>
        if (!bound.ok) {
          toast(bound.error, 'error')
          return
        }
        toast(`已保存并绑定 ${capability} → ${name}/${model}`, 'success')
        provKey.value = ''
        await refreshProviders()
      })
    })()
  })

  async function refreshProviders(): Promise<void> {
    const res = (await bridge.providers.list()) as Res<{ providers: Array<{ id: string; name: string; hasKey: boolean }>; bindings: Array<{ capability: string; providerId: string; model: string }> }>
    if (!res.ok) {
      show(provMsg, res.error, true)
      return
    }
    provList.textContent = ''
    for (const p of res.value.providers) {
      const boundCaps = res.value.bindings.filter((b) => b.providerId === p.id).map((b) => b.capability).join(', ')
      provList.appendChild(el('div', 'item', `${p.name} — ${boundCaps || '未绑定'}${p.hasKey ? ' ✓' : ' 无Key'}`))
    }
    if (res.value.providers.length === 0) provList.appendChild(el('div', 'item', '尚无 Provider，先在上方添加'))
  }
  void refreshProviders()

  // ---- QA ----
  qaBtn.addEventListener('click', () => {
    void (async () => {
      const question = qaInput.value.trim()
      if (question === '' || currentLesson === '') {
        toast('请先选择课时并输入问题', 'error')
        return
      }
      qaInput.value = ''
      qaLog.appendChild(el('p', 'qa-q', `问：${question}`))
      await withBusy(qaBtn, '思考中…', async () => {
        const res = (await bridge.qa.ask(currentLesson, question)) as Res<{ answer: string }>
        qaLog.appendChild(el('p', res.ok ? 'qa-a' : 'qa-a error', res.ok ? `答：${res.value.answer}` : `失败：${res.error}`))
      })
    })()
  })

  // ---- boot: reflect session state, then load the tree ----
  void (async () => {
    const res = (await bridge.school.session()) as Res<{ state: string }>
    if (res.ok && res.value.state === 'logged_in') {
      sessionBtn.textContent = '已登录'
      await loadCourseTree()
    }
  })().catch(() => undefined)

  return
}

interface CourseRow { id: string; name: string; term?: string; teacher?: string }

function show(el_: HTMLElement, msg: string, isError = false): void {
  el_.textContent = msg
  el_.classList.toggle('error', isError)
}

boot()
