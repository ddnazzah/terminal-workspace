/** What the quick-open palette is currently searching. */
export type QuickOpenMode = 'files' | 'commands' | 'line'

export interface QuickOpenQuery {
  mode: QuickOpenMode
  /** The query with any prefix stripped and trimmed. */
  term: string
  /** 1-based line, when in line mode and one was typed. */
  line?: number | null
  /** 1-based column, when one was typed after the line. */
  column?: number
}

/**
 * Split a quick-open query into a mode and a term, following VS Code's
 * prefixes: `>` searches commands, `:` jumps to a line, anything else searches
 * files.
 *
 * The prefix only counts at position 0 — a file named `a>b` or a path
 * containing a colon must keep searching files rather than silently switching
 * mode mid-typing.
 */
export function parseQuickOpenQuery(raw: string): QuickOpenQuery {
  if (raw.startsWith('>')) {
    return { mode: 'commands', term: raw.slice(1).trim() }
  }

  if (raw.startsWith(':')) {
    const term = raw.slice(1).trim()
    // `:42:8` — line then optional column.
    const [lineText, columnText] = term.split(':')
    const line = Number.parseInt(lineText ?? '', 10)
    const column = Number.parseInt(columnText ?? '', 10)

    return {
      mode: 'line',
      term,
      // Editors are 1-based, so a 0 or negative line is clamped rather than
      // passed through to be rejected downstream.
      line: Number.isFinite(line) ? Math.max(1, line) : null,
      ...(Number.isFinite(column) ? { column: Math.max(1, column) } : {}),
    }
  }

  return { mode: 'files', term: raw }
}
