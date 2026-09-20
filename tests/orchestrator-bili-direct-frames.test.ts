import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, copyFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createServer } from 'http'
import ffmpegStatic from 'ffmpeg-static'
import { readFileSync, readdirSync } from 'fs'
import { openDatabase, type Db } from '../src/main/db/open'
import { createExecutors, type OrchestratorDeps } from '../src/main/tasks/orchestrator'
import { keyframesFromUrlArgs, run as runProcess } from '../src/main/media/ffmpeg'
import type { SchoolClient } from '../src/main/school/client'
import type { OpenAiCompatibleClient } from '../src/main/providers/openai-client'
import type { Grid8x8 } from '../src/shared/phash'

/**
 * A3-② (plan 2026-09-19): 字幕快路径免下载抽帧。
 *
 * 两个契约抓实：
 *  1. 有字幕 + 有流 URL：downloading_video **不下载整片**，ffmpeg 直读流 URL 出帧
 *     （extracting_visuals 从 directFramesDir 收帧落库）；
 *  2. 直读失败（URL 404/风控）：**回落整片下载旧路径**（回退保底），extracting_visuals
 *     从下载文件抽帧——旧路径逐字节保留的证据。
 */

let db: Db
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-bili-direct-'))
  db = openDatabase(join(dir, 'app.db'))
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-20T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-20T00:00:00Z')").run()
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const school = {
    lessonDetail: async () => ({
      id: 'l1',
      courseId: 'c1',
      title: '第五讲',
      teacherStreamUrl: 'http://media/teacher.m3u8',
      screenStreamUrl: 'http://media/screen.m3u8'
    }),
    listPpt: async () => []
  } as unknown as SchoolClient
  const chat = (() => ({ chat: async () => '{}', chatJson: async () => '{}', transcribe: async () => '' })) as unknown as (
    capability: 'asr' | 'multimodal' | 'text'
  ) => OpenAiCompatibleClient
  const grid: Grid8x8 = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 128))
  return {
    db,
    libraryRoot: dir,
    cacheDir: () => join(dir, 'cache'),
    ffmpeg: ffmpegStatic as string,
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- ffprobe-static 无类型声明，与 orchestrator.test.ts 同款 require
    ffprobe: (require('ffprobe-static') as { path: string }).path,
    school,
    chat,
    gridDecoder: () => grid,
    freeDiskOverride: () => 10 ** 12,
    ...overrides
  }
}

/** 造一段 65s 合成视频（真 ffmpeg，lavfi 源）。 */
async function makeSyntheticVideo(): Promise<string> {
  const file = join(dir, 'synthetic.mp4')
  await runProcess(ffmpegStatic as string, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=320x240:rate=10',
    '-t', '45',
    '-pix_fmt', 'yuv420p',
    file
  ], { timeoutMs: 60_000 })
  return file
}

/** 起本地 http 服（供 ffmpeg 直读流 URL）。 */
async function serveFiles(files: Record<string, string>): Promise<{ port: number; close: () => void }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? ''
    const file = files[path]
    if (file == null || !existsSync(file)) {
      res.statusCode = 404
      res.end('nope')
      return
    }
    const buf = readFileSync(file)
    const range = req.headers.range
    if (range != null) {
      const m = /bytes=(\d+)-(\d*)/.exec(range)
      if (m != null) {
        const start = Number(m[1] ?? 0)
        const end = m[2] != null && m[2] !== '' ? Number(m[2]) : buf.length - 1
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`)
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Type', 'video/mp4')
        res.end(buf.subarray(start, end + 1))
        return
      }
    }
    res.setHeader('Content-Type', 'video/mp4')
    res.end(buf)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr != null ? addr.port : 0
  return { port, close: () => server.close() }
}

/** 直接写 fetching_course 阶段产物（绕过学校 mock，与真实 fetching 记录同形）。 */
function seedFetchingStage(taskId: string, output: Record<string, unknown>): void {
  db.prepare('INSERT INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, ?, ?)').run(
    taskId,
    'fetching_course',
    JSON.stringify(output)
  )
}

function stageOutput(taskId: string, stage: string): Record<string, unknown> | null {
  const row = db.prepare('SELECT output_json FROM task_stage_outputs WHERE task_id = ? AND stage = ?').get(taskId, stage) as
    | { output_json: string }
    | undefined
  return row == null ? null : (JSON.parse(row.output_json) as Record<string, unknown>)
}

describe('keyframesFromUrlArgs（A3-② 纯参数）', () => {
  it('带浏览器 Referer + UA 头（B 站 CDN 防盗链）与 fps 双输出', () => {
    const args = keyframesFromUrlArgs('https://cdn/x.m4s', '/tmp/frame-%04d.jpg', '/tmp/thumb-%04d.jpg', 20)
    const h = args.indexOf('-headers')
    expect(h).toBeGreaterThanOrEqual(0)
    expect(args[h + 1]).toContain('Referer: https://www.bilibili.com/')
    expect(args[h + 1]).toContain('User-Agent: Mozilla/5.0')
    expect(args.indexOf('-i')).toBeGreaterThan(h)
    expect(args[args.indexOf('-i') + 1]).toBe('https://cdn/x.m4s')
    expect(args.join(' ')).toContain('fps=1/20')
  })
})

describe('A3-② 字幕快路径免下载抽帧（真 ffmpeg + 本地 http 流）', () => {
  it('有字幕：downloading 不下载整片，extracting 从直读目录收帧落库', { timeout: 30000 }, async () => {
    const video = await makeSyntheticVideo()
    const server = await serveFiles({ '/video.mp4': video })
    const url = `http://127.0.0.1:${server.port}/video.mp4`
    const { TaskRepository } = await import('../src/main/tasks/queue')
    new TaskRepository(db).create('t-direct', 'l1')
    seedFetchingStage('t-direct', { bilibili: true, videoStreamUrl: url, hasSubtitle: true })
    const deps = makeDeps()
    const executors = createExecutors(deps)

    const dl = await executors.downloading_video({ taskId: 't-direct', lessonId: 'l1', stage: 'downloading_video' })
    expect(dl.status).toBe('ok')
    const dlOut = stageOutput('t-direct', 'downloading_video')
    expect(dlOut?.directFramesDir).toBeTruthy()
    expect(dlOut?.videoPath).toBeFalsy() // 没有下载整片
    const framesDir = dlOut?.directFramesDir as string
    expect(existsSync(framesDir)).toBe(true)
    const frameCount = readdirSync(framesDir).filter((f: string) => /^frame-\d{4}\.jpg$/.test(f)).length
    expect(frameCount).toBeGreaterThanOrEqual(2) // 45s / 20s 间隔 → 3 帧
    server.close()

    const ex = await executors.extracting_visuals({ taskId: 't-direct', lessonId: 'l1', stage: 'extracting_visuals' })
    expect(ex.status).toBe('ok')
    const rows = db.prepare('SELECT COUNT(*) AS n FROM keyframes WHERE lesson_id = ?').get('l1') as { n: number }
    expect(rows.n).toBeGreaterThanOrEqual(1)
    const exOut = stageOutput('t-direct', 'extracting_visuals')
    expect(exOut?.skipped).toBeFalsy()
    // 直读目录已清理（收帧即删，不留缓存垃圾）。
    expect(existsSync(framesDir)).toBe(false)
    // 附件落库。
    const attachDir = join(dir, 'attachments', 'l1', 'keyframes')
    expect(existsSync(attachDir)).toBe(true)
    expect(readdirSync(attachDir).length).toBeGreaterThanOrEqual(1)
  })

  it('直读失败（URL 404）：回落整片下载旧路径，extracting 从下载文件抽帧', { timeout: 30000 }, async () => {
    const video = await makeSyntheticVideo()
    const server = await serveFiles({}) // 空路由字典 → 目标 URL 一律 404
    const brokenUrl = `http://127.0.0.1:${server.port}/gone.mp4`
    try {
      const { TaskRepository } = await import('../src/main/tasks/queue')
      new TaskRepository(db).create('t-fallback', 'l1')
      seedFetchingStage('t-fallback', { bilibili: true, videoStreamUrl: brokenUrl, hasSubtitle: true })

      // injectable fetchStream：模拟「下载成功」（把本地合成文件复制成视频流产物）。
      const deps = makeDeps({
        fetchStream: async (_url: string, target: string) => {
          copyFileSync(video, target)
        }
      } as Partial<OrchestratorDeps>)
      const executors = createExecutors(deps)

      const dl = await executors.downloading_video({ taskId: 't-fallback', lessonId: 'l1', stage: 'downloading_video' })
      expect(dl.status).toBe('ok')
      const dlOut = stageOutput('t-fallback', 'downloading_video')
      expect(dlOut?.videoPath).toBeTruthy() // 走了下载路径
      expect(dlOut?.directFramesDir).toBeFalsy()

      const ex = await executors.extracting_visuals({ taskId: 't-fallback', lessonId: 'l1', stage: 'extracting_visuals' })
      expect(ex.status).toBe('ok')
      const rows = db.prepare('SELECT COUNT(*) AS n FROM keyframes WHERE lesson_id = ?').get('l1') as { n: number }
      expect(rows.n).toBeGreaterThanOrEqual(1)
      const exOut = stageOutput('t-fallback', 'extracting_visuals')
      expect(exOut?.skipped).toBeFalsy()
    } finally {
      server.close()
    }
  })
})
