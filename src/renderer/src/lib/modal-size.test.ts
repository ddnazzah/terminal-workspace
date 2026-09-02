import { describe, expect, test } from 'vitest'
import { modalSizeFor, clampModalSize } from './modal-size'

const laptop = { width: 1440, height: 900 }
const studio = { width: 5120, height: 2880 }
const small = { width: 1024, height: 700 }

describe('modalSizeFor — no saved size', () => {
  test('scales with the viewport instead of a fixed default', () => {
    const onLaptop = modalSizeFor(laptop, null)
    const onStudio = modalSizeFor(studio, null)

    expect(onStudio.width).toBeGreaterThan(onLaptop.width)
    expect(onStudio.height).toBeGreaterThan(onLaptop.height)
  })

  test('leaves a margin rather than filling the screen', () => {
    const size = modalSizeFor(laptop, null)

    expect(size.width).toBeLessThan(laptop.width)
    expect(size.height).toBeLessThan(laptop.height)
  })

  test('caps the width on very wide displays so lines stay readable', () => {
    // A full-width editor on a 5K panel gives absurdly long lines.
    expect(modalSizeFor(studio, null).width).toBeLessThanOrEqual(1800)
  })

  test('claims most of the screen, not just over half of it', () => {
    // Arrange / Act
    const size = modalSizeFor(laptop, null)

    // Assert — a file opened in the floating window should read like an
    // editor, not a dialog.
    expect(size.width / laptop.width).toBeGreaterThanOrEqual(0.88)
    expect(size.height / laptop.height).toBeGreaterThanOrEqual(0.88)
  })

  test('stays usable on a small screen', () => {
    const size = modalSizeFor(small, null)

    expect(size.width).toBeGreaterThanOrEqual(420)
    expect(size.height).toBeGreaterThanOrEqual(300)
  })
})

describe('modalSizeFor — saved size', () => {
  test('honours a saved size that fits', () => {
    expect(modalSizeFor(laptop, { width: 1000, height: 700 })).toEqual({
      width: 1000,
      height: 700,
    })
  })

  test('shrinks a saved size that no longer fits', () => {
    // Saved on a large display, reopened on a laptop.
    const size = modalSizeFor(laptop, { width: 4000, height: 2400 })

    expect(size.width).toBeLessThanOrEqual(laptop.width)
    expect(size.height).toBeLessThanOrEqual(laptop.height)
  })

  test('grows a saved size that is now far smaller than the screen', () => {
    // The point of the change: a 900x600 saved on a laptop should not stay
    // 900x600 after moving to a 5K display.
    const size = modalSizeFor(studio, { width: 900, height: 600 })

    expect(size.width).toBeGreaterThan(900)
  })

  test('grows a saved size left over from a smaller window', () => {
    // Arrange — 1090 wide is what a drag on a smaller window leaves behind.
    const wide = { width: 1999, height: 1254 }

    // Act
    const size = modalSizeFor(wide, { width: 1090, height: 745 })

    // Assert
    expect(size.width).toBeGreaterThan(1500)
  })

  test('does not grow a saved size that is a deliberate, reasonable choice', () => {
    // 1200 wide on a 1440 screen is clearly intentional — leave it alone.
    expect(modalSizeFor(laptop, { width: 1200, height: 800 }).width).toBe(1200)
  })

  test('ignores a corrupt saved size', () => {
    const size = modalSizeFor(laptop, { width: 0, height: -5 })

    expect(size.width).toBeGreaterThanOrEqual(420)
    expect(size.height).toBeGreaterThanOrEqual(300)
  })
})

describe('clampModalSize', () => {
  test('keeps a deliberately small size instead of growing it', () => {
    // The resize handle must not fight the user: dragging small on a big
    // display has to stick, which is why this is separate from modalSizeFor.
    expect(clampModalSize(studio, { width: 700, height: 500 })).toEqual({
      width: 700,
      height: 500,
    })
  })

  test('still clamps a size larger than the viewport', () => {
    const size = clampModalSize(laptop, { width: 9000, height: 9000 })

    expect(size.width).toBeLessThanOrEqual(laptop.width)
    expect(size.height).toBeLessThanOrEqual(laptop.height)
  })

  test('enforces the usable minimum', () => {
    expect(clampModalSize(laptop, { width: 10, height: 10 })).toEqual({
      width: 420,
      height: 300,
    })
  })
})
