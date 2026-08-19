// A single PTY is shared by the desktop window and any connected phone. They
// have very different widths, and a full-screen program can only render for one
// size at a time. To keep the phone usable, a phone that is actively viewing a
// terminal becomes the *size authority*: its dimensions drive the PTY so the
// program repaints for the phone. The desktop's last size is remembered and
// restored when the phone stops viewing. This module holds that decision as
// pure functions so the policy is testable without spawning a PTY.

/** Which client asked for a resize; a phone (`bridge`) outranks the desktop. */
export type ResizeSource = 'desktop' | 'bridge'

export interface TerminalSize {
  cols: number
  rows: number
}

export interface SizeState {
  /** Last size the desktop requested (restored when a phone releases). */
  desktopSize: TerminalSize
  /** Whether a phone currently owns the size. */
  bridgeOwned: boolean
  /**
   * Size the PTY currently has. A resize to these same dimensions is dropped:
   * `ioctl(TIOCSWINSZ)` raises SIGWINCH even when nothing changed, and the
   * foreground program repaints — which on a phone yanks the view off wherever
   * the user had scrolled to. Null until the first resize is applied.
   */
  appliedSize: TerminalSize | null
}

export interface ResizeOutcome {
  /** The authority state after the request. */
  next: SizeState
  /** Size to push to the PTY, or null to leave it unchanged. */
  applied: TerminalSize | null
}

/** Clamp to a valid PTY size (node-pty rejects zero/fractional dimensions). */
function normalize(cols: number, rows: number): TerminalSize {
  return { cols: Math.max(1, Math.floor(cols)), rows: Math.max(1, Math.floor(rows)) }
}

function isSameSize(a: TerminalSize | null | undefined, b: TerminalSize): boolean {
  return !!a && a.cols === b.cols && a.rows === b.rows
}

/**
 * Resolve a resize request against the current authority.
 * - A desktop resize is always recorded, but only applied when no phone owns
 *   the size — otherwise it's kept for later restoration.
 * - A phone (bridge) resize takes authority and its size wins immediately.
 */
export function resolveResize(
  state: SizeState,
  cols: number,
  rows: number,
  source: ResizeSource
): ResizeOutcome {
  const size = normalize(cols, rows)
  if (source === 'desktop') {
    // The desktop's request is always recorded, but only reaches the PTY when
    // no phone owns the size and the dimensions actually differ.
    const applied = state.bridgeOwned || isSameSize(state.appliedSize, size) ? null : size
    return {
      next: {
        desktopSize: size,
        bridgeOwned: state.bridgeOwned,
        appliedSize: applied ?? state.appliedSize,
      },
      applied,
    }
  }
  // A phone takes authority even when its size matches what the PTY already
  // has — but an unchanged size must not be re-applied (see `appliedSize`).
  const applied = isSameSize(state.appliedSize, size) ? null : size
  return {
    next: {
      desktopSize: state.desktopSize,
      bridgeOwned: true,
      appliedSize: applied ?? state.appliedSize,
    },
    applied,
  }
}

/**
 * Resolve the last phone leaving a terminal: hand authority back to the desktop
 * and restore its remembered size. A no-op when no phone owned the size.
 */
export function resolveRelease(state: SizeState): ResizeOutcome {
  if (!state.bridgeOwned) return { next: state, applied: null }
  // Nothing to restore when the phone was already running at the desktop's size.
  const applied = isSameSize(state.appliedSize, state.desktopSize) ? null : state.desktopSize
  return {
    next: {
      desktopSize: state.desktopSize,
      bridgeOwned: false,
      appliedSize: applied ?? state.appliedSize,
    },
    applied,
  }
}
