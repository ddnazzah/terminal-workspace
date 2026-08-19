import { describe, expect, test } from 'vitest'
import { decideExternalChange } from './external-change'

describe('decideExternalChange', () => {
  test('ignores a change whose content matches what we already have', () => {
    // Our own save fires the watcher; the disk now matches what we wrote, so
    // there is nothing external about it.
    const action = decideExternalChange({
      onDisk: 'hello',
      saved: 'hello',
      current: 'hello',
    })

    expect(action).toBe('ignore')
  })

  test('ignores our own save even while the tab has newer edits', () => {
    // Saved 'a', disk is 'a', user has typed on to 'ab'. The disk change is
    // ours — warning here would be a false conflict on every keystroke-save.
    expect(
      decideExternalChange({ onDisk: 'a', saved: 'a', current: 'ab' })
    ).toBe('ignore')
  })

  test('reloads when the tab has no unsaved edits', () => {
    expect(
      decideExternalChange({ onDisk: 'new', saved: 'old', current: 'old' })
    ).toBe('reload')
  })

  test('flags a conflict when the tab has unsaved edits', () => {
    // Both sides moved — the user's edits must not be silently discarded.
    expect(
      decideExternalChange({ onDisk: 'theirs', saved: 'base', current: 'mine' })
    ).toBe('conflict')
  })

  test('reloads when the user typed and then undid back to the saved text', () => {
    // current === saved means nothing is at risk, even though it was edited.
    expect(
      decideExternalChange({ onDisk: 'new', saved: 'old', current: 'old' })
    ).toBe('reload')
  })

  test('ignores when disk matches the in-editor text exactly', () => {
    // Someone else wrote precisely what the user has — nothing to reconcile.
    expect(
      decideExternalChange({ onDisk: 'same', saved: 'old', current: 'same' })
    ).toBe('ignore')
  })

  test('handles a file emptied on disk', () => {
    expect(decideExternalChange({ onDisk: '', saved: 'old', current: 'old' })).toBe('reload')
  })

  test('treats a deleted file as a conflict when there are unsaved edits', () => {
    expect(
      decideExternalChange({ onDisk: null, saved: 'base', current: 'mine' })
    ).toBe('conflict')
  })

  test('reports deletion when the tab is clean', () => {
    expect(decideExternalChange({ onDisk: null, saved: 'base', current: 'base' })).toBe('deleted')
  })
})
