/**
 * PPT × 关键帧融合的真实代码路径验证（批1，plan 2026-09-17 验收项）。
 *
 * 为什么要造素材：真实库 `ppt_pages = 0`（平台 PPT 接口对该用户的课程一直返回空），
 * 所以「用关键帧给 PPT 反推时间」这条路径**没有任何真实数据可验**。
 *
 * 造法刻意贴近现实：把某张关键帧的 JPEG 解码后另存为 PNG，当作「平台 PPT 页」——
 * 现实中两路拍的就是同一块屏幕，所以画面本就应当几乎相同。
 *
 * 然后**直接调 main 进程的真实取图函数** `loadSummarizeInputs`（不需要模型调用），
 * 检查：①撞图的关键帧被判冗余不再发送 ②PPT 页拿到 `at` 且 `atInferred === true`
 * ③不撞图的关键帧全部保留。
 *
 *   npx vite-node scripts/note-fusion-verify.ts [--keep]
 */
import { mkdtempSync, mkdirSync, copyFileSync, cpSync, existsSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { createRequire } from 'module'
import { loadSummarizeInputs } from '../src/main/notes/summarize'
import { resolveLibraryPath, storedAttachmentsPath } from '../src/main/library/paths'

const require = createRequire(import.meta.url)
const REAL_LIBRARY = join(homedir(), 'Documents', 'SEU Summary', 'Library')
const LESSON_ID = '1690625-L0' // 17 张关键帧，足够做「撞图 + 不撞图」两类

const workDir = mkdtempSync(join(tmpdir(), 'seu-fusion-'))
const libRoot = join(workDir, 'Library')
mkdirSync(libRoot, { recursive: true })
for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
  const src = join(REAL_LIBRARY, f)
  if (existsSync(src)) copyFileSync(src, join(libRoot, f))
}
cpSync(join(REAL_LIBRARY, 'attachments'), join(libRoot, 'attachments'), { recursive: true })
console.log(`库副本: ${libRoot}`)

// main 进程侧仍走迁移（副本还没跑过 011），这里先手动补齐需要的列，
// 免得 openDatabase 之外的裸 better-sqlite3 写入失败。其实只用读，但 schema 要能解析 note。
const Database = require('better-sqlite3')
const db = new Database(join(libRoot, 'app.db'))

// 1) 造「PPT 页」：把第 3 张关键帧的 JPEG 解码后另存为 PNG（同画面 → 应当撞图）
const jpeg = require('jpeg-js')
const { PNG } = require('pngjs')
const { readFileSync } = require('fs')

const keyframes = db
  .prepare('SELECT id, file_path, timestamp_seconds FROM keyframes WHERE lesson_id = ? ORDER BY timestamp_seconds')
  .all(LESSON_ID)
if (keyframes.length < 3) throw new Error(`关键帧不足（${keyframes.length}），无法验证`)
const mimic = keyframes[2]
// 真实库里 file_path 可能是**绝对路径**（应用的 resolveLibraryPath 对绝对路径原样使用）——
// 必须走同一个解析器，否则会拼出双层路径。
const mimicAbs = resolveLibraryPath(libRoot, mimic.file_path)
const decoded = jpeg.decode(readFileSync(mimicAbs), { useTArray: true })
const png = new PNG({ width: decoded.width, height: decoded.height })
png.data = Buffer.from(decoded.data)
const pptDir = join(libRoot, 'attachments', LESSON_ID, 'ppt')
mkdirSync(pptDir, { recursive: true })
const pptRel = storedAttachmentsPath(LESSON_ID, 'ppt', 'page-000.png')
writeFileSync(resolveLibraryPath(libRoot, pptRel), PNG.sync.write(png))
db.prepare('INSERT OR REPLACE INTO ppt_pages (id, lesson_id, page_index, file_path, created_at) VALUES (?, ?, ?, ?, ?)').run(
  `${LESSON_ID}-ppt-0`,
  LESSON_ID,
  0,
  pptRel,
  new Date().toISOString()
)
console.log(`注入 PPT 页 ppt:0（画面 = 关键帧 ${mimic.id} @${Math.round(mimic.timestamp_seconds)}s，本应撞图）`)

// 2) 走真实取图路径
const inputs = loadSummarizeInputs(db, LESSON_ID, libRoot)
if ('error' in inputs) throw new Error(`loadSummarizeInputs 失败: ${inputs.error}`)

const pptImages = inputs.images.filter((i) => i.ref.startsWith('ppt:'))
const kfImages = inputs.images.filter((i) => i.ref.startsWith('kf:'))
console.log(`\n取图结果：共 ${inputs.images.length} 张（PPT ${pptImages.length} / 关键帧 ${kfImages.length}，预算内）`)
for (const img of inputs.images) {
  console.log(`  ${img.ref.padEnd(18)} at=${img.at == null ? 'null' : img.at}  atInferred=${img.atInferred === true}`)
}

const ppt0 = inputs.images.find((i) => i.ref === 'ppt:0')
const mimicKfRef = `kf:${mimic.id}`
const mimicSent = inputs.images.some((i) => i.ref === mimicKfRef)

const checks = [
  ['PPT 页被发送', ppt0 != null],
  ['PPT 页拿到了时间', ppt0?.at != null],
  ['该时间被标记为**推断值**（不冒充实测）', ppt0?.atInferred === true],
  ['推断时间与撞图关键帧一致', ppt0?.at === Math.round(mimic.timestamp_seconds)],
  ['撞图的关键帧被判冗余、不再发送', mimicSent === false],
  ['不撞图的关键帧仍保留（板书/演示不会被误删）', kfImages.length === keyframes.length - 1]
]

console.log('\n—— 判定 ——')
let failed = 0
for (const [label, pass] of checks) {
  if (pass !== true) failed += 1
  console.log(`  ${pass === true ? '✅' : '❌'} ${label}`)
}
console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项未通过`}`)
db.close()

if (process.argv.includes('--keep')) console.log(`\n副本保留：${libRoot}`)
else rmSync(workDir, { recursive: true, force: true })
if (failed > 0) process.exitCode = 1
