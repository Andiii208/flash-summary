import './style.css'
import { APP_TITLE } from '../shared/types'

interface SeuSummaryBridge {
  getAppInfo: () => Promise<{ name: string; version: string; platform: string }>
  ping: (message: string) => Promise<{ ok: boolean; pong: string }>
}

const bridge = (window as unknown as { seuSummary?: SeuSummaryBridge }).seuSummary

async function boot(): Promise<void> {
  const app = document.getElementById('app')
  if (!app) return

  let status = 'main process bridge not available'
  if (bridge) {
    const info = await bridge.getAppInfo()
    const echo = await bridge.ping('phase0')
    status = `${info.name} v${info.version} on ${info.platform} — ${echo.pong}`
  }

  app.innerHTML = `
    <main class="shell">
      <h1>${APP_TITLE}</h1>
      <p>Electron + TypeScript scaffold is running.</p>
      <p id="status">${status}</p>
    </main>
  `
}

void boot()
