import { render } from 'preact'
import './app.css'
import './style.css'
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
