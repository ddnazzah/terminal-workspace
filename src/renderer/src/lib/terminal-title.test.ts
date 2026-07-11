import { describe, expect, it } from 'vitest'
import { resolveDisplayTitle, stripSpinner } from './terminal-title'

const payload = (title: string | null, isAgent: boolean) => ({ title, isAgent })

describe('stripSpinner', () => {
  it('strips the spinner glyph and separators', () => {
    expect(stripSpinner('✳ · Fixing the login bug')).toBe('Fixing the login bug')
    expect(stripSpinner('⠹ Refactoring the parser')).toBe('Refactoring the parser')
  })

  it('leaves undecorated titles untouched', () => {
    expect(stripSpinner('zsh — ~/Workspace')).toBe('zsh — ~/Workspace')
  })
})

describe('resolveDisplayTitle', () => {
  it('shows a busy agent task title, stripped', () => {
    expect(resolveDisplayTitle(payload('✳ Fixing the login bug', true))).toBe(
      'Fixing the login bug'
    )
    expect(resolveDisplayTitle(payload('⠹ Refactoring the parser', true))).toBe(
      'Refactoring the parser'
    )
  })

  it('hides agent idle branding so the persisted task name shows between turns', () => {
    expect(resolveDisplayTitle(payload('✳ Claude Code', true))).toBe('')
    expect(resolveDisplayTitle(payload('Claude Code', true))).toBe('')
  })

  it('hides shell titles arriving under sticky agent mode (agent exited or crashed)', () => {
    expect(resolveDisplayTitle(payload('zsh — ~/Workspace', true))).toBe('')
  })

  it('shows plain shell-tab titles unchanged', () => {
    expect(resolveDisplayTitle(payload('zsh — ~/Workspace', false))).toBe('zsh — ~/Workspace')
  })

  it('clears on a null title', () => {
    expect(resolveDisplayTitle(payload(null, true))).toBe('')
    expect(resolveDisplayTitle(payload(null, false))).toBe('')
  })
})
