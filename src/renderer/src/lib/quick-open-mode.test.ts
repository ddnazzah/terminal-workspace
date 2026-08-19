import { describe, expect, test } from 'vitest'
import { parseQuickOpenQuery } from './quick-open-mode'

describe('parseQuickOpenQuery', () => {
  test('plain text searches files', () => {
    expect(parseQuickOpenQuery('app.tsx')).toEqual({ mode: 'files', term: 'app.tsx' })
  })

  test('an empty query is still file mode', () => {
    expect(parseQuickOpenQuery('')).toEqual({ mode: 'files', term: '' })
  })

  test('> switches to commands', () => {
    expect(parseQuickOpenQuery('>toggle panel')).toEqual({
      mode: 'commands',
      term: 'toggle panel',
    })
  })

  test('> alone lists every command', () => {
    expect(parseQuickOpenQuery('>')).toEqual({ mode: 'commands', term: '' })
  })

  test(': goes to a line', () => {
    expect(parseQuickOpenQuery(':42')).toEqual({ mode: 'line', term: '42', line: 42 })
  })

  test(': with a column', () => {
    expect(parseQuickOpenQuery(':42:8')).toMatchObject({ mode: 'line', line: 42, column: 8 })
  })

  test(': alone has no line yet', () => {
    expect(parseQuickOpenQuery(':')).toEqual({ mode: 'line', term: '', line: null })
  })

  test(': with non-numeric input yields no line rather than NaN', () => {
    const parsed = parseQuickOpenQuery(':abc')

    expect(parsed.mode).toBe('line')
    expect(parsed.line).toBeNull()
  })

  test('ignores whitespace around the term', () => {
    expect(parseQuickOpenQuery('>  toggle  ')).toEqual({ mode: 'commands', term: 'toggle' })
  })

  test('a prefix later in the string is not a prefix', () => {
    // Searching for a file called 'a>b' must stay in file mode.
    expect(parseQuickOpenQuery('a>b')).toEqual({ mode: 'files', term: 'a>b' })
  })

  test('a file path containing a colon stays in file mode', () => {
    expect(parseQuickOpenQuery('src/a:b.ts')).toEqual({ mode: 'files', term: 'src/a:b.ts' })
  })

  test('clamps a non-positive line to 1', () => {
    // Editors are 1-based; line 0 would be rejected downstream.
    expect(parseQuickOpenQuery(':0')).toMatchObject({ line: 1 })
  })
})
