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

const POLL_INTERVAL_MS = 1500

/** Default page selection: the requested P, or every page when there are few. */
function defaultSelection(preview: BilibiliResolveResult): number[] {
  if (preview.requestedPage != null) return [preview.requestedPage]
  if (preview.pages.length <= 5) return preview.pages.map((p) => p.page)
  return [preview.pages[0]?.page ?? 1]
}

function togglePage(selected: number[], page: number): number[] {
  return selected.includes(page) ? selected.filter((p) => p !== page) : [...selected, page].sort((a, b) => a - b)
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
    toast(`已导入 ${res.value.lessonIds.length} 个分P`, 'success')
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
        if (poll.value.status === 'expired' || poll.value.status === 'inactive') {
          setQrStatus('二维码已过期，请重新点击「扫码登录」')
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

  return (
    <details class="manual-fallback bili-import">
      <summary>B站视频导入</summary>
      <div class="bili-row">
        <input
          class="qa-input"
          value={input}
          placeholder="粘贴 B站视频链接或 BV 号"
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
          <div class="bili-title" title={preview.title}>
            {preview.title}
          </div>
          <div class="bili-pages">
            {preview.pages.map((p) => (
              <label key={p.page} class="bili-page">
                <input
                  type="checkbox"
                  checked={preview.selected.includes(p.page)}
                  onChange={() => setPreview({ ...preview, selected: togglePage(preview.selected, p.page) })}
                />
                {p.part !== '' ? p.part : `P${p.page}`}
              </label>
            ))}
          </div>
          <button class="btn small" disabled={busy} onClick={onImportClick}>
            {sessionState === 'logged_in' ? '导入并生成笔记' : '扫码登录后导入'}
          </button>
        </div>
      )}
      {loginPhase === 'qr' && (
        <div class="bili-qr">
          {qrImage != null && <img src={qrImage} alt="B站登录二维码" width={160} height={160} />}
          <div class="bili-qr-status">{qrStatus}</div>
        </div>
      )}
    </details>
  )
}

function statusLabel(status: string): string {
  if (status === 'confirmed') return '登录成功'
  if (status === 'scanned') return '已扫码，请在手机上确认'
  if (status === 'expired') return '二维码已过期'
  if (status === 'inactive') return '请重新点击扫码登录'
  return '等待扫码…'
}
