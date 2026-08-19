/** Longest card title derived from a note before truncation. */
const TITLE_MAX = 120

/**
 * Derive a card title when promoting a note: its first markdown heading, else
 * its first non-empty line, else the note's own title.
 */
export function titleFromNote(note: { title: string; body: string }): string {
  const lines = note.body.split('\n').map((line) => line.trim())

  const heading = lines.find((line) => /^#{1,6}\s+\S/.test(line))
  if (heading) return heading.replace(/^#{1,6}\s+/, '').slice(0, TITLE_MAX)

  const firstLine = lines.find((line) => line.length > 0)
  return (firstLine ?? note.title).slice(0, TITLE_MAX)
}
