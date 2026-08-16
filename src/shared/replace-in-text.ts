export interface ReplaceOptions {
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}

export interface ReplaceResult {
  /** The rewritten text, or the original when nothing matched or the pattern was invalid. */
  text: string
  /** How many occurrences were replaced. */
  count: number
  /** Set when the pattern could not be compiled; `text` is then unchanged. */
  error?: string
}

/** Escape a string so it matches literally inside a RegExp. */
function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Escape `$` in a replacement so JS substitution patterns ($&, $1, $') are
 * inserted verbatim. Only applied for literal searches — with regex on, those
 * patterns are exactly what the user is asking for.
 */
function escapeReplacement(value: string): string {
  return value.replace(/\$/g, '$$$$')
}

/**
 * Replace every occurrence of `search` in `text`.
 *
 * An invalid regex returns the input unchanged with an `error` rather than
 * throwing — the search box is typed into character by character, so a
 * half-written pattern is the normal state, not an exceptional one, and
 * throwing here would risk writing a blank file.
 */
export function replaceInText(
  text: string,
  search: string,
  replacement: string,
  options: ReplaceOptions
): ReplaceResult {
  if (search === '') {
    return { text, count: 0 }
  }

  let source = options.regex ? search : escapeLiteral(search)
  if (options.wholeWord) {
    source = `\\b(?:${source})\\b`
  }

  let pattern: RegExp
  try {
    pattern = new RegExp(source, options.caseSensitive ? 'g' : 'gi')
  } catch (err) {
    return { text, count: 0, error: err instanceof Error ? err.message : String(err) }
  }

  const applied = options.regex ? replacement : escapeReplacement(replacement)

  // Count first, then replace with the string form so JS handles $1/$&
  // substitution natively. A callback would give the count directly but would
  // also suppress substitution patterns, which regex mode needs.
  const count = text.match(pattern)?.length ?? 0
  if (count === 0) {
    return { text, count: 0 }
  }

  // String.replace scans the original once; the output is never re-scanned, so
  // a replacement containing the search term cannot loop.
  return { text: text.replace(pattern, applied), count }
}
