import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { ChevronDown, ChevronRight } from 'lucide-preact'
import type { CourseTreeInfo } from '../../shared/bridge'
import { CourseTree } from './CourseTree'

export interface MyStudyPanelProps {
  /** 收藏课程（星标；2026-09-04 起语义为「收藏」而非课表——平台课表与实际上课安排有出入，不自动同步）。 */
  mine: CourseTreeInfo[]
  /** 已提取课程（M1-4 聚合，有笔记即算，按 lastTaskAt 倒序）。 */
  extracted: CourseTreeInfo[]
  /** 同课推荐（与收藏课程同 subjCode 的其他教学班，C4）。 */
  sameCourses: CourseTreeInfo[]
  selectedLesson: string
  expanded: ReadonlySet<string>
  /** 批C: courses whose «第N节课» catalog harvest is running. */
  harvestInflight?: ReadonlySet<string>
  /** 健康巡查 2026-09-12 批5: a course-map aggregation is in flight. */
  courseMapBusy?: boolean
  /** C6: remove an empty (never-processed) course. */
  onRemoveCourse?: (courseId: string) => void
  /** M4.1: open the course-level mind map dialog (同主侧栏入口). */
  onCourseMap?: (courseId: string) => void
  onToggle: (courseId: string) => void
  onSelect: (lessonId: string) => void
  onHarvestLessons: (courseId: string) => void
  onToggleMine: (courseId: string, mine: boolean) => void
}

interface StudyGroupProps {
  label: string
  count: number
  hint?: string
  /** F2: ≥2 门课时允许折叠；0/1 门始终展开（没什么可收的）。 */
  children?: preact.ComponentChildren
}

function StudyGroup({ label, count, hint, children }: StudyGroupProps): JSX.Element {
  const collapsible = count >= 2
  const [open, setOpen] = useState(true)
  const toggle = (): void => setOpen((o) => !o)
  const showBody = count > 0 && (!collapsible || open)
  return (
    <section class="flex flex-col gap-1.5">
      <h3
        class={`flex items-center gap-1.5 px-0.5 text-[12px] font-medium tracking-[1px] text-muted${collapsible ? ' cursor-pointer select-none' : ''}`}
        onClick={collapsible ? toggle : undefined}
        aria-expanded={collapsible ? open : undefined}
        role={collapsible ? 'button' : undefined}
      >
        {collapsible && <span class="caret text-[10px]">{open ? <ChevronDown size={11} strokeWidth={1.75} /> : <ChevronRight size={11} strokeWidth={1.75} />}</span>}
        {label}
        {count > 0 && <span class="rounded-full bg-surface-2 px-1.5 py-px text-[11px] font-medium tracking-normal text-muted">{count}</span>}
      </h3>
      {showBody ? (
        children
      ) : count > 0 ? null : hint != null ? (
        <p class="px-0.5 text-[11px] leading-relaxed text-muted">{hint}</p>
      ) : null}
    </section>
  )
}

function renderTree(
  tree: CourseTreeInfo[],
  props: MyStudyPanelProps,
  sameIds: ReadonlySet<string> = new Set()
): JSX.Element {
  return (
    <CourseTree
      tree={tree}
      selectedLesson={props.selectedLesson}
      expanded={props.expanded}
      searching={false}
      sameCourseIds={sameIds}
      harvestInflight={props.harvestInflight}
      courseMapBusy={props.courseMapBusy}
      onRemoveCourse={props.onRemoveCourse}
      onCourseMap={props.onCourseMap}
      onToggle={props.onToggle}
      onSelect={props.onSelect}
      onHarvestLessons={props.onHarvestLessons}
      onToggleMine={props.onToggleMine}
    />
  )
}

/**
 * M2 批 A：侧栏顶部的「我的学习」聚合区。已提取课程自动浮上来（无需任何
 * 手动动作），收藏与同课推荐紧随其后；三组都为空时给出一条可操作的引导。
 */
export function MyStudyPanel(props: MyStudyPanelProps): JSX.Element {
  const { mine, extracted, sameCourses } = props
  const empty = mine.length === 0 && extracted.length === 0 && sameCourses.length === 0
  return (
    <div class="rounded-[var(--radius)] border border-border bg-surface p-2.5 flex flex-col gap-3">
      <h3 class="px-0.5 text-[12px] font-medium tracking-[1px] text-muted">我的学习</h3>
      {empty ? (
        <p class="px-0.5 text-[11px] leading-relaxed text-muted">
          在下方「全部课程」里找到你的课，点课程行右侧的星标收藏；生成笔记后它会自动出现在这里。
        </p>
      ) : (
        <>
          <StudyGroup label="已提取" count={extracted.length} hint="还没有生成过笔记——从「全部课程」选一门课开始。">
            {renderTree(extracted, props)}
          </StudyGroup>
          <StudyGroup label="我的收藏" count={mine.length} hint="点课程行右侧的星标，把常看的课收进这里。">
            {renderTree(mine, props)}
          </StudyGroup>
          {sameCourses.length > 0 && (
            <StudyGroup label="同课其他老师" count={sameCourses.length}>
              {renderTree(sameCourses, props, new Set(sameCourses.map((c) => c.id)))}
            </StudyGroup>
          )}
        </>
      )}
    </div>
  )
}
