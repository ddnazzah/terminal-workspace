import { describe, expect, test } from 'vitest'
import { hasViewportHeightChanged, shouldSendResize } from './viewport-sync'

describe('hasViewportHeightChanged', () => {
  test('reports a change on the first measurement', () => {
    // Arrange
    const previous = null

    // Act
    const changed = hasViewportHeightChanged(previous, 812)

    // Assert
    expect(changed).toBe(true)
  })

  test('ignores sub-pixel jitter reported while a finger drags', () => {
    // Arrange — iOS reports fractional visualViewport heights that wobble
    // during a touch gesture even though the layout has not changed.
    const previous = 812

    // Act
    const changed = hasViewportHeightChanged(previous, 812.4)

    // Assert
    expect(changed).toBe(false)
  })

  test('ignores jitter that straddles a rounding boundary', () => {
    // Arrange
    const previous = 812

    // Act
    const changed = hasViewportHeightChanged(previous, 812.6)

    // Assert
    expect(changed).toBe(false)
  })

  test('reports a real change when the soft keyboard opens', () => {
    // Arrange
    const previous = 812

    // Act
    const changed = hasViewportHeightChanged(previous, 476)

    // Assert
    expect(changed).toBe(true)
  })

  test('reports a change when the keyboard closes again', () => {
    // Arrange
    const previous = 476

    // Act
    const changed = hasViewportHeightChanged(previous, 812)

    // Assert
    expect(changed).toBe(true)
  })
})

describe('shouldSendResize', () => {
  test('sends the first resize after attaching', () => {
    // Arrange
    const lastSent = null

    // Act
    const shouldSend = shouldSendResize(lastSent, { cols: 52, rows: 30 })

    // Assert
    expect(shouldSend).toBe(true)
  })

  test('suppresses a resize that repeats the last sent dimensions', () => {
    // Arrange — a refit that produced identical dimensions must not reach the
    // PTY: an unchanged ioctl still raises SIGWINCH and repaints the TUI.
    const lastSent = { cols: 52, rows: 30 }

    // Act
    const shouldSend = shouldSendResize(lastSent, { cols: 52, rows: 30 })

    // Assert
    expect(shouldSend).toBe(false)
  })

  test('sends when only the row count changes', () => {
    // Arrange
    const lastSent = { cols: 52, rows: 30 }

    // Act
    const shouldSend = shouldSendResize(lastSent, { cols: 52, rows: 18 })

    // Assert
    expect(shouldSend).toBe(true)
  })

  test('sends when only the column count changes', () => {
    // Arrange
    const lastSent = { cols: 52, rows: 30 }

    // Act
    const shouldSend = shouldSendResize(lastSent, { cols: 80, rows: 30 })

    // Assert
    expect(shouldSend).toBe(true)
  })
})
