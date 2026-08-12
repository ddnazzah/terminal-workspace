import { describe, expect, test } from 'vitest'
import { parseGrepOutput } from './parse-grep'

/** `git grep -n --column -I -z` emits path\0line\0column\0text\n per hit. */
function hit(path: string, line: number, column: number, text: string): string {
  return `${path}\0${line}\0${column}\0${text}\n`
}

describe('parseGrepOutput', () => {
  test('parses a single hit', () => {
    const out = parseGrepOutput(hit('src/a.ts', 12, 5, 'const x = 1'))

    expect(out).toEqual([{ path: 'src/a.ts', line: 12, column: 5, text: 'const x = 1' }])
  })

  test('parses several hits', () => {
    const out = parseGrepOutput(hit('a.ts', 1, 1, 'one') + hit('b.ts', 2, 3, 'two'))

    expect(out.map((h) => h.path)).toEqual(['a.ts', 'b.ts'])
  })

  test('keeps a path containing colons intact', () => {
    // The -z form is used precisely so a colon in a path cannot be mistaken
    // for the line-number separator.
    const out = parseGrepOutput(hit('weird:name/file.ts', 3, 1, 'x'))

    expect(out[0].path).toBe('weird:name/file.ts')
  })

  test('keeps colons inside the matched text', () => {
    const out = parseGrepOutput(hit('a.ts', 1, 1, 'const url = "http://x"'))

    expect(out[0].text).toBe('const url = "http://x"')
  })

  test('preserves leading whitespace in the matched line', () => {
    // Indentation matters for reading a result in context.
    expect(parseGrepOutput(hit('a.ts', 1, 3, '    indented'))[0].text).toBe('    indented')
  })

  test('returns an empty list for empty output', () => {
    expect(parseGrepOutput('')).toEqual([])
  })

  test('skips a malformed record rather than throwing', () => {
    const out = parseGrepOutput('garbage-with-no-nuls\n' + hit('a.ts', 1, 1, 'ok'))

    expect(out).toEqual([{ path: 'a.ts', line: 1, column: 1, text: 'ok' }])
  })

  test('handles a line of text that itself contains a newline-free NUL run', () => {
    // Defensive: extra NULs in the text must not shift the field mapping.
    const out = parseGrepOutput(hit('a.ts', 7, 2, 'has\0nul'))

    expect(out[0]).toMatchObject({ path: 'a.ts', line: 7, column: 2 })
  })
})
