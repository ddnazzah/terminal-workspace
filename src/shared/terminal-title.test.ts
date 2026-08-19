import { describe, expect, test } from 'vitest'
import { cleanTitle, stripSpinner } from './terminal-title'

describe('stripSpinner', () => {
  test('removes a leading braille spinner frame and separator', () => {
    expect(stripSpinner('⠋ · Refactoring the parser')).toBe('Refactoring the parser')
  })

  test('removes the ✳ marker prefix', () => {
    expect(stripSpinner('✳ Running tests')).toBe('Running tests')
  })

  test('removes the circle frames current Claude Code animates with', () => {
    // The regression: these are what 2.1.235 actually writes, and leaving them
    // in renders a half-black circle flickering beside the terminal name.
    expect(stripSpinner('◐ OK')).toBe('OK')
    expect(stripSpinner('◑ Exploring the codebase')).toBe('Exploring the codebase')
    expect(stripSpinner('◒ Claude Code')).toBe('Claude Code')
    expect(stripSpinner('◓ OK')).toBe('OK')
  })

  test('leaves an undecorated title untouched', () => {
    expect(stripSpinner('claude — main')).toBe('claude — main')
  })

  test('returns empty string when the title is only decoration', () => {
    expect(stripSpinner('⣿ ')).toBe('')
  })
})

describe('cleanTitle', () => {
  test('strips decoration and trims', () => {
    expect(cleanTitle('⠙ ·  Building  ')).toBe('Building')
  })

  test('collapses a decoration-only title to null so the name shows instead', () => {
    expect(cleanTitle('⠿')).toBeNull()
  })

  test('returns null for null, undefined, and empty input', () => {
    expect(cleanTitle(null)).toBeNull()
    expect(cleanTitle(undefined)).toBeNull()
    expect(cleanTitle('   ')).toBeNull()
  })

  test('passes through a plain title', () => {
    expect(cleanTitle('Terminal work')).toBe('Terminal work')
  })
})
