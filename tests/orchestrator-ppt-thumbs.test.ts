/**
 * 批3 修复轮 1（I1）: PPT 缩略图 spawn 的正负向覆盖。
 *
 * 评审实锤的盲区：既有测试的 `listPpt` mock 恒返回 `[]`（orchestrator.test.ts
 * 与 pipeline-e2e.test.ts 的 fake API plane 都是），`pptCount > 0` 永不成立
 * → orchestrator 里的 PPT 缩略图 spawn 与它的 catch 都是**死代码**——spawn
 * 出错被吞、PPT 哈希 100% 静默回落全分辨率而测试全绿；输出侧
 * `-start_number 0` 若被误删起号错位，同样无声。
 *
 * 这里用本地 http fabric 让 `listPpt` 返回**真 PNG URL**（positive），并
 * stub 掉「仅缩略图 spawn 这一次」的 ffmpeg 调用验证 silent 降级仍在且
 * 被显式钉住（negative）。关键帧抽帧仍走真实 ffmpeg。
 */
import { describe, expect, it, beforeEach, afterEach, afterAll, beforeAll, vi } from 'vitest'
import { createServer, type Server } from 'http'
import type { IncomingMessage, ServerResponse } from 'http'
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { openDatabase, type Db } from '../src/main/db/open'
import { migrate } from '../src/main/db/migrate'
import { TaskRepository } from '../src/main/tasks/queue'
import { createExecutors, type OrchestratorDeps } from '../src/main/tasks/orchestrator'
import type { SchoolClient } from '../src/main/school/client'
import type { OpenAiCompatibleClient } from '../src/main/providers/openai-client'
import { decodeGridPreferThumb } from '../src/main/media/grid'
import type * as FfmpegModule from '../src/main/media/ffmpeg'
import { ffmpegPath } from '../src/main/media/binaries'

/** pngjs 的 Buffer 泛型与本仓 @types/node 不合，按 grid.test.ts 的同款局部断言用。 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PNG } = require('pngjs') as {
  PNG: { sync: { write: (d: { data: Uint8Array; width: number; height: number }) => Buffer } }
}

/** 仅负向用例打开：让**且仅让**缩略图 spawn 抛错（关键帧抽帧不受影响）。 */
const state = vi.hoisted(() => ({ failThumbSpawn: false }))

vi.mock('../src/main/media/ffmpeg', async (importOriginal) => {
  const actual = await importOriginal<typeof FfmpegModule>()
  return {
    ...actual,
    run: async (bin: string, args: string[], options?: Parameters<typeof actual.run>[2]) => {
      if (state.failThumbSpawn && args.some((a) => a.includes('thumb-page'))) {
        throw new Error('stubbed ffmpeg failure (PPT thumb spawn)')
      }
      return actual.run(bin, args, options)
    }
  }
})

const LESSON = 'l-ppt'
let dir: string
let db: Db
let server: Server | null = null
let port = 0
/** 两张内容不同的真 PNG（page-000 / page-001），pngjs 无损写出。 */
const pages: Buffer[] = []

function splitPng(variant: number): Buffer {
  const size = 320
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const v = variant === 0 ? (x < size / 2 ? 0 : 255) : y < size / 2 ? 0 : 255
      data[idx] = v
      data[idx + 1] = v
      data[idx + 2] = v
      data[idx + 3] = 255
    }
  }
  return PNG.sync.write({ data, width: size, height: size })
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const match = /^\/ppt\/page-(\d{3})\.png$/.exec(req.url ?? '')
  if (match == null) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const page = pages[Number(match[1])]
  if (page == null) {
    res.writeHead(404)
    res.end('no page')
    return
  }
  res.writeHead(200, { 'content-type': 'image/png' })
  res.end(page)
}

beforeAll(() => {
  pages.push(splitPng(0), splitPng(1))
})

afterAll(() => {
  pages.length = 0
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'seu-ppt-thumbs-'))
  db = openDatabase(join(dir, 'app.db'))
  migrate(db)
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c-ppt', '课程', '2026-09-19T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES (?, 'c-ppt', '课时', '2026-09-19T00:00:00Z')").run(LESSON)
  await new Promise<void>((resolve) => {
    server = createServer(handle)
    server.listen(0, '127.0.0.1', () => {
      port = (server!.address() as { port: number }).port
      resolve()
    })
  })
})

afterEach(async () => {
  state.failThumbSpawn = false
  await new Promise<void>((resolve) => {
    if (server == null) return resolve()
    server!.close(() => resolve())
    server!.closeAllConnections()
  })
  server = null
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeDeps(): OrchestratorDeps {
  const school = {
    lessonDetail: async () => ({ id: LESSON, courseId: 'c-ppt', title: '课时' }),
    // I1: 让这条路**真的走到**——返回本地 http fabric 上的真 PNG URL。
    listPpt: async () => [
      `http://127.0.0.1:${port}/ppt/page-000.png`,
      `http://127.0.0.1:${port}/ppt/page-001.png`
    ]
  } as unknown as SchoolClient
  const chat = (() => ({ chat: async () => '{}', chatJson: async () => ({}), transcribe: async () => '' })) as unknown as (
    capability: 'asr' | 'multimodal' | 'text'
  ) => OpenAiCompatibleClient
  return {
    db,
    libraryRoot: dir,
    cacheDir: () => join(dir, 'cache'),
    ffmpeg: ffmpegPath(),
    ffprobe: ffmpegPath(),
    school,
    chat,
    gridDecoder: decodeGridPreferThumb
  }
}

/** 真录屏 stand-in：21s testsrc，抽帧 fps=1/10 → 3 候选。 */
function writeScreenVideo(taskDir: string): string {
  mkdirSync(taskDir, { recursive: true })
  const screen = join(taskDir, 'screen.mp4')
  execFileSync(ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=21:size=64x64:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', screen], { stdio: 'pipe' })
  return screen
}

async function runVisuals(taskId: string) {
  const deps = makeDeps()
  const repo = new TaskRepository(db)
  repo.create(taskId, LESSON)
  const taskDir = join(dir, 'cache', taskId)
  const screen = writeScreenVideo(taskDir)
  db.prepare("INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, 'downloading_video', ?)").run(
    taskId,
    JSON.stringify({ teacherPath: screen, screenPath: screen })
  )
  const executors = createExecutors(deps)
  const pptDir = join(dir, 'attachments', LESSON, 'ppt')
  const result = await executors.extracting_visuals({ taskId, lessonId: LESSON, stage: 'extracting_visuals' })
  return { result, pptDir }
}

function seededPptRows(): Array<{ page_index: number }> {
  return db.prepare('SELECT page_index FROM ppt_pages WHERE lesson_id = ? ORDER BY page_index').all(LESSON) as Array<{ page_index: number }>
}

describe('批3 修复轮 I1: PPT 缩略图 spawn（listPpt 真返回 2 页本地 PNG）', () => {
  it('positive: 页落盘且一次 spawn 产出配对缩略图（起号从 0 开始）', async () => {
    const { result, pptDir } = await runVisuals('t-ppt-ok')
    expect(result).toEqual({ status: 'ok' })

    expect(seededPptRows().map((r) => r.page_index)).toEqual([0, 1])
    for (const name of ['page-000.png', 'page-001.png', 'thumb-page-000.png', 'thumb-page-001.png']) {
      expect(existsSync(join(pptDir, name))).toBe(true)
    }
    // 页数配对：缩略图与页数量一致，没有漏配也没有多产。
    const { readdirSync } = await import('fs')
    const files = readdirSync(pptDir)
    expect(files.filter((f) => f.startsWith('thumb-')).length).toBe(2)
    expect(files.filter((f) => /^page-\d{3}\.png$/.test(f)).length).toBe(2)

    // 阶段记账如实带上 ppt 数。
    const stage = db.prepare('SELECT output_json FROM task_stage_outputs WHERE task_id = ? AND stage = ?').get('t-ppt-ok', 'extracting_visuals') as { output_json: string }
    expect(JSON.parse(stage.output_json)).toMatchObject({ ppt: 2 })

    // 关键帧支线不受影响（SEU 分支照常产出）。
    expect((db.prepare('SELECT COUNT(*) AS n FROM keyframes WHERE lesson_id = ?').get(LESSON) as { n: number }).n).toBeGreaterThan(0)
  })

  it('negative: spawn 抛错时任务不崩、PPT 页照发、无缩略图（silent 降级被钉住）', async () => {
    state.failThumbSpawn = true
    const { result, pptDir } = await runVisuals('t-ppt-fail')
    expect(result).toEqual({ status: 'ok' })

    expect(seededPptRows().map((r) => r.page_index)).toEqual([0, 1])
    expect(existsSync(join(pptDir, 'page-000.png'))).toBe(true)
    expect(existsSync(join(pptDir, 'page-001.png'))).toBe(true)
    // spawn 失败被 catch：没有缩略图，也不该有半截 thumb。
    expect(existsSync(join(pptDir, 'thumb-page-000.png'))).toBe(false)
    expect(existsSync(join(pptDir, 'thumb-page-001.png'))).toBe(false)
    // 哈希回落原图的路径由 grid/notes-visual-hash 测试钉住；这里钉住
    // 「降级不毁阶段」：关键帧仍在、阶段记账的 ppt 数仍如实。
    expect((db.prepare('SELECT COUNT(*) AS n FROM keyframes WHERE lesson_id = ?').get(LESSON) as { n: number }).n).toBeGreaterThan(0)
    const stage = db.prepare('SELECT output_json FROM task_stage_outputs WHERE task_id = ? AND stage = ?').get('t-ppt-fail', 'extracting_visuals') as { output_json: string }
    expect(JSON.parse(stage.output_json)).toMatchObject({ ppt: 2 })
  })
})
