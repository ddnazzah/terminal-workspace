import { describe, expect, test } from 'vitest'
import { replaceInText } from './replace-in-text'

const literal = { regex: false, caseSensitive: false, wholeWord: false }

describe('replaceInText — literal', () => {
  test('replaces every occurrence', () => {
    expect(replaceInText('foo bar foo', 'foo', 'baz', literal).text).toBe('baz bar baz')
  })

  test('reports how many it replaced', () => {
    expect(replaceInText('foo foo foo', 'foo', 'x', literal).count).toBe(3)
  })

  test('treats regex metacharacters literally', () => {
    // 'a.c' must not match 'abc' when regex is off.
    const out = replaceInText('abc a.c', 'a.c', 'X', literal)

    expect(out.text).toBe('abc X')
    expect(out.count).toBe(1)
  })

  test('is case insensitive by default', () => {
    expect(replaceInText('Foo foo FOO', 'foo', 'x', literal).count).toBe(3)
  })

  test('respects case sensitivity when asked', () => {
    const out = replaceInText('Foo foo', 'foo', 'x', { ...literal, caseSensitive: true })

    expect(out.text).toBe('Foo x')
  })

  test('matches whole words only when asked', () => {
    const out = replaceInText('foo foobar', 'foo', 'x', { ...literal, wholeWord: true })

    expect(out.text).toBe('x foobar')
  })

  test('leaves text untouched when nothing matches', () => {
    const out = replaceInText('hello', 'zzz', 'x', literal)

    expect(out.text).toBe('hello')
    expect(out.count).toBe(0)
  })

  test('preserves line endings', () => {
    expect(replaceInText('a\nfoo\nb', 'foo', 'x', literal).text).toBe('a\nx\nb')
  })

  test('handles a replacement containing the search term without looping', () => {
    // Replacing 'a' with 'aa' must not re-scan its own output.
    expect(replaceInText('aaa', 'a', 'aa', literal).text).toBe('aaaaaa')
  })

  test('treats $ in the replacement literally when regex is off', () => {
    // '$&' is a substitution pattern in JS replace; with a literal search it
    // must be inserted verbatim, not expanded to the match.
    expect(replaceInText('foo', 'foo', '$&bar', literal).text).toBe('$&bar')
  })
})

describe('replaceInText — regex', () => {
  const rx = { regex: true, caseSensitive: true, wholeWord: false }

  test('applies a pattern', () => {
    expect(replaceInText('a1 b2', '[a-z]\\d', 'X', rx).text).toBe('X X')
  })

  test('supports capture groups in the replacement', () => {
    expect(replaceInText('john smith', '(\\w+) (\\w+)', '$2 $1', rx).text).toBe('smith john')
  })

  test('returns the original text and a reason for an invalid pattern', () => {
    // A half-typed regex must not throw mid-keystroke or blank the file.
    const out = replaceInText('abc', '[unclosed', 'x', rx)

    expect(out.text).toBe('abc')
    expect(out.count).toBe(0)
    expect(out.error).toBeTruthy()
  })

  test('is case insensitive when asked', () => {
    const out = replaceInText('ABC', 'abc', 'x', { ...rx, caseSensitive: false })

    expect(out.text).toBe('x')
  })
})
