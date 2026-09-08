/**
 * Obsidian 批1 (plan 2026-09-08-obsidian-export): 投影纯函数直测——
 * frontmatter / wikilink / SR 卡语法 / 图片嵌入 / 空 section 省略 / 名称清洗。
 */
import { describe, expect, it } from 'vitest'
import { projectObsidianNote, tagSafe, type ObsidianMeta } from '../src/shared/notes/obsidian'
import { parseNote } from '../src/shared/notes/schema'

const meta: ObsidianMeta = {
  course: '信号与系统',
  lesson: '第3讲 傅里叶级数',
  lessonId: '1690625-L0',
  origin: 'seu',
  version: 3,
  created: '2026-09-08T06:00:00.000Z',
  attachments: [
    { ref: 'kf:kf-7', name: '1690625-L0-kf-7.jpg' },
    { ref: 'kf:kf-9', name: '1690625-L0-kf-9.jpg' }
  ]
}

const RICH = parseNote(
  JSON.stringify({
    overview: '## 本讲主线\n把周期信号分解为正弦基的做法与收敛条件。',
    knowledgeTree: {
      title: '傅里叶级数',
      children: [{ title: '三角形式', terms: ['傅里叶系数'], children: [{ title: '正交性', children: [] }] }]
    },
    timeline: [
      {
        at: 455,
        title: '周期信号的分解',
        detail: '将周期 T 的信号投影到正交三角函数族，得到直流、基波与谐波分量。',
        refs: [{ at: 460, text: '把周期信号拆成正弦波的叠加' }],
        evidence: [
          { kind: 'keyframe', ref: 'kf:kf-7' },
          { kind: 'keyframe', ref: 'kf:kf-9' },
          { kind: 'keyframe', ref: 'kf:kf-missing' }
        ]
      }
    ],
    concepts: [
      { term: '傅里叶级数', definition: '把周期信号表示为三角函数（或复指数）正交族线性组合的展开式。' },
      { term: '傅里叶系数', definition: '展开式中各正交基函数前的权重，由内积（投影）求得。' }
    ],
    formulasAndSteps: [
      { kind: 'formula', content: 'a_k = (1/T)∫ x(t) e^{-jkω0 t} dt', explanation: '复指数系数', refs: [] },
      { kind: 'operation', content: '1. 求 ω0\n2. 逐项积分', explanation: '', refs: [] }
    ],
    methodology: '## 解题思路\n先判定周期与基频。',
    examCues: ['手推三角形式系数公式'],
    questionsAndGaps: ['狄利克雷条件第二版讲义有更新'],
    quiz: [{ question: '傅里叶级数收敛需要什么条件?', answer: '狄利克雷条件：绝对可积、有限极值、有限间断点。', source: 'concept', term: '傅里叶级数' }]
  })
)

describe('projectObsidianNote (批1)', () => {
  const result = projectObsidianNote(RICH, meta)
  const md = result.markdown

  it('frontmatter 承载机器可读元数据（含 bvid 通道）', () => {
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('source: flash-summary')
    expect(md).toContain('course: 信号与系统')
    expect(md).toContain('lesson_id: 1690625-L0')
    expect(md).toContain('origin: seu')
    expect(md).toContain('version: 3')
    expect(md).not.toContain('bvid:')
    const bili = projectObsidianNote(RICH, { ...meta, origin: 'bilibili', bvid: 'BV1vQMBz6EvP' })
    expect(bili.markdown).toContain('origin: bilibili')
    expect(bili.markdown).toContain('bvid: BV1vQMBz6EvP')
  })

  it('概念/树 terms 转 wikilink，跨课时同名概念自动聚合', () => {
    expect(md).toContain('- **[[傅里叶级数]]**：')
    expect(md).toContain('（概念：[[傅里叶系数]]）')
  })

  it('时间线：HH:MM:SS 标题 + 引文 + 仅嵌入真实附件（编造 ref 不渲染）', () => {
    expect(md).toContain('- **07:35 · 周期信号的分解**：')
    expect(md).toContain('  - > 把周期信号拆成正弦波的叠加（07:40）')
    expect(md).toContain('  - ![[1690625-L0-kf-7.jpg]]')
    expect(md).toContain('  - ![[1690625-L0-kf-9.jpg]]')
    expect(md).not.toContain('kf-missing')
    expect(result.attachments.map((a) => a.name).sort()).toEqual(['1690625-L0-kf-7.jpg', '1690625-L0-kf-9.jpg'])
  })

  it('SR 卡语法：概念单行 ::、quiz 多行 ?、牌组标签在标题行', () => {
    expect(md).toContain('## 自测 #flashcards/信号与系统/第3讲')
    expect(md).toContain('[[傅里叶级数]]::把周期信号表示为三角函数（或复指数）正交族线性组合的展开式。')
    expect(md).toContain('傅里叶级数收敛需要什么条件?\n?\n狄利克雷条件：绝对可积、有限极值、有限间断点。')
  })

  it('缺口为 Obsidian 任务列表，考点/公式/方法论照投影纪律', () => {
    expect(md).toContain('## 疑问与缺口\n\n- [ ] 狄利克雷条件第二版讲义有更新')
    expect(md).toContain('## 考试与作业提示\n\n- 手推三角形式系数公式')
    expect(md).toContain('a_k = (1/T)∫ x(t) e^{-jkω0 t} dt')
    expect(md).toContain('## 方法论')
  })

  it('空 section 省略（无考点时不出空标题）', () => {
    const empty = parseNote(
      JSON.stringify({
        overview: 'o',
        knowledgeTree: { title: 'r', children: [] },
        methodology: 'm',
        concepts: [],
        examCues: [],
        questionsAndGaps: [],
        timeline: []
      })
    )
    const md = projectObsidianNote(empty, { ...meta, attachments: [] }).markdown
    expect(md).not.toContain('## 时间线')
    expect(md).not.toContain('## 概念')
    expect(md).not.toContain('## 考试与作业提示')
    expect(md).not.toContain('#flashcards')
  })

  it('特殊字符的 YAML 值加引号；文件名/tag 清洗', () => {
    const quoted = projectObsidianNote(RICH, { ...meta, course: 'C++: 从入门到 "放弃"' })
    expect(quoted.markdown).toContain('course: "C++: 从入门到 \\"放弃\\""')
    expect(tagSafe('信号与系统 第3讲')).toBe('信号与系统-第3讲')
    expect(tagSafe('')).toBe('deck')
  })
})
