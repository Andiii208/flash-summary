import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { downloadToFile } from '../src/main/media/download'
import { createServer, type Server } from 'http'

let server: Server
let baseUrl: string
let hits: number

beforeEach(async () => {
  hits = 0
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      hits++
      if (req.url === '/flaky' && hits < 3) {
        res.writeHead(503)
        res.end('unavailable')
        return
      }
      if (req.url === '/never') {
        res.writeHead(503)
        res.end('unavailable')
        return
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end('hello-media-bytes')
    })
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      resolve()
    })
  })
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('downloadToFile with retry', () => {
  it('downloads a healthy payload in one attempt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seu-summary-dl-'))
    const target = join(dir, 'out.bin')
    const stats = await downloadToFile(`${baseUrl}/ok`, target, 3)
    expect(stats.attempts).toBe(1)
    expect(stats.bytes).toBe('hello-media-bytes'.length)
    expect(readFileSync(target, 'utf8')).toBe('hello-media-bytes')
    rmSync(dir, { recursive: true, force: true })
  })

  it('retries transient failures and succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seu-summary-dl-'))
    const target = join(dir, 'out.bin')
    const stats = await downloadToFile(`${baseUrl}/flaky`, target, 5)
    expect(stats.attempts).toBe(3)
    expect(readFileSync(target, 'utf8')).toBe('hello-media-bytes')
    rmSync(dir, { recursive: true, force: true })
  }, 20_000)

  it('gives up after the attempt budget and cleans the partial file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seu-summary-dl-'))
    const target = join(dir, 'out.bin')
    await expect(downloadToFile(`${baseUrl}/never`, target, 2)).rejects.toThrowError(/after 2 attempts/)
    expect(existsSync(target)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  }, 20_000)
})

describe('panorama stream guard', () => {
  it('rejects panorama urls at the pipeline boundary (reverse verification)', async () => {
    // Import late to keep the http server setup readable.
    const { downloadStreamForTask } = await import('../src/main/media/pipeline')
    const { openDatabase } = await import('../src/main/db/open')
    const { ensureLibraryLayout } = await import('../src/main/library/paths')

    const dir = mkdtempSync(join(tmpdir(), 'seu-summary-pan-'))
    ensureLibraryLayout(dir)
    const db = openDatabase(join(dir, 'app.db'))
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()

    const deps = {
      db,
      libraryRoot: dir,
      ffmpeg: 'ffmpeg',
      ffprobe: 'ffprobe'
    }
    await expect(
      downloadStreamForTask(deps, 't1', 'teacher', 'http://media/x/1170194-3/index.m3u8')
    ).rejects.toThrowError(/panorama/)

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('stage output evidence table', () => {
  it('records one row per stage per task (upsert semantics)', async () => {
    const { openDatabase } = await import('../src/main/db/open')
    const dir = mkdtempSync(join(tmpdir(), 'seu-summary-ev-'))
    const db = openDatabase(join(dir, 'app.db'))
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t1', 'l1', 'pending', '2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z')").run()

    const insert = db.prepare('INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, ?, ?)')
    insert.run('t1', 'extracting_audio', '{"audioPath":"a.wav"}')
    insert.run('t1', 'extracting_audio', '{"audioPath":"a2.wav"}') // upsert
    insert.run('t1', 'extracting_visuals', '{"kept":3}')

    const rows = db.prepare('SELECT stage, output_json FROM task_stage_outputs WHERE task_id = ? ORDER BY stage').all('t1') as Array<{ stage: string; output_json: string }>
    expect(rows).toEqual([
      { stage: 'extracting_audio', output_json: '{"audioPath":"a2.wav"}' },
      { stage: 'extracting_visuals', output_json: '{"kept":3}' }
    ])
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
