import { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as a destructive action. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A small, generic confirmation dialog. Hand-rolled overlay + card to match
 * SettingsModal rather than pulling in HeroUI's Modal. Enter confirms, Escape
 * and backdrop clicks cancel, and the confirm button takes focus on open.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    // Capture phase + stopPropagation: an xterm instance is still mounted
    // behind the dialog, and a bubbling Enter would both confirm here and be
    // written into the shell.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onConfirm, onCancel])

  // Focusing the confirm button also pulls focus out of the terminal's textarea,
  // so xterm stops receiving keystrokes while the dialog is up.
  useEffect(() => {
    if (open) confirmRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />
      <div
        role="alertdialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-2xl border border-foreground/15 bg-background shadow-2xl"
      >
        <div className="px-6 pt-6 pb-5">
          <h2 className="text-base font-semibold text-foreground tracking-tight">{title}</h2>
          <div className="mt-2 text-[13px] leading-relaxed text-foreground/65">{message}</div>
        </div>
        <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-foreground/10">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-[13px] text-foreground/70 hover:text-foreground hover:bg-foreground/10 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={[
              'px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              danger
                ? 'bg-red-500/90 text-white hover:bg-red-500 focus-visible:ring-red-500/60'
                : 'bg-foreground/85 text-background hover:bg-foreground focus-visible:ring-foreground/50',
            ].join(' ')}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
