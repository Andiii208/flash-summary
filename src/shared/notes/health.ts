/**
 * 批3 (plan 2026-09-08 note-quality-overhaul): 笔记体检——质量可观测。
 * 纯函数，检查项全部来自真实库探针实证（2026-09-08 §一）与批1 质量规约：
 * warn = 重新生成可改进的内容缺口；info = 诚实空节的说明（非错误，不拉低
 * 评级——考点/缺口「没有就是没有」，宁空勿编）。不做评分排名与趋势。
 */
import type { Note } from './schema'
import { bigramDice } from './transcript-clean'

export type HealthField = 'overview' | 'concepts' | 'timeline' | 'examCues' | 'questionsAndGaps' | 'quiz' | 'evidence'

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
  examCues: '考点',
  questionsAndGaps: '疑问与缺口',
  quiz: '自测题',
  evidence: '证据引用'
}

const MIN_OVERVIEW_CHARS = 150
const MIN_DEFINITION_CHARS = 60
const REPEAT_SIMILARITY = 0.8
const CIRCULAR_MAX_CHARS = 25
const HIT_RATE_TARGET = 0.6

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
  if (note.concepts.length === 0) return []
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
  return findings
}

function timelineFindings(note: Note): HealthFinding[] {
  if (note.timeline.length === 0) return []
  const repeated = note.timeline.filter((entry) => {
    const detail = entry.detail.trim()
    const title = entry.title.trim()
    return detail === '' || detail === title || bigramDice(detail, title) >= REPEAT_SIMILARITY
  })
  if (repeated.length === 0) return []
  return [{ field: 'timeline', level: 'warn', message: `${repeated.length} 条时间线 detail 疑似复读标题或为空，缺具体数字与结论` }]
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

/** 体检主入口：warn 0=良好 / 1-2=待改进（fair） / ≥3=薄弱（weak）。 */
export function noteHealth(note: Note, hitRate?: { hits: number; total: number } | null): HealthReport {
  const findings = [
    ...overviewFindings(note),
    ...conceptFindings(note),
    ...timelineFindings(note),
    ...honestEmptyFindings(note),
    ...evidenceFindings(hitRate)
  ]
  const warnCount = findings.filter((f) => f.level === 'warn').length
  const grade: HealthReport['grade'] = warnCount === 0 ? 'good' : warnCount <= 2 ? 'fair' : 'weak'
  return { warnCount, grade, findings }
}
