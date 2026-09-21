/**
 * 批3 (plan 2026-09-08 note-quality-overhaul) noteHealth 体检纯函数直测。
 * 夹具对照真实库探针的两极：B站课（丰富）vs SEU 旧课（薄）。
 */
import { describe, expect, it } from 'vitest'
import { noteHealth, HEALTH_FIELD_LABELS, CONCEPT_LINK_RELATIONS } from '../src/shared/notes/health'
import { parseNote, type Note } from '../src/shared/notes/schema'

function noteFixture(overrides: Partial<Record<string, unknown>> = {}): Note {
  // 批3 (2026-09-17) 起这份夹具必须**真的**满足规约：此前体检不查知识树形状、
  // 不查 detail 字数、不查题量，「丰富笔记 → good」其实是靠体检太浅才通过的。
  // 现在它是「一份合规笔记长什么样」的范本。
  const base = {
    overview:
      '## 本讲主线\n本讲以鸢尾花数据集为例，用 PyTorch 完整走了一遍线性分类模型的工程实践流程，覆盖从环境搭建到超参数调优的每个环节。\n## 前置知识\n需要了解基础的张量操作、训练循环结构以及简单的数据预处理方法。\n## 学完能做什么\n独立完成数据加载、模型构建、训练评估与调参的模块化程序，并能针对精度不达标的情况系统性地排查原因。',
    knowledgeTree: {
      title: '机器学习工程实践',
      children: [
        { title: '数据处理', children: [{ title: '加载与划分', children: [{ title: '张量批处理', children: [] }] }] },
        { title: '模型构建', children: [{ title: '线性分类器', children: [{ title: '前向传播', children: [] }] }] },
        { title: '训练调优', children: [{ title: '超参数搜索', children: [{ title: '容量控制', children: [] }] }] }
      ]
    },
    timeline: [
      {
        at: 0,
        title: '超参数调整演示',
        detail:
          '把模型宽度从 32 改到 64 之后，测试集精度由 0.97 回落到 0.87，训练集精度却继续上升，说明在这个数据量下容量过大已经明显过拟合，讲者据此建议先把宽度压回 32。',
        refs: [],
        evidence: []
      },
      {
        at: 120,
        title: '学习率对照实验',
        detail: '学习率从 0.1 调到 1.0 之后损失曲线在第三个 epoch 直接发散，调回 0.01 则收敛变慢但稳定，讲者的结论是先用 0.1 再配余弦退火。',
        refs: [],
        evidence: []
      }
    ],
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
    quiz: [
      { question: '学习率过大有什么后果?', answer: '损失震荡难以收敛。', source: 'concept' as const, term: '学习率' },
      { question: '容量过大在本数据集上的表现是什么?', answer: '训练精度继续上升而测试精度回落。', source: 'concept' as const, term: '学习率' },
      { question: '讲者建议的宽度取值是多少?', answer: '先压回 32。', source: 'concept' as const, term: '学习率' },
      { question: '损失发散出现在第几个 epoch?', answer: '第三个。', source: 'concept' as const, term: '学习率' },
      { question: '讲者最后推荐的调度策略是什么?', answer: '先用 0.1 再配余弦退火。', source: 'concept' as const, term: '学习率' }
    ]
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
    // 批2: 夹具的概念没有 example，所以 concepts 也多一条 info（同属「诚实缺失」类，
    // 不拉低评级——报成 warn 会逼模型编例子）。
    expect(infos.map((f) => f.field).sort()).toEqual(['concepts', 'examCues', 'questionsAndGaps', 'quiz'])
    expect(report.warnCount).toBe(0)
    expect(report.grade).toBe('good')
  })

  it('批2: 概念例子只做 info，缺席不拉低评级；有任何一条例子即静默', () => {
    const noExample = noteHealth(noteFixture())
    expect(noExample.findings.find((f) => f.field === 'concepts' && f.level === 'info')?.message).toContain('具体例子')
    expect(noExample.warnCount).toBe(0)

    const withExample = noteHealth(
      noteFixture({
        concepts: [
          {
            term: '学习率',
            definition:
              '优化算法中的步长参数，控制每次参数更新的幅度；过大会导致损失震荡难以收敛，过小则收敛速度极慢，通常需要配合学习率调度器动态调整。',
            example: '演示里把学习率从 0.1 调到 1.0，损失曲线直接发散。'
          }
        ]
      })
    )
    expect(withExample.findings.find((f) => f.field === 'concepts' && f.level === 'info')).toBeUndefined()
  })

  it('批2: example 为空白字符串等同于没有（不让空壳字段骗过体检）', () => {
    const report = noteHealth(
      noteFixture({
        concepts: [
          {
            term: '学习率',
            definition:
              '优化算法中的步长参数，控制每次参数更新的幅度；过大会导致损失震荡难以收敛，过小则收敛速度极慢，通常需要配合学习率调度器动态调整。',
            example: '   '
          }
        ]
      })
    )
    expect(report.findings.find((f) => f.field === 'concepts' && f.level === 'info')).toBeDefined()
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
    expect(HEALTH_FIELD_LABELS.knowledgeTree).toBe('知识结构')
  })
})

describe('批5 概念关联的命题审计（2026-09-17）', () => {
  // 起因：PROGRESS 记录「conceptLinks 3 条解析率 100%，但 label 偏噪声」。归一化只
  // 校验 from/to 能否解析，label 是自由文本——「参数」「提升」这类名词填充照样落库，
  // 画出来就是一条没有语义的虚线。审计口径：label 必须是**关系词**。
  // 注意：归一层会**丢弃 from/to 解析不到的关联**（这正是 PROGRESS 记的「解析率
  // 100%」——只有能解析的活下来）。所以夹具必须用真实存在的概念 term 或节点标题。
  const ENDPOINTS = ['学习率', '数据处理', '模型构建', '训练调优']
  const linkFixture = (labels: string[]): Note =>
    noteFixture({
      conceptLinks: labels.map((label, i) => ({ from: ENDPOINTS[i % ENDPOINTS.length]!, to: ENDPOINTS[(i + 1) % ENDPOINTS.length]!, label }))
    })

  it('关系词 label 全部合格 → 无 warn', () => {
    const report = noteHealth(linkFixture(['前提', '对比', '因果']))
    expect(report.findings.find((f) => f.field === 'conceptLinks')).toBeUndefined()
    expect(report.warnCount).toBe(0)
  })

  it('名词填充 label → warn（这正是「label 偏噪声」的机械判据）', () => {
    const report = noteHealth(linkFixture(['参数', '提升', '方法']))
    const finding = report.findings.find((f) => f.field === 'conceptLinks')
    expect(finding?.level).toBe('warn')
    expect(finding?.message).toContain('不是关系词')
    // 报出前三条样本，用户不用逐条翻
    expect(finding?.message).toContain('参数')
  })

  it('空 label → warn；无关联线时静默', () => {
    expect(noteHealth(linkFixture([''])).findings.find((f) => f.field === 'conceptLinks')).toBeDefined()
    expect(noteHealth(noteFixture({ conceptLinks: [] })).findings.find((f) => f.field === 'conceptLinks')).toBeUndefined()
  })

  it('复合关系词（含关系语素）算合格，不误杀', () => {
    const report = noteHealth(linkFixture(['互为前提', '步骤依赖']))
    expect(report.findings.find((f) => f.field === 'conceptLinks')).toBeUndefined()
  })

  it('关系词白名单与字段标签都是单一事实源', () => {
    expect(CONCEPT_LINK_RELATIONS).toContain('因果')
    expect(HEALTH_FIELD_LABELS.conceptLinks).toBe('概念关联')
  })
})

describe('批3 体检补洞（2026-09-17）', () => {
  it('概念全空不再评 good —— 这正是修复前的漏洞', () => {
    // 修复前：conceptFindings 在数组为空时直接 return []，于是一份**没有概念**
    // 的笔记只要概览够长就 warnCount=0 → good，体检形同虚设。
    const report = noteHealth(noteFixture({ concepts: [] }))
    expect(report.findings.find((f) => f.field === 'concepts' && f.level === 'warn')?.message).toContain('概念为空')
    expect(report.grade).not.toBe('good')
  })

  it('时间线全空不再评 good', () => {
    const report = noteHealth(noteFixture({ timeline: [] }))
    expect(report.findings.find((f) => f.field === 'timeline' && f.level === 'warn')?.message).toContain('时间线为空')
    expect(report.grade).not.toBe('good')
  })

  it('时间线 detail 不足 60 字 → warn（此前只查复读标题，不查字数）', () => {
    const report = noteHealth(
      noteFixture({ timeline: [{ at: 0, title: '模型宽度调整', detail: '宽度从 32 改到 64 之后精度回落了。', refs: [], evidence: [] }] })
    )
    expect(report.findings.find((f) => f.field === 'timeline' && f.message.includes('不足'))).toBeDefined()
  })

  it('知识树形状：主分支不足 / 层数不足 / 标题过长 → 各自 warn', () => {
    const flat = noteHealth(noteFixture({ knowledgeTree: { title: '主题', children: [] } }))
    expect(flat.findings.find((f) => f.field === 'knowledgeTree' && f.message.includes('主分支'))).toBeDefined()
    expect(flat.findings.find((f) => f.field === 'knowledgeTree' && f.message.includes('层'))).toBeDefined()

    const longTitle = noteHealth(
      noteFixture({
        knowledgeTree: {
          title: '机器学习工程实践',
          children: [
            { title: '这是一个明显超过二十个字上限的节点标题用来验证体检', children: [{ title: '子', children: [{ title: '孙', children: [] }] }] },
            { title: '分支二', children: [{ title: '子', children: [{ title: '孙', children: [] }] }] },
            { title: '分支三', children: [{ title: '子', children: [{ title: '孙', children: [] }] }] }
          ]
        }
      })
    )
    expect(longTitle.findings.find((f) => f.field === 'knowledgeTree' && f.message.includes('标题超过'))).toBeDefined()
  })

  it('自测题非空但不足 5 题 → warn；空数组仍走「诚实空节」的 info', () => {
    const few = noteHealth(
      noteFixture({ quiz: [{ question: '学习率过大有什么后果?', answer: '损失震荡。', source: 'concept', term: '学习率' }] })
    )
    expect(few.findings.find((f) => f.field === 'quiz' && f.level === 'warn')?.message).toContain('题量不足')

    const none = noteHealth(noteFixture({ quiz: [] }))
    expect(none.findings.find((f) => f.field === 'quiz' && f.level === 'info')).toBeDefined()
    expect(none.findings.find((f) => f.field === 'quiz' && f.level === 'warn')).toBeUndefined()
  })
})

describe('visualCoverageFindings（B6, plan 2026-09-19）', () => {
  it('部分条目无图 → info 级说明缺几条（合法态不 warn，不逼返修烧钱）', () => {
    const report = noteHealth(noteFixture(), undefined, undefined, { withImage: 5, total: 18 })
    const finding = report.findings.find((f) => f.field === 'visualCoverage')
    expect(finding?.level).toBe('info')
    expect(finding?.message).toContain('13 条无配图')
    expect(report.warnCount).toBe(0)
  })

  it('全部无图 → info 说明本讲可能未取得画面素材', () => {
    const report = noteHealth(noteFixture(), undefined, undefined, { withImage: 0, total: 9 })
    const finding = report.findings.find((f) => f.field === 'visualCoverage')
    expect(finding?.level).toBe('info')
    expect(finding?.message).toContain('均无配图')
  })

  it('全覆盖或无时间线 → 无该项 finding', () => {
    expect(noteHealth(noteFixture(), undefined, undefined, { withImage: 18, total: 18 }).findings.some((f) => f.field === 'visualCoverage')).toBe(false)
    expect(noteHealth(noteFixture(), undefined, undefined, null).findings.some((f) => f.field === 'visualCoverage')).toBe(false)
  })
})

// P31 (plan 2026-09-21): B6 三指标的另两项——章节覆盖率与时间越界。两项都只报
// info（D7：warn 会放大「升级旧笔记」的白烧钱面），warnCount 因此不变。
describe('P31 章节覆盖率与时间越界（B6 三指标补齐）', () => {
  it('条目早于第一个章节 → info 说明几条没有归属', () => {
    const note = noteFixture({ chapters: [{ at: 600, title: '后半场', summary: '调参' }] })
    const finding = noteHealth(note).findings.find((f) => f.field === 'chapterCoverage')
    expect(finding?.level).toBe('info')
    expect(finding?.message).toContain('2 条早于第一个章节')
    expect(noteHealth(note).warnCount).toBe(0)
  })

  it('章节从开头覆盖或无章节 → 无该项 finding', () => {
    expect(noteHealth(noteFixture({ chapters: [{ at: 0, title: '开场', summary: '引入' }] })).findings.some((f) => f.field === 'chapterCoverage')).toBe(false)
    expect(noteHealth(noteFixture()).findings.some((f) => f.field === 'chapterCoverage')).toBe(false)
  })

  it('时间线/章节时间越出转写范围 → info 点名几条（旧工艺外推的可见化）', () => {
    const note = noteFixture({
      timeline: [
        { at: 0, title: 'a', detail: 'x'.repeat(60), refs: [], evidence: [] },
        { at: 9999, title: 'b', detail: 'y'.repeat(60), refs: [], evidence: [] }
      ],
      chapters: [{ at: 8888, title: '越界章节', summary: 's' }]
    })
    const finding = noteHealth(note, undefined, undefined, undefined, { maxAt: 5000 }).findings.find((f) => f.field === 'timeRange')
    expect(finding?.level).toBe('info')
    expect(finding?.message).toContain('1 条时间线')
    expect(finding?.message).toContain('1 个章节')
    expect(noteHealth(note, undefined, undefined, undefined, { maxAt: 5000 }).warnCount).toBe(0)
  })

  it('全部在范围内或渲染层不传范围 → 无该项 finding', () => {
    expect(noteHealth(noteFixture(), undefined, undefined, undefined, { maxAt: 5000 }).findings.some((f) => f.field === 'timeRange')).toBe(false)
    expect(noteHealth(noteFixture()).findings.some((f) => f.field === 'timeRange')).toBe(false)
  })

  it('两个新字段都有面向用户的标签（HEALTH_FIELD_LABELS 单一事实源）', () => {
    expect(HEALTH_FIELD_LABELS.chapterCoverage).toBe('章节覆盖')
    expect(HEALTH_FIELD_LABELS.timeRange).toBe('时间范围')
  })
})
