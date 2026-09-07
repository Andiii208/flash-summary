/**
 * 批5 (plan 2026-09-07 v07): note feedback tags — the single source of truth
 * shared by the renderer's FeedbackSection and the polish prompt in main.
 * D5: polish runs on the multimodal binding with a truncated transcript, so
 * «补充细节/举例子» can draw on actual course content.
 */
export interface FeedbackTag {
  id: string
  label: string
  /** What the model should DO about it (feeds the polish prompt). */
  instruction: string
}

export const FEEDBACK_TAGS: FeedbackTag[] = [
  { id: 'too_brief', label: '篇幅过短', instruction: '显著扩充篇幅，把本讲内容覆盖得更完整' },
  { id: 'lacks_detail', label: '不够细致', instruction: '对关键概念展开更细致的讲解，补足推导与来龙去脉' },
  { id: 'lacks_examples', label: '缺少例子', instruction: '补充具体例子、演算过程或应用场景' },
  { id: 'unfocused', label: '重点不突出', instruction: '重新组织结构，突出本讲最重要的内容与考点' },
  { id: 'verbose', label: '冗长啰嗦', instruction: '删减重复表述，收紧篇幅，保留核心信息' },
  { id: 'jargon', label: '术语未解释', instruction: '对专业术语给出通俗易懂的解释' }
]

/** Labels for a tag-id list (unknown ids ignored — renderer and main agree on FEEDBACK_TAGS). */
export function feedbackTagInstructions(ids: string[]): string[] {
  return ids
    .map((id) => FEEDBACK_TAGS.find((t) => t.id === id)?.instruction)
    .filter((s): s is string => s != null)
}
