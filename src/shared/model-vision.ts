/**
 * A1 (plan 2026-09-19-note-experience-overhaul): 模型视觉能力知识表。
 *
 * 起因（2026-09-19 真实库实测）：多模态绑定的模型视觉能力不明，而 summarize 照发
 * base64 图片——若模型无视觉：网关要么 400（静默纯文本重发，summarizing 阶段翻倍），
 * 要么悄悄忽略（token 白烧、模型从未见过画面 → evidence 引用 0）。BiliNote v2.1.3
 * 修的是同一个问题（DeepSeek 被图片 400），本产品选的做法是**发送前判定**。
 *
 * **订正（2026-09-20，Andiii 核实）**：上一版把 `mimo-v2.5` 写进「已知无视觉」精确表，
 * 依据是假说而非核实（批 0 探针证不了视觉能力）——而用户确认 MiMo 这个模型**是多模态的**。
 * 错分类的后果正是本文件纪律警告的那一侧：对能看的模型不发图 = 白丢画面。故整条撤下，
 * 回到 null=未知=保守发图。教训：**本表只放核实过的知识，假说不得落表**。
 *
 * 判定纪律（与「不猜题材」同源）：
 *   - 只认**表内已知**的模型名（精确/族前缀匹配，大小写不敏感）；
 *   - 表外模型返回 null = 未知 → **保守发图**（现状逐字节不变）——猜「无视觉」
 *     的代价是白丢画面，比猜「有视觉」的代价（白烧 token）更伤用户；
 *   - 表是**知识**不是配置：新增预设/常见开源 VLM 时加行，别加开关；每行须有核实依据。
 *
 * main（summarize 发不发图）与 renderer（ProviderPanel 徽标）共用本文件一份。
 */

/** 已知**无视觉**能力的常见模型（精确匹配，归一化后）。 */
const NO_VISION_MODELS: ReadonlySet<string> = new Set([
  'deepseek-chat',
  'deepseek-reasoner',
  'qwen/qwen2.5-7b-instruct'
])

/** 已知**有视觉**能力的模型族前缀（覆盖带日期/尺寸后缀的具体版本）。 */
const VISION_PREFIXES: readonly string[] = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-4-turbo',
  'claude-3',
  'claude-sonnet-4',
  'claude-opus-4',
  'gemini',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'mimo-vl',
  'internvl',
  'minicpm-v'
]

/** 模型名归一化：去空白、转小写（模型名大小写不敏感是通行惯例）。 */
function normalize(model: string): string {
  return model.trim().toLowerCase()
}

/**
 * 该模型是否看得见图。`true` = 发图；`false` = 别发（纯文本 prompt）；
 * `null` = 表外未知，调用方按「保守发图」处理。
 */
export function modelHasVision(model: string): boolean | null {
  const name = normalize(model)
  if (name === '') return null
  if (NO_VISION_MODELS.has(name)) return false
  // 族前缀同时匹配全名与去掉厂商段的名字（siliconflow 的「Qwen/Qwen2.5-VL-…」）。
  const tail = name.includes('/') ? name.slice(name.indexOf('/') + 1) : name
  if (VISION_PREFIXES.some((prefix) => name.startsWith(prefix) || tail.startsWith(prefix))) return true
  return null
}

/** 预设徽标用的一句话状态（ProviderPanel 的「用户正在做选择的位置」放事实）。 */
export function visionCapabilityLabel(model: string): string {
  const has = modelHasVision(model)
  return has === false ? '无视觉' : has === true ? '视觉' : '视觉能力未知'
}
