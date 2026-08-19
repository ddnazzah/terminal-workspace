import { describe, expect, test } from 'vitest'
import { mergeBindings, findConflicts, type UserBinding } from './keybinding-overrides'
import type { CommandBinding } from './commands'

const defaults: CommandBinding[] = [
  { command: 'workbench.togglePanel', chord: 'mod+j' },
  { command: 'workbench.quickOpen', chord: 'mod+p' },
  { command: 'terminal.close', chord: 'mod+w', when: 'terminalFocus' },
]

describe('mergeBindings', () => {
  test('returns the defaults when there are no overrides', () => {
    expect(mergeBindings(defaults, [])).toEqual(defaults)
  })

  test('appends overrides after the defaults so last-wins applies', () => {
    // resolveBinding takes the last match, so an override must come after.
    const merged = mergeBindings(defaults, [{ command: 'workbench.togglePanel', chord: 'mod+k' }])

    expect(merged[merged.length - 1]).toEqual({ command: 'workbench.togglePanel', chord: 'mod+k' })
  })

  test('keeps the original binding in the list', () => {
    // The default entry stays so the old chord is not silently freed for
    // another command without the user saying so.
    const merged = mergeBindings(defaults, [{ command: 'workbench.togglePanel', chord: 'mod+k' }])

    expect(merged.filter((b) => b.command === 'workbench.togglePanel')).toHaveLength(2)
  })

  test('carries the when-context through an override', () => {
    const merged = mergeBindings(defaults, [
      { command: 'terminal.close', chord: 'mod+q', when: 'terminalFocus' },
    ])

    expect(merged[merged.length - 1]).toMatchObject({ when: 'terminalFocus' })
  })

  test('an override with an empty chord unbinds the command', () => {
    const merged = mergeBindings(defaults, [{ command: 'workbench.quickOpen', chord: '' }])

    expect(merged.some((b) => b.command === 'workbench.quickOpen')).toBe(false)
  })
})

describe('findConflicts', () => {
  test('reports nothing when every chord is distinct', () => {
    expect(findConflicts(defaults, 'darwin')).toEqual([])
  })

  test('reports two commands sharing a chord in the same context', () => {
    const clashing: CommandBinding[] = [
      { command: 'a.one', chord: 'mod+k' },
      { command: 'b.two', chord: 'mod+k' },
    ]

    const conflicts = findConflicts(clashing, 'darwin')

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].commands).toEqual(['a.one', 'b.two'])
  })

  test('does not report the same chord in different contexts', () => {
    // ⌘W meaning different things per surface is the point of when-contexts.
    const scoped: CommandBinding[] = [
      { command: 'editor.close', chord: 'mod+w', when: 'editorFocus' },
      { command: 'terminal.close', chord: 'mod+w', when: 'terminalFocus' },
    ]

    expect(findConflicts(scoped, 'darwin')).toEqual([])
  })

  test('treats differently written but equivalent chords as a conflict', () => {
    // 'shift+cmd+p' and 'cmd+shift+p' are the same keystroke.
    const equivalent: CommandBinding[] = [
      { command: 'a', chord: 'shift+cmd+p' },
      { command: 'b', chord: 'cmd+shift+p' },
    ]

    expect(findConflicts(equivalent, 'darwin')).toHaveLength(1)
  })

  test('ignores unparseable chords rather than reporting them as clashes', () => {
    const broken: CommandBinding[] = [
      { command: 'a', chord: 'cmd+' },
      { command: 'b', chord: 'cmd+' },
    ]

    expect(findConflicts(broken, 'darwin')).toEqual([])
  })

  test('resolves mod per platform before comparing', () => {
    // On Windows 'mod+p' and 'ctrl+p' are the same chord.
    const equivalent: CommandBinding[] = [
      { command: 'a', chord: 'mod+p' },
      { command: 'b', chord: 'ctrl+p' },
    ]

    expect(findConflicts(equivalent, 'win32')).toHaveLength(1)
    expect(findConflicts(equivalent, 'darwin')).toEqual([])
  })
})

describe('UserBinding shape', () => {
  test('is serialisable for persistence', () => {
    const binding: UserBinding = { command: 'a', chord: 'mod+k', when: 'editorFocus' }

    expect(JSON.parse(JSON.stringify(binding))).toEqual(binding)
  })
})
