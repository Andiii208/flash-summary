/**
 * 宣发宣传动画 · 帧精确渲染器：boot promo/main.cjs（2560×1440，DPR=1）→ 等
 * promo.html 报 __promoReady → 逐帧 __setTime(t) + Page.captureScreenshot →
 * ffmpeg 降采样编码 1920×1080@30fps H.264，另出海報帧。
 *
 *   node scripts/promo-render.mjs                      # 全量：16s × 30fps = 480 帧 + 编码
 *   node scripts/promo-render.mjs --at=0.8,4.8,15.7    # 只出指定时间点的抽检帧（不编码）
 *   node scripts/promo-render.mjs --fps=24 --dur=12    # 改规格
 *
 * 帧精确的关键：promo.html 不用任何 CSS 动画/rAF，每帧状态由 t 纯函数算出，
 * 所以串行采集也能得到零抖动的时间线。
 */
import { spawn, execFileSync } from 'child_process'
import { createRequire } from 'module'
import { join } from 'path'
import { createServer } from 'http'
import { mkdirSync, writeFileSync, rmSync } from 'fs'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..')
const FFMPEG = require('ffmpeg-static')
const ELECTRON = require('electron')

const FPS = Number(argOf('--fps', '30'))
const DURATION = Number(argOf('--dur', '27'))
const ONLY_AT = argOf('--at', null)
const KEEP_FRAMES = process.argv.includes('--keep-frames')
const OUT_DIR = join(ROOT, 'promo', 'out')
const FRAMES_DIR = join(OUT_DIR, 'frames')

function argOf(flag, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`))
  return hit != null ? hit.slice(flag.length + 1) : fallback
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** JPEG 宽高（SOF 标记扫描）——采集尺寸不对就必须当场炸，不能默默拉伸成 1080p。 */
function jpegSize(buffer) {
  for (let i = 2; i < buffer.length - 9; i++) {
    if (buffer[i] !== 0xff) continue
    const marker = buffer[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buffer.readUInt16BE(i + 7), height: buffer.readUInt16BE(i + 5) }
    }
    i += 1 + buffer.readUInt16BE(i + 2)
  }
  return null
}
const EXPECT = { width: 2560, height: 1440 }

/** Minimal CDP client over the DevTools WebSocket (same shape as ui-shots.mjs). */
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id == null || !this.pending.has(msg.id)) return
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error != null) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`))
      else resolve(msg.result)
    })
  }

  send(method, params) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }))
    })
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails != null) {
      throw new Error(`evaluate threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result?.value
  }

  async shot(path, time) {
    await this.eval(`window.__setTime(${time})`)
    const { data } = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 })
    const buffer = Buffer.from(data, 'base64')
    const size = jpegSize(buffer)
    if (size == null || size.width !== EXPECT.width || size.height !== EXPECT.height) {
      throw new Error(
        `captured frame is ${size?.width ?? '?'}x${size?.height ?? '?'}, expected ${EXPECT.width}x${EXPECT.height} — ` +
          'the render window lost pixels (window frame? DPI override?) and encoding to 1080p would stretch it'
      )
    }
    writeFileSync(path, buffer)
    return path
  }
}

function findFreePort(start) {
  return new Promise((resolve) => {
    const probe = (port) => {
      const server = createServer()
      server.once('error', () => probe(port + 1))
      server.once('listening', () => server.close(() => resolve(port)))
      server.listen(port, '127.0.0.1')
    }
    probe(start)
  })
}

async function findPageTarget(port, titlePart) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const match = list.find((t) => t.type === 'page' && t.title.includes(titlePart))
      if (match != null) return match
    } catch {
      /* devtools not up yet */
    }
    await sleep(300)
  }
  throw new Error(`page target «${titlePart}» not reached on port ${port}`)
}

async function waitForReady(cdp) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if ((await cdp.eval('window.__promoReady === true')) === true) return
    await sleep(250)
  }
  throw new Error('promo.html never reported __promoReady (assets stuck?)')
}

async function connect(port) {
  const target = await findPageTarget(port, 'Flash Summary')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('WebSocket connect failed')), { once: true })
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await waitForReady(cdp)
  return cdp
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const port = await findFreePort(9571)
  const electron = spawn(ELECTRON, [join(ROOT, 'promo', 'main.mjs'), `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe']
  })
  electron.stderr.on('data', (d) => process.stderr.write(String(d).slice(0, 300)))

  try {
    const cdp = await connect(port)

    if (ONLY_AT != null) {
      for (const raw of ONLY_AT.split(',')) {
        const time = Number(raw)
        const name = `spot-${String(Math.round(time * 100)).padStart(5, '0')}.jpg`
        await cdp.shot(join(OUT_DIR, name), time)
        console.log(`spot  t=${time.toFixed(2)}s -> ${name}`)
      }
      return
    }

    mkdirSync(FRAMES_DIR, { recursive: true })
    const total = Math.round(FPS * DURATION)
    const started = Date.now()
    for (let i = 0; i < total; i++) {
      const time = i / FPS
      await cdp.shot(join(FRAMES_DIR, `f${String(i).padStart(4, '0')}.jpg`), time)
      if (i % 60 === 0) console.log(`frame ${i}/${total} (t=${time.toFixed(2)}s)`)
    }
    console.log(`captured ${total} frames in ${((Date.now() - started) / 1000).toFixed(1)}s`)

    const mp4 = join(OUT_DIR, 'promo.mp4')
    execFileSync(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-framerate', String(FPS),
      '-i', join(FRAMES_DIR, 'f%04d.jpg'),
      '-vf', 'scale=1920:1080:flags=lanczos',
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      mp4
    ])
    // 海报：尾帧品牌卡（封面图用，带名称/口号/仓库地址）+ 一张导图主视觉备选
    const POSTERS = [['poster.png', 1.6], ['poster-mindmap.png', 18.6]]
    for (const [name, at] of POSTERS) {
      execFileSync(FFMPEG, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', String(at), '-i', mp4, '-frames:v', '1', '-update', '1',
        join(OUT_DIR, name)
      ])
    }
    console.log(`\n${mp4}\n${POSTERS.map(([n]) => join(OUT_DIR, n)).join('\n')}`)

    if (!KEEP_FRAMES) rmSync(FRAMES_DIR, { recursive: true, force: true })
  } finally {
    electron.kill()
  }
}

main().catch((error) => {
  console.error(error.message ?? error)
  process.exit(1)
})
