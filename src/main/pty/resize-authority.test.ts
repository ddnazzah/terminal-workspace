import { describe, expect, test } from 'vitest'
import { resolveRelease, resolveResize, type SizeState } from './resize-authority'

const desktopOwned: SizeState = {
  desktopSize: { cols: 150, rows: 40 },
  bridgeOwned: false,
  appliedSize: { cols: 150, rows: 40 },
}

/** Phone owns the size and the PTY is running at the phone's narrow grid. */
const phoneOwnedAt40x24: SizeState = {
  desktopSize: { cols: 150, rows: 40 },
  bridgeOwned: true,
  appliedSize: { cols: 40, rows: 24 },
}

describe('resolveResize', () => {
  test('applies a desktop resize when no phone owns the size', () => {
    const { next, applied } = resolveResize(desktopOwned, 120, 30, 'desktop')
    expect(applied).toEqual({ cols: 120, rows: 30 })
    expect(next).toEqual({
      desktopSize: { cols: 120, rows: 30 },
      bridgeOwned: false,
      appliedSize: { cols: 120, rows: 30 },
    })
  })

  test('a phone resize takes authority and its size is applied', () => {
    const { next, applied } = resolveResize(desktopOwned, 40, 24, 'bridge')
    expect(applied).toEqual({ cols: 40, rows: 24 })
    expect(next).toEqual({
      desktopSize: { cols: 150, rows: 40 },
      bridgeOwned: true,
      appliedSize: { cols: 40, rows: 24 },
    })
  })

  test('a desktop resize while a phone owns is remembered but NOT applied', () => {
    const { next, applied } = resolveResize(phoneOwnedAt40x24, 100, 50, 'desktop')
    expect(applied).toBeNull()
    // desktop's new size is stored for restoration; phone keeps authority and
    // the PTY stays at the phone's grid
    expect(next).toEqual({
      desktopSize: { cols: 100, rows: 50 },
      bridgeOwned: true,
      appliedSize: { cols: 40, rows: 24 },
    })
  })

  test('clamps zero and fractional dimensions to a valid PTY size', () => {
    const { applied } = resolveResize(desktopOwned, 0, 23.9, 'bridge')
    expect(applied).toEqual({ cols: 1, rows: 23 })
  })

  test('does not re-apply a phone resize that repeats the applied size', () => {
    // A resize that matches what the PTY already has must not reach ioctl:
    // TIOCSWINSZ raises SIGWINCH even for identical dimensions, and the
    // foreground TUI repaints, which yanks the phone's view off where it was.
    const phoneOwned: SizeState = {
      desktopSize: { cols: 150, rows: 40 },
      bridgeOwned: true,
      appliedSize: { cols: 52, rows: 30 },
    }
    const { next, applied } = resolveResize(phoneOwned, 52, 30, 'bridge')
    expect(applied).toBeNull()
    expect(next.bridgeOwned).toBe(true)
    expect(next.appliedSize).toEqual({ cols: 52, rows: 30 })
  })

  test('applies a phone resize that genuinely changes the size', () => {
    const phoneOwned: SizeState = {
      desktopSize: { cols: 150, rows: 40 },
      bridgeOwned: true,
      appliedSize: { cols: 52, rows: 30 },
    }
    const { next, applied } = resolveResize(phoneOwned, 52, 18, 'bridge')
    expect(applied).toEqual({ cols: 52, rows: 18 })
    expect(next.appliedSize).toEqual({ cols: 52, rows: 18 })
  })

  test('does not re-apply a desktop resize that repeats the applied size', () => {
    const state: SizeState = {
      desktopSize: { cols: 150, rows: 40 },
      bridgeOwned: false,
      appliedSize: { cols: 150, rows: 40 },
    }
    const { applied } = resolveResize(state, 150, 40, 'desktop')
    expect(applied).toBeNull()
  })
})

describe('resolveRelease', () => {
  test('restores the desktop size when a phone releases authority', () => {
    const { next, applied } = resolveRelease(phoneOwnedAt40x24)
    expect(applied).toEqual({ cols: 150, rows: 40 })
    expect(next.bridgeOwned).toBe(false)
    expect(next.appliedSize).toEqual({ cols: 150, rows: 40 })
  })

  test('restores the LATEST desktop size recorded while the phone owned it', () => {
    // phone owns; desktop resized to 100x50 meanwhile (remembered, not applied)
    const afterDesktopResize = resolveResize(phoneOwnedAt40x24, 100, 50, 'desktop').next
    const { applied } = resolveRelease(afterDesktopResize)
    expect(applied).toEqual({ cols: 100, rows: 50 })
  })

  test('is a no-op when the desktop already owns the size', () => {
    const { next, applied } = resolveRelease(desktopOwned)
    expect(applied).toBeNull()
    expect(next).toBe(desktopOwned)
  })

  test('does not re-apply when the desktop size is already the applied size', () => {
    // The phone never changed the size (same grid), so handing authority back
    // should not fire a pointless SIGWINCH at the desktop's program.
    const phoneOwned: SizeState = {
      desktopSize: { cols: 150, rows: 40 },
      bridgeOwned: true,
      appliedSize: { cols: 150, rows: 40 },
    }
    const { next, applied } = resolveRelease(phoneOwned)
    expect(applied).toBeNull()
    expect(next.bridgeOwned).toBe(false)
  })
})
