import { describe, expect, it } from 'vitest'
import { CourseTree } from '../../src/renderer/components/CourseTree'
import { TaskPanel } from '../../src/renderer/components/TaskPanel'
import { Dialog } from '../../src/renderer/ui/Dialog'
import { mount } from '../helpers/preact'
import { NoteViewer } from '../../src/renderer/components/NoteViewer'
import type { CourseTreeInfo } from '../../src/shared/bridge'
import type { Note } from '../../src/shared/notes/schema'

/**
 * 批6（plan 2026-09-18 typography-layout-overhaul）: 一致性收口的钉住测试。
 *
 * 这些断言测的是**约定**，不是审美：同一角色的按钮顺序、同一动作的动词、工具行的
 * 分组、弹层的按钮行数。整改前它们各写一套（课程三键在侧栏与全屏页互为镜像、
 * 「选文件夹」一处叫「更改」一处叫「浏览…」、诊断弹层有两个按钮行、工具行 7 个
 * 按钮平铺无分组）。约定被改坏时这里必须红。
 */

const NOTE: Note = {
  chapters: [],
  quotes: [],
  overview: '概览',
  knowledgeTree: { title: '根', children: [] },
  timeline: [],
  concepts: [],
  formulasAndSteps: [],
  methodology: '方法',
  examCues: [],
  questionsAndGaps: [],
  quiz: [],
  conceptLinks: [],
  transcriptRefs: [],
  evidence: []
}

// 三键齐全的前提：只有「从未处理过」的课程才可删除（C6 级联保护），所以这里
// 用一门没有课时、没有笔记的课。
const COURSE: CourseTreeInfo = {
  id: 'c1',
  name: '电子电路',
  teacher: '王辰星',
  lessons: [],
  noteCount: 0,
  isMine: false
} as unknown as CourseTreeInfo

describe('课程行的三个动作键（批6 T40）', () => {
  it('顺序统一为「星标 → 导图 → 删除」，且星标也有 aria-label', () => {
    const host = mount(
      <CourseTree
        tree={[COURSE]}
        selectedLesson=""
        expanded={new Set(['c1'])}
        searching={false}
        sameCourseIds={new Set<string>()}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onHarvestLessons={() => undefined}
        onToggleMine={() => undefined}
        onCourseMap={() => undefined}
        onRemoveCourse={() => undefined}
      />
    )
    const buttons = [...host.querySelectorAll('.course-row-head .pin-btn')]
    expect(buttons).toHaveLength(3)
    const labels = buttons.map((b) => b.getAttribute('aria-label') ?? '')
    expect(labels[0]).toContain('收藏')
    expect(labels[1]).toContain('课程导图')
    expect(labels[2]).toContain('删除课程')
  })
})

describe('面板行动条（批6 T41）', () => {
  it('创建/取消在同一行行动条里，不再是无容器的裸按钮', () => {
    const host = mount(
      <TaskPanel
        currentLesson="l1"
        running
        busy={false}
        progress={null}
        history={[]}
        globalHistory={[]}
        onCreateRun={() => undefined}
        onRetry={() => undefined}
        onCancel={() => undefined}
        onDelete={() => undefined}
        onClearFinished={() => undefined}
      />
    )
    const row = host.querySelector('.panel-actions')
    expect(row).not.toBeNull()
    const texts = [...row!.querySelectorAll('button')].map((b) => b.textContent)
    expect(texts).toEqual(['排队下一节', '取消任务'])
  })
})

describe('弹层按钮行（批6 T37/T52）', () => {
  it('extraActions 与关闭键同排——弹层只有一行按钮', () => {
    const host = mount(
      <Dialog
        open
        kind="view"
        title="错误诊断信息"
        confirmLabel="关闭"
        extraActions={<button class="btn small">复制诊断信息</button>}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      >
        <pre>诊断正文</pre>
      </Dialog>
    )
    const rows = host.querySelectorAll('.dialog-actions')
    expect(rows).toHaveLength(1)
    const texts = [...rows[0]!.querySelectorAll('button')].map((b) => b.textContent)
    expect(texts).toEqual(['复制诊断信息', '关闭'])
  })
})

describe('工具行分组（批6 T43）', () => {
  it('笔记工具行用两条分隔线把「维护 · 导出 · 主行动」分开', () => {
    const host = mount(
      <NoteViewer
        note={NOTE}
        onCopy={() => undefined}
        onRegenerate={() => undefined}
        onExport={() => undefined}
        onExportAnki={() => undefined}
        onExportObsidian={() => undefined}
        onExportPdf={() => undefined}
      />
    )
    expect(host.querySelectorAll('.note-actions .toolbar-divider')).toHaveLength(2)
    // 分隔线是 aria-hidden 的纯视觉元素，不参与朗读。
    for (const d of host.querySelectorAll('.note-actions .toolbar-divider')) {
      expect(d.getAttribute('aria-hidden')).toBe('true')
    }
  })
})
