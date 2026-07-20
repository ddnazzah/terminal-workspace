import { describe, expect, test } from 'vitest'
import { resolveRelease, resolveResize, type SizeState } from './resize-authority'

const desktopOwned: SizeState = { desktopSize: { cols: 150, rows: 40 }, bridgeOwned: false }

describe('resolveResize', () => {
  test('applies a desktop resize when no phone owns the size', () => {
    const { next, applied } = resolveResize(desktopOwned, 120, 30, 'desktop')
    expect(applied).toEqual({ cols: 120, rows: 30 })
    expect(next).toEqual({ desktopSize: { cols: 120, rows: 30 }, bridgeOwned: false })
  })

  test('a phone resize takes authority and its size is applied', () => {
    const { next, applied } = resolveResize(desktopOwned, 40, 24, 'bridge')
    expect(applied).toEqual({ cols: 40, rows: 24 })
    expect(next).toEqual({ desktopSize: { cols: 150, rows: 40 }, bridgeOwned: true })
  })

  test('a desktop resize while a phone owns is remembered but NOT applied', () => {
    const phoneOwned: SizeState = { desktopSize: { cols: 150, rows: 40 }, bridgeOwned: true }
    const { next, applied } = resolveResize(phoneOwned, 100, 50, 'desktop')
    expect(applied).toBeNull()
    // desktop's new size is stored for restoration; phone keeps authority
    expect(next).toEqual({ desktopSize: { cols: 100, rows: 50 }, bridgeOwned: true })
  })

  test('clamps zero and fractional dimensions to a valid PTY size', () => {
    const { applied } = resolveResize(desktopOwned, 0, 23.9, 'bridge')
    expect(applied).toEqual({ cols: 1, rows: 23 })
  })
})

describe('resolveRelease', () => {
  test('restores the desktop size when a phone releases authority', () => {
    const phoneOwned: SizeState = { desktopSize: { cols: 150, rows: 40 }, bridgeOwned: true }
    const { next, applied } = resolveRelease(phoneOwned)
    expect(applied).toEqual({ cols: 150, rows: 40 })
    expect(next.bridgeOwned).toBe(false)
  })

  test('restores the LATEST desktop size recorded while the phone owned it', () => {
    // phone owns; desktop resized to 100x50 meanwhile (remembered, not applied)
    const afterDesktopResize = resolveResize(
      { desktopSize: { cols: 150, rows: 40 }, bridgeOwned: true },
      100,
      50,
      'desktop'
    ).next
    const { applied } = resolveRelease(afterDesktopResize)
    expect(applied).toEqual({ cols: 100, rows: 50 })
  })

  test('is a no-op when the desktop already owns the size', () => {
    const { next, applied } = resolveRelease(desktopOwned)
    expect(applied).toBeNull()
    expect(next).toBe(desktopOwned)
  })
})
