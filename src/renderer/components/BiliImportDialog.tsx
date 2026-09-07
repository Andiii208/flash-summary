import { useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import QRCode from 'qrcode'
import type { BilibiliResolveResult, SeuSummaryBridge } from '../../shared/bridge'

export interface BiliImportDialogProps {
  bridge: SeuSummaryBridge
  open: boolean
  /** App-owned session state (TopBar badge reads the same value). */
  sessionState: 'logged_in' | 'logged_out' | null
  /** Re-read bridge.bilibili.session — called on open and after QR confirm. */
  onSessionRefresh: () => void
  onLogout: () => void
  onImported: (courseId: string, lessonIds: string[]) => void
  onClose: () => void
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

/**
 * 批1 双源并列（plan 2026-09-07）：B站导入从侧栏底部折叠面板升格为一级
 * 对话框——与东大「刷新课程」同层的入口，解析→选分P→扫码登录→导入全程
 * 在对话框内完成；二维码放大到 220px，B站账号行常显登录状态。
 */
export function BiliImportDialog({ bridge, open, sessionState, onSessionRefresh, onLogout, onImported, onClose, toast }: BiliImportDialogProps): JSX.Element | null {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [busy, setBusy] = useState(false)
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [qrStatus, setQrStatus] = useState<string>('')
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('idle')
  const pendingPages = useRef<number[] | null>(null)

  // A fresh resolve/import surface per open: a stale preview from a previous
  // session must not survive into the next one. onSessionRefresh is a stable
  // useCallback in App — only `open` may re-trigger this reset.
  useEffect(() => {
    if (open) {
      setPreview(null)
      setInput('')
      setLoginPhase('idle')
      setQrImage(null)
      setQrStatus('')
      onSessionRefresh()
    }
  }, [open])

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
    setPreview(null)
    setInput('')
    onImported(res.value.courseId, res.value.lessonIds)
    onClose()
  }

  // QR login polling: one effect owns the interval so unmount / close /
  // re-scan cannot leave a dangling timer hammering the passport endpoint.
  useEffect(() => {
    if (!open || loginPhase !== 'qr') return
    let cancelled = false
    const interval = setInterval(() => {
      void (async () => {
        const poll = await bridge.bilibili.loginStatus()
        if (cancelled || !poll.ok || poll.value == null) return
        setQrStatus(statusLabel(poll.value.status))
        if (poll.value.status === 'confirmed') {
          setLoginPhase('confirmed')
          setQrImage(null)
          onSessionRefresh()
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

  // Esc closes — same convention as Dialog/CourseMapDialog (批3 统一).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

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
      const dataUrl = await QRCode.toDataURL(res.value.qrUrl, { margin: 1, width: 220 })
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

  if (!open) return null
  const pageCount = preview?.pages.length ?? 0
  const manyPages = pageCount > 5
  const loggedIn = sessionState === 'logged_in'
  return (
    <div
      class="bili-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="导入B站视频"
      data-testid="bili-import-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div class="bili-dialog-card">
        <div class="bili-dialog-head">
          <h2>导入 B站视频</h2>
          <button class="btn small" onClick={onClose} aria-label="关闭导入对话框">
            关闭
          </button>
        </div>
        <p class="bili-dialog-hint">粘贴视频或合集链接（BV 号 / b23.tv 短链均可），解析后选择要生成笔记的分P。</p>
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
          </div>
        )}
        <div class="bili-account" data-testid="bili-account-row">
          <span class={`session-badge bili ${loggedIn ? 'logged_in' : 'logged_out'}`}>
            <span class="badge-dot" />
            B站·{loggedIn ? '已登录' : '未登录'}
          </span>
          {loggedIn && (
            <button class="btn small ghost" onClick={onLogout}>
              退出登录
            </button>
          )}
        </div>
        <button class="btn primary bili-import-btn" disabled={busy || preview == null || preview.selected.length === 0} onClick={onImportClick}>
          {loggedIn ? '导入并生成笔记' : '扫码登录后导入'}
        </button>
        {loginPhase === 'qr' && (
          <div class="bili-qr">
            {qrImage != null && <img src={qrImage} alt="B站登录二维码" width={220} height={220} />}
            <div class="bili-qr-hint">使用B站App「扫一扫」登录，确认后自动继续导入</div>
            <div class="bili-qr-status">{qrStatus}</div>
          </div>
        )}
      </div>
    </div>
  )
}
