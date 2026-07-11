import { describe, expect, it } from 'vitest'
import { applyRename } from './rename'
import type { TerminalRecord } from './types'

const record = (overrides: Partial<TerminalRecord> = {}): TerminalRecord => ({
  id: 't1',
  name: 'Terminal 1',
  shell: '/bin/zsh',
  ...overrides,
})

describe('applyRename', () => {
  it('user rename sets the name and marks it user-owned', () => {
    const next = applyRename(record(), 'My tab', 'user')

    expect(next.name).toBe('My tab')
    expect(next.nameSource).toBe('user')
  })

  it('auto rename sets the name and keeps it auto-owned', () => {
    const next = applyRename(record(), 'Fixing the login bug', 'auto')

    expect(next.name).toBe('Fixing the login bug')
    expect(next.nameSource).toBe('auto')
  })

  it('trims surrounding whitespace', () => {
    expect(applyRename(record(), '  padded  ', 'user').name).toBe('padded')
  })

  it('empty user rename keeps the name but resets ownership to auto', () => {
    const next = applyRename(record({ name: 'Kept', nameSource: 'user' }), '', 'user')

    expect(next.name).toBe('Kept')
    expect(next.nameSource).toBe('auto')
  })

  it('auto rename never overwrites a user-owned name', () => {
    const original = record({ name: 'Mine', nameSource: 'user' })
    const next = applyRename(original, 'Task title', 'auto')

    expect(next).toBe(original)
    expect(next.name).toBe('Mine')
  })

  it('identical auto rename is a same-reference no-op', () => {
    const original = record({ name: 'Kept', nameSource: 'auto' })

    expect(applyRename(original, 'Kept', 'auto')).toBe(original)
  })

  it('same-name user rename on an unowned terminal still claims ownership', () => {
    const next = applyRename(record({ name: 'Terminal 1' }), 'Terminal 1', 'user')

    expect(next.name).toBe('Terminal 1')
    expect(next.nameSource).toBe('user')
  })

  it('empty auto rename is a no-op', () => {
    const original = record({ name: 'Kept', nameSource: 'auto' })

    expect(applyRename(original, '   ', 'auto')).toBe(original)
  })

  it('does not mutate the input record', () => {
    const original = record()
    applyRename(original, 'Changed', 'user')

    expect(original.name).toBe('Terminal 1')
    expect(original.nameSource).toBeUndefined()
  })
})
