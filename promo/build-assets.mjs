/**
 * 宣发宣传动画 · 备料：把真实 UI 截图 / 图标 / 讲义页转成 promo/assets/ 下的 JPEG。
 * 采集宽 = 舞台 CSS 宽 × 4/3（渲染窗口 2560×1440 超采样，最后降回 1080p）。
 *
 *   node promo/build-assets.mjs
 *
 * 前置（采集都在 .zcode/ 下一次性脚本里完成，gitignored）：
 *   .ui-shots/promo/*.png       # 真实课程库 UI 截图（v3 轮 reshot，标题栏那一行
 *                               # 同时有登录态药丸，一律裁 y<86）
 *   .ui-shots/promo/handout.pdf # 真实课程库导出的 26 页讲义（和截图同课）
 *
 * v6 起素材全部来自**真实课程库**（v4/v5 的合成演示案例被否：画面素、没看头）。
 * 三个统一处理：
 *   ① 窗口截图从 y=86 裁掉标题栏那一行（logo+面包屑+两个登录态药丸同一行；
 *      学校会话 JWT 已过期，不裁的话每一帧角上都是「已过期」）；
 *   ② 文楷子集整体拷过来——宣传片大字才能和产品 renderer 同字体；
 *   ③ 讲义页从真实课导出的 handout.pdf 栅格化（需要本机 python + pymupdf）。
 */
import { createRequire } from 'module'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, cpSync } from 'fs'

const require = createRequire(import.meta.dirname)
const ROOT = join(import.meta.dirname, '..')
const FFMPEG = require('ffmpeg-static')
const OUT = join(import.meta.dirname, 'assets')
const SHOT_SRC = join(ROOT, '.ui-shots', 'promo')
const PDF = join(SHOT_SRC, 'handout.pdf')

/**
 * [产出名, 源位图, 舞台显示宽(CSS px), 是否裁顶栏] —— 高度按原图比例；
 * 默认统一裁掉 y<86 的标题栏；第 4 参 false 表示源图已裁好（如对话框本体）。
 * v6 起素材全部来自**真实课程库**（v4/v5 的合成演示案例被否：画面素、没看头）。
 * 真实库截图在 .ui-shots/promo/（标题栏那一行同时有登录态药丸）。
 */
const SHOTS = [
  ['shot-note-hero', '03-note-detailed.png', 1180],
  ['body-detailed', '04b-note-详细笔记-1800.png', 1240],
  ['body-standard', '04b-note-标准总结-1800.png', 1120],
  ['body-points', '04b-note-要点-1800.png', 1120],
  ['body-methodology', '04b-note-方法论-1800.png', 1120],
  ['body-mindmap', '04b-note-思维导图-1800.png', 1120],
  ['shot-mindmap', '05-mindmap-panel.png', 1240, false],
  ['shot-qa', '06-qa-dock.png', 1180],
  ['shot-tasks', '01-tasks-initial.png', 1100],
  ['shot-bili', '08-bili-dialog.png', 760, false],
  ['shot-browser', '08-course-browser.png', 1180]
]

/** [产出名, PDF 页码(0 基), 说明] —— 讲义翻页镜头按这个顺序翻。 */
const PAGES = [
  ['handout-p1', 0, '封面'],
  ['handout-p2', 3, '时间线（带课堂原帧）'],
  ['handout-p3', 1, '整页知识导图']
]

/** 开场满幅用的真实课程封面（笔记 hero 里那张，匹配剪辑用）。 */
const COVER = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Documents', 'SEU Summary', 'Library', 'attachments', 'bili-BV1JXppejE8q-P2', 'cover.jpg')

const SUPER = 4 / 3
const manifest = {}
const missing = []

mkdirSync(OUT, { recursive: true })

// ② 文楷子集：产品 renderer 用的就是 lxgw-wenkai-screen-webfont（main.tsx import 它的 css）
const FONT_PKG = 'lxgw-wenkai-screen-webfont'
const FONT_SRC = join(ROOT, 'node_modules', FONT_PKG)
if (!existsSync(join(FONT_SRC, 'lxgwwenkaigbscreen.css'))) throw new Error(`${FONT_PKG} not installed`)
cpSync(FONT_SRC, join(OUT, 'wenkai'), { recursive: true })
console.log(`font  ${FONT_PKG} -> assets/wenkai/`)

function fromShot(name, src, cssWidth, trim = true) {
  const source = join(SHOT_SRC, src)
  if (!existsSync(source)) { missing.push(source); return }
  const px = Math.round(cssWidth * SUPER)
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', source,
    '-vf', trim ? `crop=iw:ih-86:0:86,scale=${px}:-1:flags=lanczos` : `scale=${px}:-1:flags=lanczos`,
    '-q:v', '3', join(OUT, `${name}.jpg`)
  ])
  manifest[name] = { source: `.ui-shots/promo/${src}`, cssWidth, trimTopPx: trim ? 86 : 0 }
  console.log(`asset ${name}.jpg <- .ui-shots/promo/${src} (${cssWidth} css${trim ? '' : ', no-trim'})`)
}

// 真实课程封面：S1 第一拍以「封面卡」呈现（845 CSS = 源 1126px 的 1:1 清晰宽）。
// 曾经这里是 scale=2560 满幅开场——1126×717 的源放大 1.7 倍，大字发虚边缘发糊，
// 正是「位图放大=丑陋」的实证；v7 起封面绝不大于源分辨率。
if (!existsSync(COVER)) { missing.push(COVER) } else {
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', COVER,
    '-vf', 'scale=1127:-1:flags=lanczos', '-q:v', '3', join(OUT, 'cover-opening.jpg')
  ])
  manifest['cover-opening.jpg'] = { source: '真实课程封面（1126×717，1:1 不放大）', cssWidth: 845 }
  console.log('asset cover-opening.jpg <- 真实课程封面（845 css，1:1）')
}

// ③ 图标：直接解 ico
execFileSync(FFMPEG, [
  '-y', '-hide_banner', '-loglevel', 'error', '-i', join(ROOT, 'build', 'icon.ico'),
  '-vf', 'scale=512:512:flags=lanczos', '-q:v', '3', join(OUT, 'icon.jpg')
])
manifest.icon = { source: 'build/icon.ico', cssWidth: 512 / SUPER }
console.log('asset icon.jpg <- build/icon.ico')

// ③ 讲义页：每次都从 PDF 重新栅格化——PNG 只是中间产物，缓存它会让换了 PDF
// 之后翻页镜头还在播旧课（v6 就踩过：seed 的 8 页讲义残留覆盖了真实库 26 页）
for (const [name, page, note] of PAGES) {
  const png = join(OUT, `${name}.png`)
  if (!existsSync(PDF)) { missing.push(PDF); continue }
  execFileSync('python', ['-c', `import pymupdf; d = pymupdf.open(r'${PDF}'); d[${page}].get_pixmap(dpi=180).save(r'${png}')`])
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', png,
    '-vf', 'scale=933:1320:flags=lanczos', '-q:v', '3', join(OUT, `${name}.jpg`)
  ])
  manifest[name] = { source: `handout.pdf p.${page + 1}（${note}）`, cssWidth: 933 / SUPER }
  console.log(`asset ${name}.jpg <- handout.pdf p.${page + 1}（${note}）`)
}

for (const [name, src, cssWidth, trim = true] of SHOTS) fromShot(name, src, cssWidth, trim)

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
if (missing.length > 0) {
  throw new Error(`missing sources:\n  ${missing.join('\n')}\n截图与 handout.pdf 要放到 .ui-shots/promo/（采集脚本是一次性的，见文件头注释）`)
}
console.log(`\n${Object.keys(manifest).length} assets -> ${OUT}`)
