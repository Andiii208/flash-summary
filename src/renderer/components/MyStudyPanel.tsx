import type { JSX } from 'preact'
import type { CourseTreeInfo } from '../../shared/bridge'
import { CourseTree } from './CourseTree'

export interface MyStudyPanelProps {
  /** 星标课程（C2）。 */
  mine: CourseTreeInfo[]
  /** 已提取课程（M1-4 聚合，有笔记即算，按 lastTaskAt 倒序）。 */
  extracted: CourseTreeInfo[]
  /** 同课推荐（与钉选课程同 subjCode 的其他教学班，C4）。 */
  sameCourses: CourseTreeInfo[]
  selectedLesson: string
  expanded: ReadonlySet<string>
  onToggle: (courseId: string) => void
  onSelect: (lessonId: string) => void
  onHarvestLessons: (courseId: string) => void
  onToggleMine: (courseId: string, mine: boolean) => void
}

interface StudyGroupProps {
  label: string
  count: number
  hint?: string
  children?: preact.ComponentChildren
}

function StudyGroup({ label, count, hint, children }: StudyGroupProps): JSX.Element {
  return (
    <section class="flex flex-col gap-1.5">
      <h3 class="flex items-center gap-1.5 px-0.5 text-[11px] font-semibold tracking-[1.2px] text-muted uppercase">
        {label}
        {count > 0 && <span class="rounded-full bg-surface-2 px-1.5 py-px text-[11px] font-medium normal-case tracking-normal text-muted">{count}</span>}
      </h3>
      {count > 0 ? (
        children
      ) : hint != null ? (
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
      onToggle={props.onToggle}
      onSelect={props.onSelect}
      onHarvestLessons={props.onHarvestLessons}
      onToggleMine={props.onToggleMine}
    />
  )
}

/**
 * M2 批 A：侧栏顶部的「我的学习」聚合区。已提取课程自动浮上来（无需任何
 * 手动动作），星标与同课推荐紧随其后；三组都为空时给出一条可操作的引导。
 */
export function MyStudyPanel(props: MyStudyPanelProps): JSX.Element {
  const { mine, extracted, sameCourses } = props
  const empty = mine.length === 0 && extracted.length === 0 && sameCourses.length === 0
  return (
    <div class="rounded-[var(--radius)] border border-border bg-surface p-2.5 flex flex-col gap-3">
      <h3 class="px-0.5 text-[11px] font-semibold tracking-[1.2px] text-muted uppercase">我的学习</h3>
      {empty ? (
        <p class="px-0.5 text-[11px] leading-relaxed text-muted">
          在下方「全部课程」里找到你的课，点卡上的 ☆ 标记；生成笔记后它会自动出现在这里。
        </p>
      ) : (
        <>
          <StudyGroup label="已提取" count={extracted.length} hint="还没有生成过笔记——从「全部课程」选一门课开始。">
            {renderTree(extracted, props)}
          </StudyGroup>
          <StudyGroup label="我的课程" count={mine.length} hint="点课程卡右侧的 ☆，把你的课钉在这里。">
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
