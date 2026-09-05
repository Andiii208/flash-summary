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
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error): void {
    try {
      const bridge = (window as unknown as { seuSummary?: { log: { rendererError(message: string): void } } }).seuSummary
      bridge?.log.rendererError(`[${this.props.area}] render error: ${error.message}`)
    } catch {
      // The bridge itself failing must not loop the crash.
    }
  }

  render(): JSX.Element {
    if (this.state.error == null) return <>{this.props.children}</>
    return (
      <div class="error-boundary" role="alert" data-testid={`error-boundary-${this.props.area}`}>
        <h3>界面出错了</h3>
        <p>
          {this.props.area}渲染时发生异常：{this.state.error.message}
        </p>
        <button
          class="btn"
          onClick={() => {
            this.setState({ error: null })
            window.location.reload()
          }}
        >
          重新加载
        </button>
      </div>
    )
  }
}
