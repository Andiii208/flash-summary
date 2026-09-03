/** Human labels for pipeline stages/task states and note views. */
import type { ViewId } from '../shared/notes/views'

export const STAGE_LABELS: Record<string, string> = {
  pending: '排队中',
  fetching_course: '拉取课程信息',
  downloading_video: '下载视频',
  extracting_audio: '提取音频',
  transcribing: '转写音频',
  extracting_visuals: '提取 PPT/关键帧',
  summarizing: '生成笔记',
  succeeded: '已完成',
  failed: '失败'
}

/** Pipeline order for the stage rail (spec §3 six stages). */
export const PIPELINE_STAGES = [
  'fetching_course',
  'downloading_video',
  'extracting_audio',
  'transcribing',
  'extracting_visuals',
  'summarizing'
] as const

export function stageLabel(state: string, stage: string | null): string {
  if (state === 'succeeded') return '已完成'
  if (state === 'failed') return `失败（${STAGE_LABELS[stage ?? ''] ?? stage ?? '未知阶段'}）`
  return STAGE_LABELS[state] ?? STAGE_LABELS[stage ?? ''] ?? state
}

export const VIEW_LABELS: Record<ViewId, string> = {
  detailed: '详细笔记',
  standard: '标准总结',
  key_points: '要点',
  methodology: '方法论'
}
