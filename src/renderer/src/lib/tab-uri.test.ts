import { describe, expect, it } from 'vitest'
import { BOARD_TAB_PATH, NOTES_TAB_PATH, isVirtualTab, noteTabPath, parseTabPath } from './tab-uri'

describe('parseTabPath', () => {
  it('recognises the board tab', () => {
    expect(parseTabPath(BOARD_TAB_PATH)).toEqual({ kind: 'board' })
  })

  it('recognises a note tab and extracts its id', () => {
    expect(parseTabPath(noteTabPath('abc-123'))).toEqual({ kind: 'note', noteId: 'abc-123' })
  })

  it('treats an ordinary path as a file', () => {
    expect(parseTabPath('src/main/index.ts')).toEqual({ kind: 'file', path: 'src/main/index.ts' })
  })

  it('recognises the notes list tab as a note tab with nothing selected', () => {
    expect(parseTabPath(NOTES_TAB_PATH)).toEqual({ kind: 'note', noteId: null })
  })

  it('treats a note URI with no id as a file rather than a broken note', () => {
    expect(parseTabPath('wterm://note/')).toEqual({ kind: 'file', path: 'wterm://note/' })
  })

  it('does not mistake a file whose name merely contains the scheme', () => {
    expect(parseTabPath('docs/wterm://board.md')).toEqual({
      kind: 'file',
      path: 'docs/wterm://board.md',
    })
  })
})

describe('isVirtualTab', () => {
  it('is true for board and note tabs', () => {
    expect(isVirtualTab(BOARD_TAB_PATH)).toBe(true)
    expect(isVirtualTab(NOTES_TAB_PATH)).toBe(true)
    expect(isVirtualTab(noteTabPath('n1'))).toBe(true)
  })

  it('is false for real files', () => {
    expect(isVirtualTab('README.md')).toBe(false)
  })
})
