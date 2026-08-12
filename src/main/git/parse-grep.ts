import type { SearchHit } from '@shared/types'

export type { SearchHit }

/**
 * Parse `git grep -n --column -I -z` output.
 *
 * Each record is `path\0line\0column\0text\n`. The `-z` form is used
 * deliberately: with the default `path:line:column:text` a path or a matched
 * line containing a colon — a URL, a Windows path, a TypeScript type
 * annotation — is impossible to split correctly.
 *
 * A record that does not have the three NUL-separated fields is skipped rather
 * than throwing, so one odd line cannot lose an entire result set.
 */
export function parseGrepOutput(stdout: string): SearchHit[] {
  const hits: SearchHit[] = []

  for (const record of stdout.split('\n')) {
    if (record === '') continue

    // Only the first three NULs are separators; anything after belongs to the
    // matched text, which may itself contain a NUL.
    const first = record.indexOf('\0')
    if (first === -1) continue
    const second = record.indexOf('\0', first + 1)
    if (second === -1) continue
    const third = record.indexOf('\0', second + 1)
    if (third === -1) continue

    const line = Number.parseInt(record.slice(first + 1, second), 10)
    const column = Number.parseInt(record.slice(second + 1, third), 10)
    if (!Number.isFinite(line) || !Number.isFinite(column)) continue

    hits.push({
      path: record.slice(0, first),
      line,
      column,
      text: record.slice(third + 1),
    })
  }

  return hits
}
