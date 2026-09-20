/**
 * Obsidian 批1 (plan 2026-09-08-obsidian-export): 投影纯函数直测——
 * frontmatter / wikilink / SR 卡语法 / 图片嵌入 / 空 section 省略 / 名称清洗。
 */
import { describe, expect, it } from 'vitest'
import { projectObsidianNote, projectConceptIndex, projectVaultIndex, tagSafe, type ObsidianMeta } from '../src/shared/notes/obsidian'
import { parseNote, type Note } from '../src/shared/notes/schema'

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

describe('projectConceptIndex / projectVaultIndex (批2)', () => {
  it('同 term 跨课时归并（trim/大小写归一），首见形态为展示名', () => {
    const md = projectConceptIndex('信号与系统', [
      {
        lesson: '第3讲 傅里叶级数',
        concepts: [
          { term: '傅里叶级数', definition: '把周期信号表示为正交族线性组合。' },
          { term: '频谱', definition: '信号在频率域的分布。' }
        ]
      },
      {
        lesson: '第5讲 采样',
        concepts: [
          { term: '傅里叶级数 ', definition: '第5讲里对同一概念的再表述。' },
          { term: '奈奎斯特率', definition: '采样率的下限。' }
        ]
      }
    ])
    expect(md).toContain('kind: concept-index')
    expect(md).toContain('## [[傅里叶级数]]')
    expect(md).toContain('- [[第3讲 傅里叶级数]]：把周期信号表示为正交族线性组合。')
    expect(md).toContain('- [[第5讲 采样]]：第5讲里对同一概念的再表述。')
    // 只出现一个傅里叶级数分组（大小写/空白归一），频谱/奈奎斯特率各自成组。
    expect(md.match(/## \[\[傅里叶级数\]\]/g)).toHaveLength(1)
    expect(md).toContain('## [[奈奎斯特率]]')
  })

  it('单课时退化：无重复也成页；空概念课程只出骨架', () => {
    const single = projectConceptIndex('课程甲', [{ lesson: '唯一一讲', concepts: [{ term: '概念', definition: '定义' }] }])
    expect(single).toContain('## [[概念]]')
    const empty = projectConceptIndex('课程乙', [{ lesson: '有一讲', concepts: [] }])
    expect(empty).not.toContain('## [[')
    expect(empty).toContain('概念索引')
  })

  it('_index 模板：结构约定 in-band + 课程清单（空库省略课程节）', () => {
    const md = projectVaultIndex([
      { course: '信号与系统', lessons: 3 },
      { course: 'Python语言设计', lessons: 1 }
    ])
    expect(md).toContain('kind: index')
    expect(md).toContain('#flashcards')
    expect(md).toContain('- [[信号与系统]]（3 课时）')
    expect(md).toContain('- [[Python语言设计]]（1 课时）')
    expect(projectVaultIndex([])).not.toContain('## 课程')
  })
})

describe('B3 tldr（plan 2026-09-19）', () => {
  it('概览小节之前是一行引用', () => {
    const withTldr = { ...RICH, tldr: '一句话：傅里叶级数把周期信号拆成正弦波的叠加。' }
    const md = projectObsidianNote(withTldr, { ...meta, version: 4 }).markdown
    const lines = md.split('\n')
    const overviewIdx = lines.indexOf('## 概览')
    expect(overviewIdx).toBeGreaterThan(0)
    expect(lines[overviewIdx - 2]).toBe('> 一句话：傅里叶级数把周期信号拆成正弦波的叠加。')
  })
})

describe('B1 章节清单（plan 2026-09-19）', () => {
  it('时间线之前有「章节」小节；无章节不出现', () => {
    const withChapters: Note = { ...RICH, chapters: [{ at: 120, title: '级数展开', summary: '从傅里叶级数出发' }] }
    const md = projectObsidianNote(withChapters, { ...meta, version: 5 }).markdown
    expect(md).toContain('## 章节')
    expect(md).toContain('- 02:00 **级数展开** — 从傅里叶级数出发')
    expect(md.indexOf('## 章节')).toBeLessThan(md.indexOf('## 时间线'))
    const bare = projectObsidianNote(RICH, { ...meta, version: 5 }).markdown
    expect(bare).not.toContain('## 章节')
  })
})

describe('B2 金句投影（plan 2026-09-19）', () => {
  it('概念之前有「## 金句」清单；无则不出现', () => {
    const withQuotes: Note = { ...RICH, quotes: [{ at: 300, text: '级数是离散的礼物' }] }
    const md = projectObsidianNote(withQuotes, { ...meta, version: 6 }).markdown
    expect(md).toContain('## 金句')
    expect(md).toContain('- 05:00 「级数是离散的礼物」')
    expect(md.indexOf('## 金句')).toBeLessThan(md.indexOf('## 概念'))
    expect(projectObsidianNote(RICH, { ...meta, version: 6 }).markdown).not.toContain('## 金句')
  })
})
