/**
 * 批2 (plan 2026-09-08 note-quality-overhaul) 转写清洗纯函数直测。
 * fixture 含真实库探针样本的脱敏摘录（2026-09-08 只读探针）。
 */
import { describe, expect, it } from 'vitest'
import { cleanTranscript, stripFillers } from '../src/shared/notes/transcript-clean'

describe('stripFillers 语气词压缩', () => {
  it('剔除标点/串尾位置的独立语气词，含连续语气词与重复标点收敛', () => {
    expect(stripFillers('大家好啊，我们开始，呃，看一下这个参数')).toBe('大家好，我们开始，看一下这个参数')
    expect(stripFillers('这个参数是对的，是吧')).toBe('这个参数是对的')
    expect(stripFillers('嗯嗯，好吧，那我们继续')).toBe('那我们继续')
  })

  it('词内/非边界位置不动（右边界保证）', () => {
    expect(stripFillers('啊不是这样')).toBe('啊不是这样')
    expect(stripFillers('我们需要啊看一下')).toBe('我们需要啊看一下')
  })

  it('真实 ASR 样本：数字与结论不受影响', () => {
    const cleaned = stripFillers('呃，刚刚是零点零三，精度是零点九七，然后现在改成零点零一，它精度只有零点八七了。')
    expect(cleaned).toBe('刚刚是零点零三，精度是零点九七，然后现在改成零点零一，它精度只有零点八七了')
    expect(cleaned).not.toContain('呃')
  })
})

describe('cleanTranscript 拼接层', () => {
  it('剔除近空段（清洗后 <5 字，如 120s 分片只剩「嗯。」）', () => {
    const text = cleanTranscript([{ text: '嗯。' }, { text: '好，我们继续下面的内容讲解。' }])
    expect(text).toBe('好，我们继续下面的内容讲解')
  })

  it('全部近空 → 空串；空数组 → 空串', () => {
    expect(cleanTranscript([{ text: '嗯。' }, { text: '' }])).toBe('')
    expect(cleanTranscript([])).toBe('')
  })

  it('相邻精确重复去重（ASR 偶发重复输出）', () => {
    const text = cleanTranscript([{ text: '同一段话被识别了两遍的完整内容' }, { text: '同一段话被识别了两遍的完整内容' }])
    expect(text.split('\n')).toHaveLength(1)
  })

  it('相邻长段高度相似去重（bigram Dice ≥ 0.85）', () => {
    const first = '我们今天来讲一下关于机器学习中模型训练的完整流程以及相关的注意事项'
    const second = '我们今天来讲一下关于机器学习中模型训练的完整流程以及注意事项'
    const text = cleanTranscript([{ text: first }, { text: second }])
    expect(text.split('\n')).toHaveLength(1)
  })

  it('短段仅精确相等去重（B站字幕行防误杀）', () => {
    const text = cleanTranscript([{ text: '我们继续吧' }, { text: '我们继续看吧' }])
    expect(text.split('\n')).toHaveLength(2)
  })

  it('非相邻重复保留（课程合法回顾）', () => {
    const text = cleanTranscript([{ text: '同一段话的完整内容在这里' }, { text: '中间隔了完全不同的另一段内容' }, { text: '同一段话的完整内容在这里' }])
    expect(text.split('\n')).toHaveLength(3)
  })

  it('非字符串 text 容错', () => {
    const text = cleanTranscript([{ text: undefined } as unknown as { text?: string }, { text: '正常的一段完整内容' }])
    expect(text).toBe('正常的一段完整内容')
  })
})
