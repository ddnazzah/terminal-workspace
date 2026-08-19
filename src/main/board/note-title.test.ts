import { describe, expect, it } from 'vitest'
import { titleFromNote } from './note-title'

describe('titleFromNote', () => {
  it('prefers the first markdown heading', () => {
    const note = { title: 'note', body: 'intro line\n\n## Fix the resize bug\n\nmore' }

    expect(titleFromNote(note)).toBe('Fix the resize bug')
  })

  it('falls back to the first non-empty line', () => {
    expect(titleFromNote({ title: 'note', body: '\n\n  ship the board  \nrest' })).toBe(
      'ship the board'
    )
  })

  it('falls back to the note title for an empty body', () => {
    expect(titleFromNote({ title: 'Scratch', body: '   \n\n' })).toBe('Scratch')
  })

  it('ignores a hash that is not a heading', () => {
    expect(titleFromNote({ title: 'n', body: '#nothashtag\nreal line' })).toBe('#nothashtag')
  })

  it('truncates very long titles', () => {
    const long = 'x'.repeat(300)

    expect(titleFromNote({ title: 'n', body: long })).toHaveLength(120)
  })
})
