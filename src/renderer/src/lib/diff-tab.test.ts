import { describe, expect, test } from 'vitest'
import { encodeDiffTab, decodeDiffTab, isDiffTab } from './diff-tab'

describe('diff tab encoding', () => {
  test('round-trips a descriptor', () => {
    // Arrange
    const descriptor = { repoRel: 'packages/api', group: 'staged' as const, path: 'src/a.ts', status: 'modified' as const, isUntracked: false }

    // Act
    const encoded = encodeDiffTab(descriptor)

    // Assert
    expect(decodeDiffTab(encoded)).toEqual(descriptor)
  })

  test('round-trips an empty repoRel (project root)', () => {
    const descriptor = { repoRel: '', group: 'changes' as const, path: 'README.md', status: 'modified' as const, isUntracked: false }

    expect(decodeDiffTab(encodeDiffTab(descriptor))).toEqual(descriptor)
  })

  test('survives a path containing colons', () => {
    // A naive `split(":")` scheme loses everything after the first colon.
    const descriptor = { repoRel: '', group: 'changes' as const, path: 'weird:name:file.ts', status: 'modified' as const, isUntracked: false }

    expect(decodeDiffTab(encodeDiffTab(descriptor))?.path).toBe('weird:name:file.ts')
  })

  test('survives spaces and unicode in the path', () => {
    const descriptor = { repoRel: 'my repo', group: 'merge' as const, path: 'dossier/café ☕.ts', status: 'modified' as const, isUntracked: false }

    expect(decodeDiffTab(encodeDiffTab(descriptor))).toEqual(descriptor)
  })

  test('produces distinct keys for the same file in different groups', () => {
    // The same file can be open as both a staged and an unstaged diff.
    const staged = encodeDiffTab({ repoRel: '', group: 'staged', path: 'a.ts', status: 'modified', isUntracked: false })
    const changes = encodeDiffTab({ repoRel: '', group: 'changes', path: 'a.ts', status: 'modified', isUntracked: false })

    expect(staged).not.toBe(changes)
  })
})

describe('isDiffTab', () => {
  test('recognises an encoded diff path', () => {
    expect(isDiffTab(encodeDiffTab({ repoRel: '', group: 'staged', path: 'a.ts', status: 'modified', isUntracked: false }))).toBe(true)
  })

  test('rejects an ordinary file path', () => {
    expect(isDiffTab('src/a.ts')).toBe(false)
  })

  test('rejects a file that merely starts with similar text', () => {
    expect(isDiffTab('git-diff-notes.md')).toBe(false)
  })
})

describe('decodeDiffTab', () => {
  test('returns null for a non-diff path', () => {
    expect(decodeDiffTab('src/a.ts')).toBeNull()
  })

  test('returns null for a malformed payload rather than throwing', () => {
    expect(decodeDiffTab('git-diff://%%%not-valid%%%')).toBeNull()
  })
})

describe('status round-trip', () => {
  test('preserves status and untracked flag', () => {
    // These drive which revisions get diffed — losing them silently produces
    // the wrong comparison for added, untracked and deleted files.
    const descriptor = {
      repoRel: '',
      group: 'changes' as const,
      path: 'new.ts',
      status: 'untracked' as const,
      isUntracked: true,
    }

    expect(decodeDiffTab(encodeDiffTab(descriptor))).toEqual(descriptor)
  })

  test('rejects a payload missing the status fields', () => {
    const legacy = 'git-diff://' + encodeURIComponent(JSON.stringify({ repoRel: '', group: 'staged', path: 'a.ts' }))

    expect(decodeDiffTab(legacy)).toBeNull()
  })
})
