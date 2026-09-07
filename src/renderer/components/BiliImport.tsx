import { useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import QRCode from 'qrcode'
import type { BilibiliResolveResult, SeuSummaryBridge } from '../../shared/bridge'

export interface BiliImportProps {
  bridge: SeuSummaryBridge
  onImported: (courseId: string, lessonIds: string[]) => void
  toast: (message: string, kind?: 'info' | 'error' | 'success') => void
}

interface PreviewState extends BilibiliResolveResult {
  selected: number[]
}

type LoginPhase = 'idle' | 'qr' | 'confirmed'

const POLL_INTERVAL_MS = 2000 // official login page cadence (~2s)

/** Default page selection: the requested P, or every page when there are few. */
function defaultSelection(preview: BilibiliResolveResult): number[] {
  if (preview.requestedPage != null) return [preview.requestedPage]
  if (preview.pages.length <= 5) return preview.pages.map((p) => p.page)
  return [preview.pages[0]?.page ?? 1]
}

function togglePage(selected: number[], page: number): number[] {
  return selected.includes(page) ? selected.filter((p) => p !== page) : [...selected, page].sort((a, b) => a - b)
}

/** Rough study-time estimate for the selected pages («约 N 分钟»). */
function totalMinutes(preview: PreviewState): number {
  const seconds = preview.pages
    .filter((p) => preview.selected.includes(p.page))
    .reduce((sum, p) => sum + p.duration, 0)
  return Math.max(1, Math.round(seconds / 60))
}

/** Monogram fallback: first meaningful character (skip decorative punctuation like «【»). */
function monogram(title: string): string {
  const match = /[0-9A-Za-z\u4e00-\u9fff]/.exec(title)
  return match?.[0] ?? title.slice(0, 1)
}

/** UP line: the real name when present, mid as fallback (names over numbers). */
function upLabel(preview: PreviewState): string {
  if (preview.upName != null && preview.upName !== '') return `UP ${preview.upName}`
  if (preview.upMid != null) return `UP ${preview.upMid}`
  return ''
}

function statusLabel(status: string): string {
  if (status === 'confirmed') return '登录成功'
  if (status === 'scanned') return '已扫码，请在手机上确认'
  if (status === 'expired') return '二维码已过期，请重新点击「扫码登录」'
  if (status === 'inactive') return '请重新点击「扫码登录」'
  return '等待扫码…'
}

/** Sidebar «B站导入» panel (plan 2026-09-06 M5): resolve → pick pages → QR login if needed → import. */
export function BiliImport({ bridge, onImported, toast }: BiliImportProps): JSX.Element {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [busy, setBusy] = useState(false)
  const [sessionState, setSessionState] = useState<'logged_in' | 'logged_out' | null>(null)
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [qrStatus, setQrStatus] = useState<string>('')
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('idle')
  const pendingPages = useRef<number[] | null>(null)

  useEffect(() => {
    void bridge.bilibili.session().then((res) => {
      if (res.ok) setSessionState(res.value?.state ?? 'logged_out')
    })
  }, [bridge])

  const resolve = async (): Promise<void> => {
    if (input.trim() === '' || busy) return
    setBusy(true)
    const res = await bridge.bilibili.resolve(input.trim())
    setBusy(false)
    if (!res.ok || res.value == null) {
      toast(res.error ?? '解析失败', 'error')
      return
    }
    setPreview({ ...res.value, selected: defaultSelection(res.value) })
  }

  const doImport = async (pages: number[]): Promise<void> => {
    if (preview == null) return
    setBusy(true)
    const res = await bridge.bilibili.import({ bvid: preview.bvid, pages })
    setBusy(false)
    if (!res.ok || res.value == null) {
      toast(res.error ?? '导入失败', 'error')
      return
    }
    toast(`已导入 ${res.value.lessonIds.length} 个分P，任务已排队`, 'success')
    setPreview(null)
    setInput('')
    onImported(res.value.courseId, res.value.lessonIds)
  }

  // QR login polling: one effect owns the interval so unmount / re-scan
  // cannot leave a dangling timer hammering the passport endpoint.
  useEffect(() => {
    if (loginPhase !== 'qr') return
    let cancelled = false
    const interval = setInterval(() => {
      void (async () => {
        const poll = await bridge.bilibili.loginStatus()
        if (cancelled || !poll.ok || poll.value == null) return
        setQrStatus(statusLabel(poll.value.status))
        if (poll.value.status === 'confirmed') {
          setLoginPhase('confirmed')
          setQrImage(null)
          setSessionState('logged_in')
          const pending = pendingPages.current
          pendingPages.current = null
          if (pending != null && pending.length > 0) void doImport(pending)
        }
      })()
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  })

  const startLoginFlow = async (): Promise<void> => {
    setBusy(true)
    const res = await bridge.bilibili.login()
    setBusy(false)
    if (!res.ok || res.value == null) {
      toast(res.error ?? '无法开始扫码登录', 'error')
      return
    }
    setLoginPhase('qr')
    setQrStatus('等待扫码…')
    try {
      const dataUrl = await QRCode.toDataURL(res.value.qrUrl, { margin: 1, width: 180 })
      setQrImage(dataUrl)
    } catch {
      setQrStatus('二维码渲染失败，但登录轮询仍在进行，请用手机App确认')
    }
  }

  const onImportClick = (): void => {
    if (preview == null || busy) return
    if (preview.selected.length === 0) {
      toast('请至少选择一个分P', 'error')
      return
    }
    if (sessionState === 'logged_in') {
      void doImport(preview.selected)
      return
    }
    pendingPages.current = preview.selected
    void startLoginFlow()
  }

  const pageCount = preview?.pages.length ?? 0
  const manyPages = pageCount > 5

  return (
    <details class="manual-fallback bili-import">
      <summary>B站视频导入</summary>
      <div class="bili-row">
        <input
          class="qa-input"
          value={input}
          placeholder="粘贴视频链接或 BV 号"
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void resolve()
          }}
        />
        <button class="btn small" disabled={busy} onClick={() => void resolve()}>
          解析
        </button>
      </div>
      {preview != null && (
        <div class="bili-preview">
          <div class="bili-head">
            {preview.coverDataUrl != null ? (
              <img class="bili-cover" src={preview.coverDataUrl} alt="" width={72} height={45} />
            ) : (
              <div class="bili-cover bili-cover-fallback" aria-hidden="true">
                {monogram(preview.title)}
              </div>
            )}
            <div class="bili-head-text">
              <div class="bili-title">{preview.title}</div>
              <div class="bili-meta">
                共 {pageCount} 个分P{upLabel(preview) !== '' ? ` · ${upLabel(preview)}` : ''}
              </div>
            </div>
          </div>
          <div class="bili-pages" role="group" aria-label="选择要导入的分P">
            {preview.pages.map((p) => {
              const active = preview.selected.includes(p.page)
              return (
                <button
                  key={p.page}
                  type="button"
                  class={`bili-chip${active ? ' active' : ''}`}
                  aria-pressed={active}
                  title={p.part !== '' ? p.part : `P${p.page}`}
                  onClick={() => setPreview({ ...preview, selected: togglePage(preview.selected, p.page) })}
                >
                  {p.part !== '' ? p.part : `P${p.page}`}
                </button>
              )
            })}
          </div>
          {manyPages && (
            <div class="bili-pages-tools">
              <button class="btn small ghost" onClick={() => setPreview({ ...preview, selected: preview.pages.map((p) => p.page) })}>
                全选
              </button>
              <button class="btn small ghost" onClick={() => setPreview({ ...preview, selected: [] })}>
                清空
              </button>
              <span class="bili-meta bili-selected-note">
                已选 {preview.selected.length}/{pageCount} · 约 {totalMinutes(preview)} 分钟
              </span>
            </div>
          )}
          <button class="btn small primary bili-import-btn" disabled={busy || preview.selected.length === 0} onClick={onImportClick}>
            {sessionState === 'logged_in' ? '导入并生成笔记' : '扫码登录后导入'}
          </button>
        </div>
      )}
      {loginPhase === 'qr' && (
        <div class="bili-qr">
          {qrImage != null && <img src={qrImage} alt="B站登录二维码" width={160} height={160} />}
          <div class="bili-qr-hint">使用B站App「扫一扫」登录</div>
          <div class="bili-qr-status">{qrStatus}</div>
        </div>
      )}
    </details>
  )
}
