/**
 * Play-page stream harvest (v0.2.1 V1).
 *
 * The platform's JSON lesson APIs (/v1/vod/getList, lastPlayInfoById) reject
 * every parameter shape we tried (GET missing params → 500, POST unsupported),
 * so lesson detail is harvested from the play page itself: the SPA route
 * `#/play-video?courseId=&teclId=&teclCode=` renders two <video> elements
 * (teacher + screen) whose src attributes are direct dncvsvod mp4 URLs with a
 * time-limited auth_key signature, plus the course's «第N节课» catalog.
 *
 * This runs in the MAIN window (the second renderer never loads on this
 * machine — see PROGRESS "失败与卡点"): navigate → wait for videos → read
 * src → navigate back to the app UI (also on failure). Stream URLs are never
 * logged; only their sanitized paths are ever persisted outside the task's
 * stage handoff.
 */
import { SchoolApiError } from './client'
import { isCasLoginRedirect } from './api-parse'
import { PLATFORM_API_BASE_PATH } from '../auth/cas-login'

export interface PlayPageTarget {
  courseId: string
  teclId: string
  teclCode: string
}

/** Play-page route for one course (hash routing on the -ui SPA origin). */
export function buildPlayPageUrl(origin: string, target: PlayPageTarget): string {
  const q = (v: string): string => encodeURIComponent(v)
  return `${origin}${PLATFORM_API_BASE_PATH}-ui/#/play-video?courseId=${q(target.courseId)}&teclId=${q(target.teclId)}&teclCode=${q(target.teclCode)}`
}

/**
 * Classify video.src values into teacher/screen streams. The dncvsvod path
 * embeds the Kedacom stream ids (teacher 1170193-*, screen 1170195-*); when
 * neither id appears, fall back to DOM order (first video = teacher). Pure
 * and unit-tested; live calibration happens in V1.4.
 */
export function pickStreamUrls(srcs: string[]): { teacherStreamUrl?: string; screenStreamUrl?: string } {
  const urls = srcs.filter((s) => typeof s === 'string' && s !== '')
  let teacherStreamUrl: string | undefined
  let screenStreamUrl: string | undefined
  for (const url of urls) {
    const path = url.split('?')[0] ?? ''
    if (teacherStreamUrl == null && path.includes('1170193')) teacherStreamUrl = url
    else if (screenStreamUrl == null && path.includes('1170195')) screenStreamUrl = url
  }
  if (teacherStreamUrl == null && urls.length > 0) teacherStreamUrl = urls[0]
  if (screenStreamUrl == null && urls.length > 1) screenStreamUrl = urls[1]
  return {
    ...(teacherStreamUrl != null ? { teacherStreamUrl } : {}),
    ...(screenStreamUrl != null ? { screenStreamUrl } : {})
  }
}

/**
 * Red-line form of a stream URL: drop the query (auth_key and friends), keep
 * origin+path. This is the only shape allowed into the lessons table or logs.
 */
export function sanitizeStreamUrl(url: string): string {
  return url.split('?')[0] ?? ''
}

export interface HarvestedLessonEntry {
  /** Position among the matched «第N节课» entries (DOM order). */
  index: number
  /** Entry text, e.g. «第3节课» (platform wording kept verbatim). */
  title: string
  /** Stable key for later click-through (equals String(index)). */
  ref: string
}

/** Extract the lesson number from «第N节…» text; null when absent. */
export function lessonNumber(title: string): number | null {
  const m = /第\s*(\d+)\s*节/.exec(title)
  return m != null ? Number(m[1]) : null
}

/**
 * Normalize the raw candidate texts collected by LESSON_CATALOG_SCRIPT into
 * entries. DOM order is the platform order; exact duplicate texts collapse
 * (a header and its list item can render the same label).
 */
export function parseLessonEntries(texts: string[]): HarvestedLessonEntry[] {
  const entries: HarvestedLessonEntry[] = []
  let previous = ''
  for (const raw of texts) {
    const title = raw.trim()
    if (title === '' || title === previous) continue
    previous = title
    entries.push({ index: entries.length, title, ref: String(entries.length) })
  }
  return entries
}

/**
 * Candidate selector shared by the catalog and click scripts: elements whose
 * trimmed text matches «第N节», innermost match wins (a click on the inner
 * node still bubbles to the row's handler).
 */
const LESSON_CANDIDATES_FN = `function lessonCandidates() {
  var re = /第\\s*\\d+\\s*节/;
  var all = document.querySelectorAll('span,li,div,button,a,p');
  var matches = [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var t = (el.textContent || '').trim();
    if (t.length > 0 && t.length <= 40 && re.test(t)) matches.push(el);
  }
  return matches.filter(function (el) {
    return !matches.some(function (o) { return o !== el && el.contains(o); });
  });
}`

/** Reads every <video> currentSrc (DOM order). Resolves to string[]. */
export const VIDEO_SOURCES_SCRIPT = `(function () {
  var vs = document.querySelectorAll('video');
  var out = [];
  for (var i = 0; i < vs.length; i++) out.push(vs[i].currentSrc || vs[i].src || '');
  return out;
})()`

/** Resolves to string[] of «第N节课» entry texts (innermost matches, DOM order). */
export const LESSON_CATALOG_SCRIPT = `(function () {
  ${LESSON_CANDIDATES_FN}
  var cands = lessonCandidates();
  var texts = [];
  for (var i = 0; i < cands.length; i++) texts.push((cands[i].textContent || '').trim());
  return texts;
})()`

/** Clicks the «第N节课» entry at `ref` (index). Resolves to boolean. */
export function clickLessonScript(ref: string): string {
  return `(function () {
  ${LESSON_CANDIDATES_FN}
  var cands = lessonCandidates();
  var i = Number(${JSON.stringify(ref)});
  if (!Number.isInteger(i) || i < 0 || i >= cands.length) return false;
  cands[i].click();
  return true;
})()`
}

// ---- imperative harvest flow (main window navigation; exercised live in V1.4) ----

export interface PlayHarvestResult {
  teacherStreamUrl?: string
  screenStreamUrl?: string
  lessons: HarvestedLessonEntry[]
}

export interface HarvestOptions {
  origin: string
  target: PlayPageTarget
  /** Restore the app UI after the harvest (also on failure). */
  restoreApp: () => Promise<void>
  /** «第N节课» entry to click before reading the streams (lesson play_ref). */
  selectLessonRef?: string | null
  /** Overall budget for navigation + video wait (default 60s). */
  timeoutMs?: number
  pollIntervalMs?: number
  logger?: { info(message: string): void; error(message: string): void }
  signal?: AbortSignal
}

const DEFAULT_HARVEST_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 700
/** Single-stream stability: a lone unchanged src across this many polls is final. */
const STABLE_ROUNDS = 3

/** Abortable sleep; throws when the signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('任务已取消'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('任务已取消'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** The platform bounces to the SSO host when the session is gone. */
function assertStillOnPlatform(win: BrowserWindowLike, origin: string): void {
  const url = win.webContents.getURL()
  if (!url.startsWith(origin) && isCasLoginRedirect(url)) {
    throw new SchoolApiError('session_expired', '播放页跳转到登录页，请先重新登录')
  }
}

/** Minimal structural view of BrowserWindow (tests substitute stubs). */
export interface BrowserWindowLike {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    getURL(): string
    loadURL(url: string): Promise<void>
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  }
}

async function evalInPage<T>(win: BrowserWindowLike, script: string): Promise<T | null> {
  try {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return null
    const raw = (await win.webContents.executeJavaScript(script, true)) as unknown
    return raw as T
  } catch {
    return null
  }
}

async function readVideoSources(win: BrowserWindowLike): Promise<string[]> {
  const srcs = await evalInPage<string[]>(win, VIDEO_SOURCES_SCRIPT)
  return Array.isArray(srcs) ? srcs.filter((s) => typeof s === 'string' && s !== '') : []
}

function remainingMs(deadline: number): number {
  return deadline - Date.now()
}

/**
 * Navigate the window to the play page. loadURL itself can hang forever on a
 * stalled renderer, so it races the wall-clock budget.
 */
async function navigateToPlayPage(win: BrowserWindowLike, url: string, deadline: number, signal?: AbortSignal): Promise<void> {
  const loading = win.webContents.loadURL(url).then(() => undefined)
  const budgetMs = Math.max(1, remainingMs(deadline))
  const budget = sleep(budgetMs, signal).then(() => {
    throw new Error(`播放页加载超时（${Math.round(budgetMs / 1000)}s 内未完成导航）`)
  })
  await Promise.race([loading, budget])
  assertStillOnPlatform(win, new URL(url).origin)
}

/**
 * Poll the page for <video> sources: resolved as soon as BOTH streams are
 * present; a single stable stream is accepted after STABLE_ROUNDS (some
 * lessons legitimately have one stream); empty at deadline is an error.
 */
async function pollVideoSources(win: BrowserWindowLike, origin: string, deadline: number, intervalMs: number, signal?: AbortSignal): Promise<string[]> {
  let lastKey = ''
  let stableRounds = 0
  let latest: string[] = []
  while (remainingMs(deadline) > 0) {
    if (signal?.aborted) throw new Error('任务已取消')
    assertStillOnPlatform(win, origin)
    latest = await readVideoSources(win)
    if (latest.length >= 2) return latest
    const key = latest.join('|')
    stableRounds = key !== '' && key === lastKey ? stableRounds + 1 : 0
    lastKey = key
    if (latest.length === 1 && stableRounds >= STABLE_ROUNDS) return latest
    await sleep(Math.min(intervalMs, Math.max(1, remainingMs(deadline))), signal)
  }
  return latest
}

/** Click the «第N节课» entry, then wait until the video src set changes. */
async function selectLessonEntry(win: BrowserWindowLike, origin: string, ref: string, deadline: number, intervalMs: number, signal?: AbortSignal): Promise<void> {
  const before = new Set(await readVideoSources(win))
  let clicked = false
  while (!clicked && remainingMs(deadline) > 0) {
    if (signal?.aborted) throw new Error('任务已取消')
    assertStillOnPlatform(win, origin)
    clicked = (await evalInPage<boolean>(win, clickLessonScript(ref))) === true
    if (!clicked) await sleep(Math.min(intervalMs, Math.max(1, remainingMs(deadline))), signal)
  }
  if (!clicked) throw new Error(`播放页未找到课时条目（ref=${ref}），目录可能尚未渲染`)
  while (remainingMs(deadline) > 0) {
    if (signal?.aborted) throw new Error('任务已取消')
    const srcs = await readVideoSources(win)
    const changed = srcs.length > 0 && srcs.some((s) => !before.has(s))
    if (changed || (before.size === 0 && srcs.length > 0)) return
    await sleep(Math.min(intervalMs, Math.max(1, remainingMs(deadline))), signal)
  }
  // The clicked lesson may already be the playing one — keep the current srcs.
}

/**
 * Harvest one course's play page: optional lesson click-through, both stream
 * URLs, and the «第N节课» catalog. Always restores the app UI afterwards.
 */
export async function harvestPlayPage(win: BrowserWindowLike, opts: HarvestOptions): Promise<PlayHarvestResult> {
  if (win.isDestroyed()) throw new Error('主窗口不可用，无法打开播放页')
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_HARVEST_TIMEOUT_MS)
  const intervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const playUrl = buildPlayPageUrl(opts.origin, opts.target)
  const origin = new URL(playUrl).origin
  try {
    await navigateToPlayPage(win, playUrl, deadline, opts.signal)
    if (opts.selectLessonRef != null) {
      await selectLessonEntry(win, origin, opts.selectLessonRef, deadline, intervalMs, opts.signal)
    }
    const srcs = await pollVideoSources(win, origin, deadline, intervalMs, opts.signal)
    if (srcs.length === 0) {
      throw new Error('播放页已加载但未出现视频流（video 无地址或渲染超时）')
    }
    const rawTexts = await evalInPage<string[]>(win, LESSON_CATALOG_SCRIPT)
    const lessons = parseLessonEntries(Array.isArray(rawTexts) ? rawTexts : [])
    const picked = pickStreamUrls(srcs)
    opts.logger?.info(`play harvest: course=${opts.target.courseId} lessons=${lessons.length} streams=${srcs.length}（直链不落日志）`)
    return { ...picked, lessons }
  } finally {
    try {
      await opts.restoreApp()
    } catch (err) {
      opts.logger?.error(`播放页收割后恢复应用界面失败: ${(err as Error).message}`)
    }
  }
}
