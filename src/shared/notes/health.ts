/**
 * 批3 (plan 2026-09-08 note-quality-overhaul): 笔记体检——质量可观测。
 * 纯函数，检查项全部来自真实库探针实证（2026-09-08 §一）与批1 质量规约：
 * warn = 重新生成可改进的内容缺口；info = 诚实空节的说明（非错误，不拉低
 * 评级——考点/缺口「没有就是没有」，宁空勿编）。不做评分排名与趋势。
 */
import type { Note, TreeNode } from './schema'
import { bigramDice } from './transcript-clean'

export type HealthField =
  | 'overview'
  | 'concepts'
  | 'timeline'
  /** 批3 (2026-09-17): 知识结构形状（分支数/层数/标题长度）。 */
  | 'knowledgeTree'
  /** 批5 (2026-09-17): 概念关联的命题审计（label 必须是关系词）。 */
  | 'conceptLinks'
  | 'examCues'
  | 'questionsAndGaps'
  | 'quiz'
  | 'evidence'
  /** 批1 (2026-09-17): 转写摘引可核验率——与 visually-anchored 的 evidence 分列。 */
  | 'transcript'
  /** B6 (plan 2026-09-19): 时间线配图覆盖率（分配后仍无图的条目数）。 */
  | 'visualCoverage'

export interface HealthFinding {
  field: HealthField
  level: 'warn' | 'info'
  message: string
}

export interface HealthReport {
  /** warn 数——工具栏徽标「待改进 N 项」的 N。 */
  warnCount: number
  grade: 'good' | 'fair' | 'weak'
  findings: HealthFinding[]
}

/** 面向用户的字段名（渲染层徽标/面板共用单一事实源）。 */
export const HEALTH_FIELD_LABELS: Record<HealthField, string> = {
  overview: '概览',
  concepts: '概念',
  timeline: '时间线',
  knowledgeTree: '知识结构',
  conceptLinks: '概念关联',
  examCues: '考点',
  questionsAndGaps: '疑问与缺口',
  quiz: '自测题',
  evidence: '证据引用',
  transcript: '转写摘引',
  visualCoverage: '画面覆盖'
}

const MIN_OVERVIEW_CHARS = 150
const MIN_DEFINITION_CHARS = 60
const REPEAT_SIMILARITY = 0.8
const CIRCULAR_MAX_CHARS = 25
const HIT_RATE_TARGET = 0.6
/** 批3: 时间线 detail 的字数下限（与 prompt 规约 9.2 同源）。 */
const MIN_DETAIL_CHARS = 60
/** 批3: 自测题题数下限（与 prompt 形状规则 6 的 5-8 同源）。 */
const MIN_QUIZ_ITEMS = 5
/** 批3: 知识树形状下限（与形状规则 7 同源）。 */
const MIN_TREE_BRANCHES = 3
const MIN_TREE_DEPTH = 3
const MAX_NODE_TITLE_CHARS = 20

function overviewFindings(note: Note): HealthFinding[] {
  const overview = note.overview.trim()
  if (overview.length < MIN_OVERVIEW_CHARS) {
    return [{ field: 'overview', level: 'warn', message: `概览仅 ${overview.length} 字（规约 ≥${MIN_OVERVIEW_CHARS}），可能只是一句总起` }]
  }
  if (!overview.includes('##')) {
    return [{ field: 'overview', level: 'warn', message: '概览未用 ## 小节组织（本讲主线/前置知识/学完能做什么）' }]
  }
  return []
}

function conceptFindings(note: Note): HealthFinding[] {
  // 批3 补洞：此前数组为空时直接 return []，于是一份**概念全空**的笔记只要概览
  // 够长就能评 good（体检形同虚设）。必填分节缺失必须是 warn。
  if (note.concepts.length === 0) {
    return [{ field: 'concepts', level: 'warn', message: '概念为空——本讲未产出任何概念，笔记只剩概览' }]
  }
  const findings: HealthFinding[] = []
  const total = note.concepts.reduce((sum, c) => sum + c.definition.trim().length, 0)
  const average = Math.round(total / note.concepts.length)
  if (average < MIN_DEFINITION_CHARS) {
    findings.push({ field: 'concepts', level: 'warn', message: `概念定义平均仅 ${average} 字（规约 ≥${MIN_DEFINITION_CHARS}），多为一句名词解释` })
  }
  const circular = note.concepts.filter((c) => {
    const definition = c.definition.trim()
    return definition.startsWith(c.term) && definition.length < CIRCULAR_MAX_CHARS
  })
  if (circular.length > 0) {
    findings.push({ field: 'concepts', level: 'warn', message: `${circular.length} 条概念定义疑似循环定义（用术语自身解释自身）` })
  }
  // 批2: example 的**存在率**只做 info，不报 warn——讲者没给例子时省略该字段是
  // 正确行为（宁空勿编），把它算成缺口会逼模型编例子。
  const withExample = note.concepts.filter((c) => c.example != null && c.example.trim() !== '').length
  if (withExample === 0) {
    findings.push({ field: 'concepts', level: 'info', message: '概念均无具体例子——本讲若讲过实例可重新生成补上' })
  }
  return findings
}

function timelineFindings(note: Note): HealthFinding[] {
  // 批3 补洞：同 concepts——时间线全空此前静默跳过。
  if (note.timeline.length === 0) {
    return [{ field: 'timeline', level: 'warn', message: '时间线为空——本讲未产出任何时间线索目' }]
  }
  const findings: HealthFinding[] = []
  const repeated = note.timeline.filter((entry) => {
    const detail = entry.detail.trim()
    const title = entry.title.trim()
    return detail === '' || detail === title || bigramDice(detail, title) >= REPEAT_SIMILARITY
  })
  if (repeated.length > 0) {
    findings.push({ field: 'timeline', level: 'warn', message: `${repeated.length} 条时间线 detail 疑似复读标题或为空，缺具体数字与结论` })
  }
  // 批3: prompt 9.2 要求 detail ≥60 字，此前只查「复读标题」不查字数。
  const tooShort = note.timeline.filter((entry) => {
    const detail = entry.detail.trim()
    return detail !== '' && detail !== entry.title.trim() && detail.length < MIN_DETAIL_CHARS
  })
  if (tooShort.length > 0) {
    findings.push({ field: 'timeline', level: 'warn', message: `${tooShort.length} 条时间线 detail 不足 ${MIN_DETAIL_CHARS} 字，只描述没细节` })
  }
  return findings
}

/** 批3: 知识树形状（形状规则 7 的「第一层 3-6 分支 / 整体 3-4 层 / 标题 ≤20 字」）。 */
function treeFindings(note: Note): HealthFinding[] {
  const root = note.knowledgeTree
  if (root == null) return []
  const findings: HealthFinding[] = []
  if (root.children.length < MIN_TREE_BRANCHES) {
    findings.push({ field: 'knowledgeTree', level: 'warn', message: `知识结构只有 ${root.children.length} 个主分支（规约 ${MIN_TREE_BRANCHES}-6 个），覆盖面不足` })
  }
  const depth = treeDepth(root)
  if (depth < MIN_TREE_DEPTH) {
    findings.push({ field: 'knowledgeTree', level: 'warn', message: `知识结构只有 ${depth} 层（规约 ${MIN_TREE_DEPTH}-4 层），细节没下沉到叶子` })
  }
  const longTitles = collectLongTitles(root, []).length
  if (longTitles > 0) {
    findings.push({ field: 'knowledgeTree', level: 'warn', message: `${longTitles} 个节点标题超过 ${MAX_NODE_TITLE_CHARS} 字，导图会撑成整句` })
  }
  return findings
}

function treeDepth(node: TreeNode): number {
  if (node.children.length === 0) return 1
  return 1 + Math.max(...node.children.map(treeDepth))
}

function collectLongTitles(node: TreeNode, out: string[]): string[] {
  if (node.title.trim().length > MAX_NODE_TITLE_CHARS) out.push(node.title)
  for (const child of node.children) collectLongTitles(child, out)
  return out
}

/** 批3: 自测题题数（形状规则 6 的 5-8 题）。空数组走「诚实空节」的 info。 */
function quizFindings(note: Note): HealthFinding[] {
  if (note.quiz.length === 0 || note.quiz.length >= MIN_QUIZ_ITEMS) return []
  return [{ field: 'quiz', level: 'warn', message: `自测题只有 ${note.quiz.length} 题（规约 ${MIN_QUIZ_ITEMS}-8 题），题量不足` }]
}

/** 形状规则 9.8 的关系词白名单——唯一事实源，prompt 与体检共用同一份。 */
export const CONCEPT_LINK_RELATIONS = ['前提', '对比', '易混', '推广', '步骤', '因果', '包含'] as const

/**
 * 批5 (plan 2026-09-17 note-quality upgrade): 概念关联的**命题审计**。
 *
 * 起因：PROGRESS 记录过「conceptLinks 3 条解析率 100%，但 label 偏噪声」。
 * 这是**必然而非偶然**——归一化只校验 from/to 能否解析，label 是自由文本，
 * 于是「参数」「提升」「方法」这类名词填充照样落库，画出来就是一条没有语义的虚线。
 *
 * 审计口径：一条链接要成立，label 必须是一个**关系词**（读得成「A ——关系—— B」
 * 这样的可判定命题）。名词填充不是关系，判不合格。
 *
 * 为什么不照搬外部 skill 的「汇聚/扩展/张力/矛盾」四分类：那套是**跨来源**综合的
 * 分类（多个讲义/教材对同一主题的关系），而本产品严格限定**单课时内**的概念关系
 * （跨课时概念链接是既定不做的边界）。单课时里只有一份来源，「汇聚」无从谈起——
 * 照搬会是类别错误。所以保留既有的单课时关系词表，补上「必须真是关系」这条审计。
 */
function conceptLinkFindings(note: Note): HealthFinding[] {
  // 容忍部分形状：渲染层会在 mock/降级路径下传缺字段的笔记，体检绝不能因此
  // 把整个界面炸掉（一次真实的 app-shell 崩溃就是这么来的）。
  const links = note.conceptLinks ?? []
  if (links.length === 0) return []
  const relations: readonly string[] = CONCEPT_LINK_RELATIONS
  const noisy = links.filter((link) => {
    const label = (link.label ?? '').trim()
    if (label === '') return true
    return !relations.some((relation) => label === relation || label.includes(relation))
  })
  if (noisy.length === 0) return []
  const samples = noisy.slice(0, 3).map((link) => `「${(link.label ?? '').trim() || '(空)'}」`).join('、')
  return [
    {
      field: 'conceptLinks',
      level: 'warn',
      message: `${noisy.length}/${links.length} 条概念关联的 label 不是关系词（${samples}），读不成命题，在导图上只是一条没有语义的虚线`
    }
  ]
}

/** 诚实空节：信息级说明，不拉低评级。 */
function honestEmptyFindings(note: Note): HealthFinding[] {
  const findings: HealthFinding[] = []
  if (note.examCues.length === 0) findings.push({ field: 'examCues', level: 'info', message: '考点为空——转写中未检测到考试相关信息，可尝试重新生成验证' })
  if (note.questionsAndGaps.length === 0) findings.push({ field: 'questionsAndGaps', level: 'info', message: '疑问与缺口为空——转写中未检测到讲者留下的悬念或作业要求' })
  if (note.quiz.length === 0) findings.push({ field: 'quiz', level: 'info', message: '自测题为空——上一轮生成未产出可锚定的题目' })
  return findings
}

function evidenceFindings(hitRate: { hits: number; total: number } | null | undefined): HealthFinding[] {
  if (hitRate == null || hitRate.total === 0) return []
  if (hitRate.hits / hitRate.total >= HIT_RATE_TARGET) return []
  return [
    {
      field: 'evidence',
      level: 'warn',
      message: `证据引用命中 ${hitRate.hits}/${hitRate.total}（目标 ≥60%），时间线画面与文字可能错位`
    }
  ]
}

/**
 * 转写锚可核验率（批1, plan 2026-09-17 note-quality upgrade）：摘引能不能在转写里
 * 找到。与视觉锚并列但**口径不同**——这条只在 main 侧算得出来（渲染层没有转写），
 * 所以由调用方从 `verifyNoteRefs` 的统计里带进来。
 */
function transcriptFindings(hitRate: { hits: number; total: number } | null | undefined): HealthFinding[] {
  if (hitRate == null || hitRate.total === 0) return []
  if (hitRate.hits / hitRate.total >= HIT_RATE_TARGET) return []
  return [
    {
      field: 'transcript',
      level: 'warn',
      message: `转写摘引可核验 ${hitRate.hits}/${hitRate.total}（目标 ≥60%），部分引文在转写里找不到原文`
    }
  ]
}

/**
 * B6 (plan 2026-09-19): 时间线配图覆盖率。由渲染层算好带进来（附件在渲染侧，
 * main 的生成路径只赠与不展示）——对应 Andiii「全是文字没有任何截图」的直接体感。
 *
 * 只报 **info**：无图可能是合法态（B 站流被风控拒、SEU 屏幕流整段静止），报 warn
 * 会触发一次多模态返修烧钱，且返修并不能变出画面。但用户必须看见「多少条没有图」。
 */
function visualCoverageFindings(coverage: { withImage: number; total: number } | null | undefined): HealthFinding[] {
  if (coverage == null || coverage.total === 0) return []
  if (coverage.withImage >= coverage.total) return []
  const missing = coverage.total - coverage.withImage
  return [
    {
      field: 'visualCoverage',
      level: 'info',
      message:
        coverage.withImage === 0
          ? `时间线 ${coverage.total} 条均无配图——本讲可能未取得画面素材（视频流被平台拦截或屏幕流无变化）`
          : `时间线 ${coverage.total} 条中 ${missing} 条无配图——该时段没有可对应的画面素材`
    }
  ]
}

/** 体检主入口：warn 0=良好 / 1-2=待改进（fair） / ≥3=薄弱（weak）。 */
export function noteHealth(
  note: Note,
  hitRate?: { hits: number; total: number } | null,
  transcriptHitRate?: { hits: number; total: number } | null,
  imageCoverage?: { withImage: number; total: number } | null
): HealthReport {
  const findings = [
    ...overviewFindings(note),
    ...conceptFindings(note),
    ...timelineFindings(note),
    ...treeFindings(note),
    ...conceptLinkFindings(note),
    ...honestEmptyFindings(note),
    ...quizFindings(note),
    ...evidenceFindings(hitRate),
    ...transcriptFindings(transcriptHitRate),
    ...visualCoverageFindings(imageCoverage)
  ]
  const warnCount = findings.filter((f) => f.level === 'warn').length
  const grade: HealthReport['grade'] = warnCount === 0 ? 'good' : warnCount <= 2 ? 'fair' : 'weak'
  return { warnCount, grade, findings }
}
