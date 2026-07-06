import type { Terminal } from '@xterm/xterm'

// xterm renders its content in `.xterm-screen`, a sibling of the scrollable
// `.xterm-viewport`. Desktop scrolls via wheel events; on touch there is no
// wheel and the screen we're dragging isn't a descendant of the viewport, so a
// native finger-drag never scrolls it. We translate vertical drags into scroll
// ourselves. The terminal area must have `touch-action: none` in CSS, otherwise
// the browser claims the gesture for page panning before these handlers run.

/**
 * Make one-finger vertical drags scroll the terminal.
 * @param sendInput sends raw bytes to the PTY (used for alt-screen apps).
 */
export function setupTouchScroll(t: Terminal, sendInput: (data: string) => void): void {
  const el = t.element
  if (!el) return

  let lastY = 0
  let startY = 0
  let accum = 0
  let active = false
  let scrolling = false

  // Pixels per row, used to convert a finger delta into whole lines.
  const cellHeight = (): number => {
    const viewport = el.querySelector('.xterm-viewport') as HTMLElement | null
    const h = viewport?.clientHeight ?? el.clientHeight
    return Math.max(1, h / Math.max(1, t.rows))
  }

  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) {
        active = false
        return
      }
      active = true
      scrolling = false
      startY = lastY = e.touches[0].clientY
      accum = 0
    },
    { passive: true }
  )

  el.addEventListener(
    'touchmove',
    (e) => {
      if (!active || e.touches.length !== 1) return
      // Own the gesture from the very first move. iOS Safari decides at gesture
      // start whether IT will pan the page; if we let the initial sub-threshold
      // moves through uncancelled, Safari grabs the gesture and scrolls the page
      // for its whole duration — even once we start cancelling later events.
      e.preventDefault() // suppress native rubber-band / page pan / text selection
      const y = e.touches[0].clientY
      // A small threshold lets a plain tap focus the terminal without scrolling.
      if (!scrolling && Math.abs(y - startY) < 8) return
      scrolling = true
      accum += lastY - y // finger up => positive => scroll toward newest output
      lastY = y
      const ch = cellHeight()
      const lines = Math.trunc(accum / ch)
      if (lines !== 0) {
        accum -= lines * ch
        scrollByLines(t, lines, sendInput)
      }
    },
    { passive: false }
  )

  el.addEventListener(
    'touchend',
    () => {
      // A tap (no scroll) focuses the terminal so the device keyboard opens.
      if (active && !scrolling) t.focus()
      active = false
      scrolling = false
    },
    { passive: true }
  )
  el.addEventListener(
    'touchcancel',
    () => {
      active = false
      scrolling = false
    },
    { passive: true }
  )
}

function scrollByLines(t: Terminal, lines: number, sendInput: (data: string) => void): void {
  if (t.buffer.active.type === 'alternate') {
    // Alt-screen apps (vim, less, man, htop) have no scrollback — forward the
    // swipe as arrow keys so the app itself scrolls.
    const n = Math.min(Math.abs(lines), 40)
    sendInput((lines > 0 ? '\x1b[B' : '\x1b[A').repeat(n))
  } else {
    t.scrollLines(lines)
  }
}
