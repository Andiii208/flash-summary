/**
 * 声明批2（plan 2026-09-11 compliance-disclosure）: first-run «使用须知与免责声明» gate.
 *
 * Blocking by design — the only exits are «同意并继续» (disabled until the box is
 * ticked) and «退出应用» (a real quit, not a «稍后再说»). Escape is disabled and
 * focus does not land on the exit action, so a stray Enter cannot quit the app.
 *
 * The clauses are the shared condensed text in src/shared/disclaimer.ts; the
 * authoritative full text is DISCLAIMER.md, reachable any time from Settings.
 * Mounted CONDITIONALLY by App, so the tick resets on every re-prompt.
 */
import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { Dialog } from '../ui/Dialog'
import {
  DISCLAIMER_CONSENT_CHECK_LABEL,
  DISCLAIMER_CONSENT_CLAUSES,
  DISCLAIMER_CONSENT_CONFIRM_LABEL,
  DISCLAIMER_CONSENT_EXIT_LABEL,
  DISCLAIMER_CONSENT_FOOTNOTE,
  DISCLAIMER_CONSENT_PROMPT,
  DISCLAIMER_TITLE
} from '../../shared/disclaimer'

export function ConsentDialog({ onAccept, onExit }: { onAccept: () => void; onExit: () => void }): JSX.Element {
  const [agreed, setAgreed] = useState(false)
  return (
    <Dialog
      open
      title={DISCLAIMER_TITLE}
      message={DISCLAIMER_CONSENT_PROMPT}
      confirmLabel={DISCLAIMER_CONSENT_CONFIRM_LABEL}
      cancelLabel={DISCLAIMER_CONSENT_EXIT_LABEL}
      persistent
      confirmDisabled={!agreed}
      onConfirm={onAccept}
      onCancel={onExit}
    >
      <div class="consent-body" data-testid="consent-clauses">
        {DISCLAIMER_CONSENT_CLAUSES.map((clause) => (
          <p class="consent-clause" key={clause.heading}>
            <strong>{clause.heading}</strong>
            <span>{clause.text}</span>
          </p>
        ))}
      </div>
      <label class="dialog-check">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed((event.target as HTMLInputElement).checked)}
        />
        {DISCLAIMER_CONSENT_CHECK_LABEL}
      </label>
      <p class="consent-footnote">{DISCLAIMER_CONSENT_FOOTNOTE}</p>
    </Dialog>
  )
}
