import { describe, expect, test } from 'vitest'
import { parseChord, chordFromEvent, chordsMatch, formatChord } from './keybindings'

/** Minimal stand-in for the fields chordFromEvent reads. */
function ev(over: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  } as KeyboardEvent
}

describe('parseChord', () => {
  test('parses a single key', () => {
    expect(parseChord('p')).toEqual({ key: 'p', meta: false, ctrl: false, shift: false, alt: false })
  })

  test('parses modifiers in any order', () => {
    expect(parseChord('shift+cmd+p')).toEqual(parseChord('cmd+shift+p'))
  })

  test('treats mod as cmd on darwin and ctrl elsewhere', () => {
    expect(parseChord('mod+p', 'darwin')).toMatchObject({ meta: true, ctrl: false })
    expect(parseChord('mod+p', 'win32')).toMatchObject({ meta: false, ctrl: true })
  })

  test('lowercases the key so shift does not change identity', () => {
    // The old hand-rolled checks needed `key === 'b' || key === 'B'`; the chord
    // carries shift separately so the key stays stable.
    expect(parseChord('cmd+shift+B')!.key).toBe('b')
  })

  test('keeps named keys intact', () => {
    expect(parseChord('cmd+ArrowDown')!.key).toBe('arrowdown')
    expect(parseChord('Escape')!.key).toBe('escape')
  })

  test('accepts aliases for the same modifier', () => {
    expect(parseChord('meta+p')).toEqual(parseChord('cmd+p'))
    expect(parseChord('control+p')).toEqual(parseChord('ctrl+p'))
    expect(parseChord('option+p')).toEqual(parseChord('alt+p'))
  })

  test('returns null for an empty or modifier-only chord', () => {
    expect(parseChord('')).toBeNull()
    expect(parseChord('cmd+')).toBeNull()
    expect(parseChord('cmd+shift')).toBeNull()
  })
})

describe('chordFromEvent', () => {
  test('reads modifiers off the event', () => {
    expect(chordFromEvent(ev({ key: 'p', metaKey: true }))).toEqual({
      key: 'p',
      meta: true,
      ctrl: false,
      shift: false,
      alt: false,
    })
  })

  test('normalises a shifted letter to its lowercase key', () => {
    // Browsers report 'B' when shift is held; the chord must still be 'b'.
    expect(chordFromEvent(ev({ key: 'B', metaKey: true, shiftKey: true }))).toMatchObject({
      key: 'b',
      shift: true,
    })
  })
})

describe('chordsMatch', () => {
  test('matches an identical chord', () => {
    expect(chordsMatch(parseChord('cmd+p')!, chordFromEvent(ev({ key: 'p', metaKey: true })))).toBe(
      true
    )
  })

  test('does not match when an extra modifier is held', () => {
    // ⌘⇧P must not fire a binding registered for ⌘P.
    const held = chordFromEvent(ev({ key: 'P', metaKey: true, shiftKey: true }))

    expect(chordsMatch(parseChord('cmd+p')!, held)).toBe(false)
  })

  test('does not match when a required modifier is missing', () => {
    expect(chordsMatch(parseChord('cmd+p')!, chordFromEvent(ev({ key: 'p' })))).toBe(false)
  })

  test('distinguishes cmd from ctrl', () => {
    expect(chordsMatch(parseChord('cmd+p')!, chordFromEvent(ev({ key: 'p', ctrlKey: true })))).toBe(
      false
    )
  })
})

describe('formatChord', () => {
  test('renders mac symbols', () => {
    expect(formatChord(parseChord('cmd+shift+p')!, 'darwin')).toBe('⇧⌘P')
  })

  test('renders spelled-out modifiers elsewhere', () => {
    expect(formatChord(parseChord('ctrl+shift+p')!, 'win32')).toBe('Ctrl+Shift+P')
  })

  test('renders named keys readably', () => {
    expect(formatChord(parseChord('cmd+ArrowDown')!, 'darwin')).toBe('⌘ArrowDown')
  })
})
