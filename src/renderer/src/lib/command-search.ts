import { fuzzyMatch } from './fuzzy-match'

/** A command as the palette shows it. */
export interface CommandDescriptor {
  id: string
  /** Grouping shown before the title, e.g. "View: Toggle Panel". */
  category: string
  title: string
}

export interface RankedCommand {
  command: CommandDescriptor
  score: number
  /** Indices in `title` that matched, for highlighting. */
  titleIndices: number[]
}

/** Title-match scores are lifted above category-only ones by this margin. */
const TITLE_PRIORITY = 1000

/**
 * Filter and rank commands for the palette.
 *
 * Both the title and the "Category: Title" form are matched, so typing
 * "terminal" finds Terminal commands even when the word is only in the
 * category. A title hit always outranks a category-only hit — otherwise a
 * command whose category happens to contain the query would sit above the one
 * the user actually named.
 *
 * An empty query lists everything alphabetically, matching VS Code.
 */
export function rankCommands(
  query: string,
  commands: readonly CommandDescriptor[]
): RankedCommand[] {
  const trimmed = query.trim()

  if (trimmed === '') {
    return [...commands]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((command) => ({ command, score: 0, titleIndices: [] }))
  }

  const ranked: RankedCommand[] = []

  for (const command of commands) {
    const onTitle = fuzzyMatch(trimmed, command.title)
    if (onTitle) {
      ranked.push({
        command,
        score: onTitle.score + TITLE_PRIORITY,
        titleIndices: onTitle.matchedIndices,
      })
      continue
    }

    // Fall back to the qualified form so the category is searchable.
    const qualified = `${command.category}: ${command.title}`
    const onQualified = fuzzyMatch(trimmed, qualified)
    if (onQualified) {
      ranked.push({ command, score: onQualified.score, titleIndices: [] })
    }
  }

  return ranked.sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title))
}
