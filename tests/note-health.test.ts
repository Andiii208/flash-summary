/**
 * 批3 (plan 2026-09-08 note-quality-overhaul) noteHealth 体检纯函数直测。
 * 夹具对照真实库探针的两极：B站课（丰富）vs SEU 旧课（薄）。
 */
import { describe, expect, it } from 'vitest'
import { noteHealth, HEALTH_FIELD_LABELS } from '../src/shared/notes/health'
import { parseNote, type Note } from '../src/shared/notes/schema'

function noteFixture(overrides: Partial<Record<string, unknown>> = {}): Note {
  const base = {
    overview:
      '## 本讲主线\n本讲以鸢尾花数据集为例，用 PyTorch 完整走了一遍线性分类模型的工程实践流程，覆盖从环境搭建到超参数调优的每个环节。\n## 前置知识\n需要了解基础的张量操作、训练循环结构以及简单的数据预处理方法。\n## 学完能做什么\n独立完成数据加载、模型构建、训练评估与调参的模块化程序，并能针对精度不达标的情况系统性地排查原因。',
    knowledgeTree: { title: '机器学习工程实践', children: [] },
    timeline: [{ at: 0, title: '超参数调整演示', detail: '模型宽度从 32 改为 64 后测试集精度由 0.97 回落至 0.87，说明容量过大在本数据集上会过拟合。', refs: [], evidence: [] }],
    concepts: [
      {
        term: '学习率',
        definition:
          '优化算法中的步长参数，控制每次参数更新的幅度；过大会导致损失震荡难以收敛，过小则收敛速度极慢，通常需要配合学习率调度器在训练过程中动态调整。'
      }
    ],
    formulasAndSteps: [],
    methodology: '## 解题思路\n先搭最小可运行管线再逐步调参。',
    examCues: ['手推交叉熵损失的梯度公式'],
    questionsAndGaps: ['讲者留下的作业：完成模块化重构'],
    quiz: [{ question: '学习率过大有什么后果?', answer: '损失震荡难以收敛。', source: 'concept' as const, term: '学习率' }]
  }
  return parseNote(JSON.stringify({ ...base, ...overrides }))
}

describe('noteHealth 体检 (批3 2026-09-08)', () => {
  it('丰富笔记 → good，零 warn', () => {
    const report = noteHealth(noteFixture(), { hits: 8, total: 8 })
    expect(report.warnCount).toBe(0)
    expect(report.grade).toBe('good')
    expect(report.findings.every((f) => f.level === 'info' || f.level === 'warn')).toBe(true)
  })

  it('概览过短（探针实证 130 字旧笔记）→ warn', () => {
    const report = noteHealth(noteFixture({ overview: '本课程讲解基于鸢尾花数据集的线性分类模型。' }))
    const finding = report.findings.find((f) => f.field === 'overview')
    expect(finding?.level).toBe('warn')
    expect(finding?.message).toContain('概览仅 21 字')
  })

  it('概览够长但无 ## 小节 → warn', () => {
    const long = '很长的概览。'.repeat(40)
    const report = noteHealth(noteFixture({ overview: long }))
    expect(report.findings.find((f) => f.field === 'overview')?.message).toContain('## 小节')
  })

  it('概念定义均长不足（SEU 旧课 35-45 字）→ warn', () => {
    const report = noteHealth(
      noteFixture({
        concepts: [
          { term: '模型宽度', definition: '神经网络中隐藏层的大小。' },
          { term: '学习率', definition: '优化算法中的步长参数。' }
        ]
      })
    )
    const finding = report.findings.find((f) => f.field === 'concepts' && f.message.includes('平均'))
    expect(finding?.level).toBe('warn')
  })

  it('循环定义启发式（定义以术语开头且过短）→ warn', () => {
    const report = noteHealth(
      noteFixture({
        concepts: [
          { term: '过拟合', definition: '过拟合是模型过拟合的现象，即过拟合地拟合。' },
          { term: '学习率', definition: '优化步长参数，控制更新幅度，过大震荡过小收敛慢，常配调度器动态调整。' }
        ]
      })
    )
    expect(report.findings.find((f) => f.message.includes('循环定义'))?.level).toBe('warn')
  })

  it('时间线 detail 复读标题 / 与标题高度相似 / 为空 → warn', () => {
    const base = noteFixture()
    const repeated = noteHealth(
      noteFixture({ timeline: [{ at: 0, title: '超参数调整', detail: '超参数调整', refs: [], evidence: [] }] })
    )
    expect(repeated.findings.find((f) => f.field === 'timeline')?.message).toContain('1 条')
    const similar = noteHealth(
      noteFixture({ timeline: [{ at: 0, title: '超参数调整', detail: '超参数调整演示', refs: [], evidence: [] }] })
    )
    expect(similar.findings.find((f) => f.field === 'timeline')).toBeDefined()
    const empty = noteHealth(noteFixture({ timeline: [{ at: 0, title: '标题', detail: '  ', refs: [], evidence: [] }] }))
    expect(empty.findings.find((f) => f.field === 'timeline')).toBeDefined()
    expect(noteHealth(base).warnCount).toBe(0)
  })

  it('诚实空节 → info 级，不拉低评级', () => {
    const report = noteHealth(noteFixture({ examCues: [], questionsAndGaps: [], quiz: [] }))
    const infos = report.findings.filter((f) => f.level === 'info')
    expect(infos.map((f) => f.field).sort()).toEqual(['examCues', 'questionsAndGaps', 'quiz'])
    expect(report.warnCount).toBe(0)
    expect(report.grade).toBe('good')
  })

  it('证据命中率低于 60% → warn；达标/无引用 → 静默', () => {
    expect(noteHealth(noteFixture(), { hits: 2, total: 8 }).findings.find((f) => f.field === 'evidence')?.level).toBe('warn')
    expect(noteHealth(noteFixture(), { hits: 8, total: 10 }).findings.find((f) => f.field === 'evidence')).toBeUndefined()
    expect(noteHealth(noteFixture(), { hits: 0, total: 0 }).findings.find((f) => f.field === 'evidence')).toBeUndefined()
    expect(noteHealth(noteFixture(), null).findings.find((f) => f.field === 'evidence')).toBeUndefined()
  })

  it('批1: 转写摘引可核验率低于 60% → warn；与视觉锚分列互不干扰', () => {
    // 视觉锚达标、摘引全编造 → 只出 transcript 一条 warn。
    const onlyTranscript = noteHealth(noteFixture(), { hits: 8, total: 8 }, { hits: 1, total: 4 })
    expect(onlyTranscript.findings.find((f) => f.field === 'transcript')?.level).toBe('warn')
    expect(onlyTranscript.findings.find((f) => f.field === 'evidence')).toBeUndefined()
    expect(onlyTranscript.warnCount).toBe(1)

    // 摘引达标 → 静默。
    expect(noteHealth(noteFixture(), null, { hits: 9, total: 10 }).findings.find((f) => f.field === 'transcript')).toBeUndefined()
    // 没有可判的摘引（null / 分母 0）→ 静默，不冤判。
    expect(noteHealth(noteFixture(), null, null).findings.find((f) => f.field === 'transcript')).toBeUndefined()
    expect(noteHealth(noteFixture(), null, { hits: 0, total: 0 }).findings.find((f) => f.field === 'transcript')).toBeUndefined()
    // 第三个参数省略 = 旧调用方，行为逐字不变。
    expect(noteHealth(noteFixture(), { hits: 8, total: 8 }).warnCount).toBe(0)
  })

  it('评级边界：0 warn=good / 1-2=fair / ≥3=weak', () => {
    expect(noteHealth(noteFixture({ overview: '太短。' })).grade).toBe('fair')
    const weak = noteHealth(
      noteFixture({
        overview: '太短。',
        concepts: [{ term: 'A概念', definition: '很短。' }],
        timeline: [{ at: 0, title: '标题甲', detail: '标题甲', refs: [], evidence: [] }]
      })
    )
    expect(weak.grade).toBe('weak')
  })

  it('字段标签单一事实源', () => {
    expect(HEALTH_FIELD_LABELS.overview).toBe('概览')
    expect(HEALTH_FIELD_LABELS.questionsAndGaps).toBe('疑问与缺口')
  })
})
