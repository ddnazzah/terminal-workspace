import { describe, expect, it } from 'vitest'
import { branchForCard, slugify, worktreeDirName, worktreeRootFor } from './worktree-path'

describe('slugify', () => {
  it('lowercases and dash-separates', () => {
    expect(slugify('My Project')).toBe('my-project')
  })

  it('strips characters that are unsafe in a path or branch', () => {
    expect(slugify('feat: fix~the^thing?')).toBe('feat-fix-the-thing')
  })

  it('collapses runs of separators and trims the edges', () => {
    expect(slugify('  a???b  ')).toBe('a-b')
  })

  it('falls back to "card" when nothing survives', () => {
    expect(slugify('???')).toBe('card')
  })
})

describe('branchForCard', () => {
  it('namespaces branches by card number', () => {
    expect(branchForCard(42)).toBe('card/42')
  })
})

describe('worktreeDirName', () => {
  it('combines the project slug and the card number', () => {
    expect(worktreeDirName('wTerm', 42)).toBe('wterm-card-42')
  })
})

describe('worktreeRootFor', () => {
  it('defaults to the parent of the project path', () => {
    expect(worktreeRootFor('', '/Users/me/Workspace/wTerm')).toBe('/Users/me/Workspace')
  })

  it('honours a configured root', () => {
    expect(worktreeRootFor('/tmp/worktrees', '/Users/me/Workspace/wTerm')).toBe('/tmp/worktrees')
  })

  it('ignores a whitespace-only configured root', () => {
    expect(worktreeRootFor('   ', '/Users/me/Workspace/wTerm')).toBe('/Users/me/Workspace')
  })
})
