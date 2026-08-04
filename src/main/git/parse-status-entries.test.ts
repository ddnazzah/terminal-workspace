import { describe, expect, test } from 'vitest'
import { parseStatusEntries } from './parse-status-entries'

/** Build NUL-separated porcelain output the way `git status --porcelain=v1 -z` emits it. */
function z(...entries: string[]): string {
  return entries.join('\0') + '\0'
}

describe('parseStatusEntries — the two axes', () => {
  test('a staged modification is index-only', () => {
    // Arrange
    const output = z('M  src/a.ts')

    // Act
    const [entry] = parseStatusEntries(output)

    // Assert
    expect(entry).toEqual({
      path: 'src/a.ts',
      index: 'modified',
      worktree: null,
      conflict: false,
    })
  })

  test('an unstaged modification is worktree-only', () => {
    expect(parseStatusEntries(z(' M src/a.ts'))[0]).toEqual({
      path: 'src/a.ts',
      index: null,
      worktree: 'modified',
      conflict: false,
    })
  })

  test('a file staged then modified again reports both axes', () => {
    // This is the case a single collapsed status cannot represent: the file
    // belongs in Staged Changes *and* Changes simultaneously.
    expect(parseStatusEntries(z('MM src/a.ts'))[0]).toEqual({
      path: 'src/a.ts',
      index: 'modified',
      worktree: 'modified',
      conflict: false,
    })
  })

  test('staged add then worktree delete reports both', () => {
    expect(parseStatusEntries(z('AD src/a.ts'))[0]).toEqual({
      path: 'src/a.ts',
      index: 'added',
      worktree: 'deleted',
      conflict: false,
    })
  })
})

describe('parseStatusEntries — untracked and deletions', () => {
  test('untracked files land on the worktree axis', () => {
    expect(parseStatusEntries(z('?? new.ts'))[0]).toEqual({
      path: 'new.ts',
      index: null,
      worktree: 'untracked',
      conflict: false,
    })
  })

  test('distinguishes a staged delete from an unstaged delete', () => {
    expect(parseStatusEntries(z('D  gone.ts'))[0]).toMatchObject({
      index: 'deleted',
      worktree: null,
    })
    expect(parseStatusEntries(z(' D gone.ts'))[0]).toMatchObject({
      index: null,
      worktree: 'deleted',
    })
  })

  test('ignores ignored entries', () => {
    expect(parseStatusEntries(z('!! dist/bundle.js'))).toEqual([])
  })
})

describe('parseStatusEntries — renames', () => {
  test('captures both paths and consumes the extra NUL field', () => {
    // Rename entries are `XY new\0old\0` — the old path is a separate field, so
    // a parser that does not consume it treats it as a bogus next entry.
    const entries = parseStatusEntries(z('R  src/new.ts', 'src/old.ts'))

    expect(entries).toEqual([
      {
        path: 'src/new.ts',
        oldPath: 'src/old.ts',
        index: 'renamed',
        worktree: null,
        conflict: false,
      },
    ])
  })

  test('a rename followed by another entry still parses the next one', () => {
    const entries = parseStatusEntries(z('R  new.ts', 'old.ts', ' M other.ts'))

    expect(entries.map((e) => e.path)).toEqual(['new.ts', 'other.ts'])
  })

  test('a staged rename with later edits reports both axes', () => {
    expect(parseStatusEntries(z('RM new.ts', 'old.ts'))[0]).toMatchObject({
      path: 'new.ts',
      oldPath: 'old.ts',
      index: 'renamed',
      worktree: 'modified',
    })
  })

  test('treats a copy like a rename', () => {
    expect(parseStatusEntries(z('C  copy.ts', 'orig.ts'))[0]).toMatchObject({
      path: 'copy.ts',
      oldPath: 'orig.ts',
    })
  })
})

describe('parseStatusEntries — merge conflicts', () => {
  test.each(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'])(
    'flags %s as a conflict',
    (code) => {
      const [entry] = parseStatusEntries(z(`${code} clash.ts`))

      expect(entry.conflict).toBe(true)
      expect(entry.path).toBe('clash.ts')
    }
  )

  test('a conflict is not also reported as an ordinary staged change', () => {
    // Conflicts belong in Merge Changes only — staging them from the normal
    // group would silently mark the conflict resolved.
    const [entry] = parseStatusEntries(z('UU clash.ts'))

    expect(entry.index).toBeNull()
    expect(entry.worktree).toBeNull()
  })
})

describe('parseStatusEntries — shape', () => {
  test('returns an empty list for empty output', () => {
    expect(parseStatusEntries('')).toEqual([])
  })

  test('preserves paths containing spaces', () => {
    expect(parseStatusEntries(z(' M my folder/a file.ts'))[0].path).toBe(
      'my folder/a file.ts'
    )
  })

  test('parses a realistic mixed status', () => {
    const entries = parseStatusEntries(
      z('M  staged.ts', ' M dirty.ts', 'MM both.ts', '?? new.ts', 'UU clash.ts')
    )

    expect(entries.map((e) => e.path)).toEqual([
      'staged.ts',
      'dirty.ts',
      'both.ts',
      'new.ts',
      'clash.ts',
    ])
  })
})
