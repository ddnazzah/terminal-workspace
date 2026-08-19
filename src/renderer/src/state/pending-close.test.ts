import { describe, expect, test } from 'vitest'
import {
  pendingCloseAfterRemoval,
  resolveCloseLabel,
  type PendingTerminalClose,
} from './pending-close'
import type { Project } from '@shared/types'

const pending: PendingTerminalClose = {
  projectId: 'p1',
  terminalId: 't1',
  label: 'Claude Code',
}

const projects = [
  {
    id: 'p1',
    name: 'wTerm',
    path: '/tmp/wterm',
    terminals: [
      { id: 't1', name: 'zsh' },
      { id: 't2', name: 'server' },
    ],
  },
  {
    id: 'home',
    name: 'Home',
    path: '/tmp',
    terminals: [{ id: 'h1', name: 'scratch' }],
  },
] as unknown as Project[]

describe('resolveCloseLabel', () => {
  test('prefers the agent-supplied title over the tab name', () => {
    expect(resolveCloseLabel(projects, { t1: 'Fixing the resize bug' }, 'p1', 't1')).toBe(
      'Fixing the resize bug'
    )
  })

  test('falls back to the tab name when there is no title', () => {
    expect(resolveCloseLabel(projects, {}, 'p1', 't2')).toBe('server')
  })

  test('falls back to the tab name when the title is empty', () => {
    expect(resolveCloseLabel(projects, { t1: '' }, 'p1', 't1')).toBe('zsh')
  })

  test('resolves terminals in the Home workspace', () => {
    expect(resolveCloseLabel(projects, {}, 'home', 'h1')).toBe('scratch')
  })

  test('returns null for a terminal that no longer exists', () => {
    expect(resolveCloseLabel(projects, {}, 'p1', 'gone')).toBeNull()
  })

  test('returns null when the project is unknown', () => {
    expect(resolveCloseLabel(projects, {}, 'nope', 't1')).toBeNull()
  })
})

describe('pendingCloseAfterRemoval', () => {
  test('clears the pending close when its own terminal is removed', () => {
    // Arrange / Act
    const next = pendingCloseAfterRemoval(pending, { projectId: 'p1', terminalId: 't1' })

    // Assert
    expect(next).toBeNull()
  })

  test('keeps the pending close when a different terminal is removed', () => {
    const next = pendingCloseAfterRemoval(pending, { projectId: 'p1', terminalId: 't2' })

    expect(next).toBe(pending)
  })

  test('keeps the pending close when the same terminal id is removed from another project', () => {
    const next = pendingCloseAfterRemoval(pending, { projectId: 'p2', terminalId: 't1' })

    expect(next).toBe(pending)
  })

  test('returns null when nothing is pending', () => {
    const next = pendingCloseAfterRemoval(null, { projectId: 'p1', terminalId: 't1' })

    expect(next).toBeNull()
  })
})
