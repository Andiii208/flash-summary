import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { run } from '../src/main/media/ffmpeg'
import { downloadToFile } from '../src/main/media/download'
import { createServer, type Server } from 'http'

const PAYLOAD = '0123456789abcdefghij' // 20 bytes

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-u4b-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ffmpeg run guards (U4)', () => {
  it('rejects when the process exceeds timeoutMs', async () => {
    const script = 'setTimeout(() => {}, 10_000)'
    await expect(run(process.execPath, ['-e', script], { timeoutMs: 300 })).rejects.toThrowError(/timed out after 300ms/)
  }, 10_000)

  it('kills the process when the guard file stops growing', async () => {
    const target = join(dir, 'out.ts')
    writeFileSync(target, 'seed')
    const script = 'setInterval(() => {}, 50)'
    await expect(
      run(process.execPath, ['-e', script], { stallGuard: { file: target, stallMs: 300 } })
    ).rejects.toThrowError(/stalled: no output progress/)
  }, 10_000)
})

describe('downloadToFile Range resume (U4)', () => {
  let server: Server
  let baseUrl: string
  let rangeHits: number

  beforeEach(async () => {
    rangeHits = 0
    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        rangeHits++
        if (req.url === '/resume') {
          const range = req.headers.range
          if (range != null) {
            const start = Number(range.replace('bytes=', '').split('-')[0])
            const rest = PAYLOAD.slice(start)
            res.writeHead(206, {
              'content-type': 'application/octet-stream',
              'content-range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`
            })
            res.end(rest)
            return
          }
          res.writeHead(200, { 'content-type': 'application/octet-stream' })
          res.end(PAYLOAD)
          return
        }
        if (req.url === '/no-range') {
          // Server that ignores Range: always answers 200 with the full body.
          res.writeHead(200, { 'content-type': 'application/octet-stream' })
          res.end(PAYLOAD)
          return
        }
        res.writeHead(404)
        res.end()
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

  it('resumes from the partial file via Range and returns the total bytes', async () => {
    const target = join(dir, 'out.bin')
    // Simulate an interrupted first attempt: 8 bytes already on disk.
    writeFileSync(target, PAYLOAD.slice(0, 8))
    const stats = await downloadToFile(`${baseUrl}/resume`, target, 2)
    expect(rangeHits).toBe(1)
    expect(stats.bytes).toBe(PAYLOAD.length)
    expect(readFileSync(target, 'utf8')).toBe(PAYLOAD)
  })

  it('restarts from scratch when the server ignores Range', async () => {
    const target = join(dir, 'out.bin')
    writeFileSync(target, 'stale-partial-garbage')
    const stats = await downloadToFile(`${baseUrl}/no-range`, target, 2)
    expect(stats.bytes).toBe(PAYLOAD.length)
    expect(readFileSync(target, 'utf8')).toBe(PAYLOAD)
  })
})
