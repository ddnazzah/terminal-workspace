import { describe, expect, test } from 'vitest'
import { nextSelection, type SelectionState } from './file-tree-selection'

const ROWS = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']

function state(paths: readonly string[], anchor: string | null): SelectionState {
  return { selection: new Set(paths), anchor }
}

const plain = { meta: false, shift: false }
const meta = { meta: true, shift: false }
const shift = { meta: false, shift: true }

describe('nextSelection — plain click', () => {
  test('replaces the whole selection and moves the anchor', () => {
    // Arrange
    const current = state(['a.ts', 'b.ts'], 'a.ts')

    // Act
    const next = nextSelection(ROWS, current, 'd.ts', plain)

    // Assert
    expect([...next.selection]).toEqual(['d.ts'])
    expect(next.anchor).toBe('d.ts')
  })

  test('collapses a multi-selection down to the clicked row', () => {
    const current = state(['a.ts', 'b.ts', 'c.ts'], 'a.ts')

    expect([...nextSelection(ROWS, current, 'b.ts', plain).selection]).toEqual(['b.ts'])
  })
})

describe('nextSelection — cmd/ctrl click', () => {
  test('adds an unselected row without clearing the rest', () => {
    const current = state(['a.ts'], 'a.ts')

    const next = nextSelection(ROWS, current, 'c.ts', meta)

    expect([...next.selection].sort()).toEqual(['a.ts', 'c.ts'])
    expect(next.anchor).toBe('c.ts')
  })

  test('removes an already-selected row', () => {
    const current = state(['a.ts', 'c.ts'], 'a.ts')

    expect([...nextSelection(ROWS, current, 'c.ts', meta).selection]).toEqual(['a.ts'])
  })

  test('keeps the anchor on the toggled row even when deselecting', () => {
    const current = state(['a.ts', 'c.ts'], 'a.ts')

    expect(nextSelection(ROWS, current, 'c.ts', meta).anchor).toBe('c.ts')
  })
})

describe('nextSelection — shift click', () => {
  test('selects the inclusive range from the anchor downward', () => {
    const current = state(['b.ts'], 'b.ts')

    const next = nextSelection(ROWS, current, 'd.ts', shift)

    expect([...next.selection]).toEqual(['b.ts', 'c.ts', 'd.ts'])
  })

  test('selects the inclusive range from the anchor upward', () => {
    const current = state(['d.ts'], 'd.ts')

    expect([...nextSelection(ROWS, current, 'b.ts', shift).selection]).toEqual([
      'b.ts',
      'c.ts',
      'd.ts',
    ])
  })

  test('keeps the anchor fixed so the range can be resized', () => {
    const current = state(['b.ts'], 'b.ts')

    const widened = nextSelection(ROWS, current, 'd.ts', shift)
    const narrowed = nextSelection(ROWS, widened, 'c.ts', shift)

    expect(narrowed.anchor).toBe('b.ts')
    expect([...narrowed.selection]).toEqual(['b.ts', 'c.ts'])
  })

  test('falls back to a single selection when there is no anchor', () => {
    const current = state([], null)

    const next = nextSelection(ROWS, current, 'c.ts', shift)

    expect([...next.selection]).toEqual(['c.ts'])
    expect(next.anchor).toBe('c.ts')
  })

  test('falls back to a single selection when the anchor is no longer visible', () => {
    // The anchor's folder was collapsed, so it is gone from the visible rows.
    const current = state(['hidden.ts'], 'hidden.ts')

    expect([...nextSelection(ROWS, current, 'c.ts', shift).selection]).toEqual(['c.ts'])
  })

  test('ignores a click on a row that is not visible', () => {
    const current = state(['b.ts'], 'b.ts')

    const next = nextSelection(ROWS, current, 'gone.ts', shift)

    expect([...next.selection]).toEqual(['gone.ts'])
    expect(next.anchor).toBe('gone.ts')
  })
})
