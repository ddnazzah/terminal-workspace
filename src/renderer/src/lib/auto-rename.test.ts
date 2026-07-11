import { describe, expect, it } from 'vitest'
import type { SessionActivityPayload, TerminalRecord } from '@shared/types'
import { resolveAutoRename } from './auto-rename'

const payload = (overrides: Partial<SessionActivityPayload> = {}): SessionActivityPayload => ({
  id: 't1',
  status: 'busy',
  title: '✳ Fixing the login bug',
  exitCode: null,
  isAgent: true,
  ...overrides,
})

const terminal = (overrides: Partial<TerminalRecord> = {}): TerminalRecord => ({
  id: 't1',
  name: 'Terminal 1',
  shell: '/bin/zsh',
  ...overrides,
})

describe('resolveAutoRename', () => {
  it('returns the stripped task title for a busy agent', () => {
    expect(resolveAutoRename(payload(), terminal())).toBe('Fixing the login bug')
  })

  it('accepts braille-spinner work titles', () => {
    expect(resolveAutoRename(payload({ title: '⠹ Refactoring the parser' }), terminal())).toBe(
      'Refactoring the parser'
    )
  })

  it('ignores plain shell titles', () => {
    expect(
      resolveAutoRename(payload({ isAgent: false, title: 'zsh — ~/Workspace' }), terminal())
    ).toBeNull()
  })

  it('ignores shell titles arriving with stale agent/busy flags (post-crash)', () => {
    // Agent mode is sticky in the ActivityMachine: after an agent dies mid-task,
    // shell prompt titles still arrive isAgent+busy. They lack the work prefix.
    expect(
      resolveAutoRename(payload({ title: 'zsh — ~/Workspace' }), terminal())
    ).toBeNull()
  })

  it('ignores idle/attention agent titles (branding, not a task)', () => {
    expect(
      resolveAutoRename(payload({ status: 'attention', title: '✳ Claude Code' }), terminal())
    ).toBeNull()
    expect(
      resolveAutoRename(payload({ status: 'idle', title: '✳ Claude Code' }), terminal())
    ).toBeNull()
  })

  it('never touches a user-renamed terminal', () => {
    expect(resolveAutoRename(payload(), terminal({ nameSource: 'user' }))).toBeNull()
  })

  it('renames a terminal whose nameSource was reset to auto', () => {
    expect(resolveAutoRename(payload(), terminal({ nameSource: 'auto' }))).toBe(
      'Fixing the login bug'
    )
  })

  it('skips when the title matches the current name (dedupe)', () => {
    expect(
      resolveAutoRename(payload(), terminal({ name: 'Fixing the login bug' }))
    ).toBeNull()
  })

  it('skips null or spinner-only titles', () => {
    expect(resolveAutoRename(payload({ title: null }), terminal())).toBeNull()
    expect(resolveAutoRename(payload({ title: '✳ ·' }), terminal())).toBeNull()
  })

  it('skips when the terminal record is missing', () => {
    expect(resolveAutoRename(payload(), undefined)).toBeNull()
  })
})
