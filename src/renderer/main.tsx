import { render } from 'preact'
// Bundled type system (paper & ink): kai display / song body / sans chrome /
// mono time. unicode-range slices load only the glyphs actually rendered.
import 'lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css'
import '@fontsource/noto-serif-sc/400.css'
import '@fontsource/noto-serif-sc/600.css'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/noto-sans-sc/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import './app.css'
import './style.css'
import './print.css'
import type { SeuSummaryBridge } from '../shared/bridge'
import { App } from './app'

const root = document.getElementById('app')
if (root == null) throw new Error('missing #app mount point')

const bridge = (window as unknown as { seuSummary?: SeuSummaryBridge }).seuSummary
if (bridge == null) {
  root.textContent = '应用桥接不可用（preload 未加载）'
  throw new Error('preload bridge unavailable')
}

render(<App bridge={bridge} />, root)
