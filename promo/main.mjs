/**
 * 宣发宣传动画 · 渲染宿主：一个独立 Electron 窗口（2560×1440，DPR 钉 1）加载
 * promo/promo.html，开 remote debugging 供 scripts/promo-render.mjs 逐帧采集。
 *
 *   npx electron promo/main.mjs
 *
 * 与产品完全解耦：只为拿到一个 Chromium 表面 + 与产品同源的字体渲染。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { app, BrowserWindow } = require('electron')

// 本机 DPI 150%：不钉 1 的话窗口表面会按物理像素翻倍，采集到的就是 3840×2160。
app.commandLine.appendSwitch('force-device-scale-factor', '1')
// 采集期间窗口必须可见且非最小化：hidden/minimized 窗口视口冻结，截图是空帧
// （scripts/ui-probe.mjs 用 SW_RESTORE 解过一次，这里从根上避开）。
// 端口由启动方决定（promo-render.mjs 挑一个空闲端口传进来）——不能在这里写死，
// 写死会覆盖 CLI 参数，调用方就会去轮询一个没人监听的端口。
const portArg = process.argv.find((a) => a.startsWith('--remote-debugging-port='))
const devtoolsPort = portArg != null ? portArg.slice('--remote-debugging-port='.length) : '9571'
app.commandLine.appendSwitch('remote-debugging-port', devtoolsPort)

app.whenReady().then(() => {
  // frame:false —— 带窗框时视口被标题栏/边框吃掉（实测 2538×1358），压成
  // 1920×1080 会被横向拉伸 5%（SAR 2276:2165）。无框窗视口才是整 2560×1440。
  const win = new BrowserWindow({
    width: 2560,
    height: 1440,
    frame: false,
    show: true,
    backgroundColor: '#f5f1e6',
    webPreferences: { backgroundThrottling: false }
  })
  win.loadFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'promo.html'))
  win.on('minimize', () => win.restore())
})

app.on('window-all-closed', () => app.quit())
