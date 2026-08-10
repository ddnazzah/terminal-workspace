import { describe, expect, test } from 'vitest'
import { nextAvailableName, planPaste } from './file-tree-paste'

describe('nextAvailableName', () => {
  test('keeps the name when nothing collides', () => {
    expect(nextAvailableName('notes.md', new Set())).toBe('notes.md')
  })

  test('appends " copy" on the first collision, like Finder and VS Code', () => {
    expect(nextAvailableName('notes.md', new Set(['notes.md']))).toBe('notes copy.md')
  })

  test('numbers subsequent copies', () => {
    const existing = new Set(['notes.md', 'notes copy.md'])

    expect(nextAvailableName('notes.md', existing)).toBe('notes copy 2.md')
  })

  test('keeps counting past several copies', () => {
    const existing = new Set(['a.ts', 'a copy.ts', 'a copy 2.ts', 'a copy 3.ts'])

    expect(nextAvailableName('a.ts', existing)).toBe('a copy 4.ts')
  })

  test('preserves a multi-part extension', () => {
    // Splitting on the FIRST dot would produce "archive copy.tar.gz" -> wrong
    // stem; splitting on the last keeps the compound suffix intact.
    expect(nextAvailableName('archive.tar.gz', new Set(['archive.tar.gz']))).toBe(
      'archive.tar copy.gz'
    )
  })

  test('handles a folder with no extension', () => {
    expect(nextAvailableName('src', new Set(['src']))).toBe('src copy')
  })

  test('handles a dotfile as having no extension', () => {
    // '.gitignore' is a name, not an extension — "copy.gitignore" would be wrong.
    expect(nextAvailableName('.gitignore', new Set(['.gitignore']))).toBe('.gitignore copy')
  })
})

describe('planPaste', () => {
  test('moves each source into the destination on cut', () => {
    const plan = planPaste(['src/a.ts', 'src/b.ts'], 'dest', 'cut', new Set())

    expect(plan).toEqual([
      { from: 'src/a.ts', to: 'dest/a.ts', mode: 'move' },
      { from: 'src/b.ts', to: 'dest/b.ts', mode: 'move' },
    ])
  })

  test('copies each source into the destination on copy', () => {
    const plan = planPaste(['src/a.ts'], 'dest', 'copy', new Set())

    expect(plan).toEqual([{ from: 'src/a.ts', to: 'dest/a.ts', mode: 'copy' }])
  })

  test('renames around a collision in the destination', () => {
    const plan = planPaste(['src/a.ts'], 'dest', 'copy', new Set(['a.ts']))

    expect(plan[0].to).toBe('dest/a copy.ts')
  })

  test('avoids colliding with a name it just allocated in the same paste', () => {
    // Both sources are called a.ts; without tracking the allocation, the second
    // would be planned onto the same destination path as the first.
    const plan = planPaste(['x/a.ts', 'y/a.ts'], 'dest', 'copy', new Set())

    expect(plan.map((p) => p.to)).toEqual(['dest/a.ts', 'dest/a copy.ts'])
  })

  test('pastes into the project root', () => {
    expect(planPaste(['src/a.ts'], '', 'copy', new Set())[0].to).toBe('a.ts')
  })

  test('skips a cut that would be a no-op', () => {
    // Cutting a file and pasting it back into its own folder changes nothing.
    expect(planPaste(['src/a.ts'], 'src', 'cut', new Set(['a.ts']))).toEqual([])
  })

  test('copying into its own folder is a real duplicate, not a no-op', () => {
    expect(planPaste(['src/a.ts'], 'src', 'copy', new Set(['a.ts']))).toEqual([
      { from: 'src/a.ts', to: 'src/a copy.ts', mode: 'copy' },
    ])
  })

  test('refuses to paste a folder into its own descendant', () => {
    expect(planPaste(['src'], 'src/lib', 'cut', new Set())).toEqual([])
  })

  test('skips a descendant whose ancestor is also being pasted', () => {
    expect(planPaste(['src', 'src/a.ts'], 'dest', 'cut', new Set())).toEqual([
      { from: 'src', to: 'dest/src', mode: 'move' },
    ])
  })

  test('returns an empty plan for an empty clipboard', () => {
    expect(planPaste([], 'dest', 'copy', new Set())).toEqual([])
  })
})
