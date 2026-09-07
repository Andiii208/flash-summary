/**
 * Error boundary (review G2, 2026-09-05): a render exception used to white-
 * screen the whole window with only a log line. The boundary shows a human
 * recovery card (reload button) and reports to the redacted file log.
 * Mounted at the app shell AND around NoteBlocks — note JSON rendering is
 * the largest untrusted-input surface, so a broken note must not take the
 * whole app down.
 */
import { Component, type JSX } from 'preact'

interface ErrorBoundaryProps {
  /** Where the boundary sits — appears in logs and the card title. */
  area: string
  children: JSX.Element | JSX.Element[]
}

interface ErrorBoundaryState {
  error: Error | null
  /** 批6: feedback line for the copy/open-log actions. */
  note: string
}

/** Same bridge shape the log path uses (preload injects it). */
interface ErrorBridge {
  settings?: { openPath(kind: 'library' | 'cache' | 'exports' | 'logs'): Promise<unknown> }
  log?: { rendererError(message: string): void }
}

function bridgeOf(): ErrorBridge | undefined {
  return (window as unknown as { seuSummary?: ErrorBridge }).seuSummary
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, note: '' }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, note: '' }
  }

  componentDidCatch(error: Error): void {
    try {
      bridgeOf()?.log?.rendererError(`[${this.props.area}] render error: ${error.message}`)
    } catch {
      // The bridge itself failing must not loop the crash.
    }
  }

  /** 批6: the technical detail used to be card-text only — copy it verbatim
      for a bug report, and hand the user the log folder directly. */
  private copyDetails(): void {
    const error = this.state.error
    if (error == null) return
    const details = `区域：${this.props.area}\n错误：${error.message}\n堆栈：\n${error.stack ?? '（无堆栈）'}`
    void navigator.clipboard
      .writeText(details)
      .then(() => this.setState({ note: '已复制错误详情到剪贴板' }))
      .catch(() => this.setState({ note: '复制失败（剪贴板不可用）' }))
  }

  private openLogs(): void {
    void (async () => {
      const res = await bridgeOf()?.settings?.openPath('logs')
      if (res == null || (res as { ok: boolean }).ok !== true) this.setState({ note: '日志目录打开失败' })
    })()
  }

  render(): JSX.Element {
    if (this.state.error == null) return <>{this.props.children}</>
    return (
      <div class="error-boundary" role="alert" data-testid={`error-boundary-${this.props.area}`}>
        <h3>界面出错了</h3>
        <p>
          {this.props.area}渲染时发生异常：{this.state.error.message}
        </p>
        <div class="error-boundary-actions">
          <button
            class="btn"
            onClick={() => {
              this.setState({ error: null, note: '' })
              window.location.reload()
            }}
          >
            重新加载
          </button>
          <button class="btn" onClick={() => this.copyDetails()}>
            复制错误详情
          </button>
          <button class="btn" onClick={() => this.openLogs()}>
            打开日志目录
          </button>
        </div>
        {this.state.note !== '' && <p class="error-boundary-note">{this.state.note}</p>}
      </div>
    )
  }
}
