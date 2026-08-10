import { describe, expect, test } from 'vitest'
import { resolveBinding, type CommandBinding } from './commands'
import { parseChord } from './keybindings'

const bindings: CommandBinding[] = [
  { command: 'workbench.togglePanel', chord: 'mod+j' },
  { command: 'workbench.quickOpen', chord: 'mod+p' },
  { command: 'workbench.closeEditor', chord: 'mod+w', when: 'editorFocus' },
  { command: 'terminal.close', chord: 'mod+w', when: 'terminalFocus' },
]

const chord = (spec: string) => parseChord(spec, 'darwin')!

describe('resolveBinding', () => {
  test('finds the command for an unambiguous chord', () => {
    expect(resolveBinding(bindings, chord('cmd+j'), new Set(), 'darwin')).toBe(
      'workbench.togglePanel'
    )
  })

  test('returns null when nothing is bound', () => {
    expect(resolveBinding(bindings, chord('cmd+k'), new Set(), 'darwin')).toBeNull()
  })

  test('picks the binding whose when-context is active', () => {
    // ⌘W is bound twice; the active context decides which one wins.
    expect(resolveBinding(bindings, chord('cmd+w'), new Set(['editorFocus']), 'darwin')).toBe(
      'workbench.closeEditor'
    )
    expect(resolveBinding(bindings, chord('cmd+w'), new Set(['terminalFocus']), 'darwin')).toBe(
      'terminal.close'
    )
  })

  test('ignores a contextual binding when its context is inactive', () => {
    expect(resolveBinding(bindings, chord('cmd+w'), new Set(), 'darwin')).toBeNull()
  })

  test('prefers a contextual binding over an unconditional one', () => {
    // More specific wins, as in VS Code — otherwise a global binding would
    // shadow every context-specific override of the same chord.
    const withGlobal: CommandBinding[] = [
      { command: 'global.save', chord: 'mod+s' },
      { command: 'editor.save', chord: 'mod+s', when: 'editorFocus' },
    ]

    expect(resolveBinding(withGlobal, chord('cmd+s'), new Set(['editorFocus']), 'darwin')).toBe(
      'editor.save'
    )
  })

  test('falls back to the unconditional binding when no context matches', () => {
    const withGlobal: CommandBinding[] = [
      { command: 'global.save', chord: 'mod+s' },
      { command: 'editor.save', chord: 'mod+s', when: 'editorFocus' },
    ]

    expect(resolveBinding(withGlobal, chord('cmd+s'), new Set(), 'darwin')).toBe('global.save')
  })

  test('a later binding overrides an earlier one for the same chord and context', () => {
    // User bindings are appended after defaults, so last-wins is how a rebind
    // takes effect.
    const overridden: CommandBinding[] = [
      { command: 'default.action', chord: 'mod+e' },
      { command: 'user.action', chord: 'mod+e' },
    ]

    expect(resolveBinding(overridden, chord('cmd+e'), new Set(), 'darwin')).toBe('user.action')
  })

  test('skips bindings whose chord is unparseable rather than throwing', () => {
    const broken: CommandBinding[] = [
      { command: 'bad', chord: 'cmd+' },
      { command: 'good', chord: 'mod+g' },
    ]

    expect(resolveBinding(broken, chord('cmd+g'), new Set(), 'darwin')).toBe('good')
  })

  test('resolves mod per platform', () => {
    expect(resolveBinding(bindings, parseChord('ctrl+j', 'win32')!, new Set(), 'win32')).toBe(
      'workbench.togglePanel'
    )
  })
})
