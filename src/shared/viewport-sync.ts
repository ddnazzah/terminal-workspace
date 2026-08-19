// The mobile PWA drives its layout height from `visualViewport` so the terminal
// stays above the iOS soft keyboard. That listener also fires on `scroll`, which
// iOS raises repeatedly *during a finger drag* even though nothing resized.
// Reacting to those events refits xterm and pushes a PTY resize, and an ioctl
// resize raises SIGWINCH even for identical dimensions — the foreground TUI
// repaints and the phone's view jumps back to earlier output. These predicates
// keep the sync path idempotent: only act on changes that are actually real.

export interface TerminalSize {
  cols: number
  rows: number
}

/**
 * Height differences at or below this are treated as noise. iOS reports
 * fractional heights that wobble by a fraction of a pixel during a gesture, and
 * a change this small can never alter the fitted row count anyway.
 */
export const VIEWPORT_HEIGHT_EPSILON_PX = 1

/**
 * Whether a new `visualViewport.height` reading is a real layout change (the
 * soft keyboard opening or closing) rather than mid-gesture jitter.
 */
export function hasViewportHeightChanged(previous: number | null, next: number): boolean {
  if (previous === null) return true
  return Math.abs(next - previous) > VIEWPORT_HEIGHT_EPSILON_PX
}

/** Whether a fitted grid differs from the last size pushed to the PTY. */
export function shouldSendResize(lastSent: TerminalSize | null, next: TerminalSize): boolean {
  if (!lastSent) return true
  return lastSent.cols !== next.cols || lastSent.rows !== next.rows
}
