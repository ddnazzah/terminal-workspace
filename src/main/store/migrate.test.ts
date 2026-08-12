import { describe, expect, it } from 'vitest'
import { STATE_VERSION } from '@shared/types'
import { migrateState } from './migrate'

const v1 = {
  version: 1,
  selectedProjectId: 'p1',
  projects: [{ id: 'p1', name: 'wTerm', path: '/tmp/w', color: '#fff', terminals: [] }],
  activeTerminalByProject: {},
}

describe('migrateState', () => {
  it('seeds the board collections when migrating v1 forward', () => {
    const out = migrateState(v1)

    expect(out).not.toBeNull()
    expect(out?.version).toBe(STATE_VERSION)
    expect(out?.cards).toEqual([])
    expect(out?.notes).toEqual([])
    expect(out?.boardByProject).toEqual({})
  })

  it('preserves projects and selection across the migration', () => {
    const out = migrateState(v1)

    expect(out?.projects).toHaveLength(1)
    expect(out?.projects[0].id).toBe('p1')
    expect(out?.selectedProjectId).toBe('p1')
  })

  it('keeps existing board data when already at the current version', () => {
    const card = {
      id: 'c1',
      projectId: 'p1',
      number: 1,
      title: 't',
      body: '',
      status: 'ready',
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      log: [],
    }

    const out = migrateState({ ...v1, version: STATE_VERSION, cards: [card] })

    expect(out?.cards).toHaveLength(1)
    expect(out?.cards?.[0].id).toBe('c1')
  })

  it('preserves projects from a NEWER state file rather than resetting the workspace', () => {
    // A downgrade must degrade to "board features missing", never "projects gone".
    const out = migrateState({ ...v1, version: 99, projects: v1.projects })

    expect(out?.projects).toHaveLength(1)
    expect(out?.version).toBe(STATE_VERSION)
  })

  it('defaults missing terminals arrays', () => {
    const out = migrateState({ ...v1, projects: [{ id: 'p1', name: 'w', path: '/t', color: '#f' }] })

    expect(out?.projects[0].terminals).toEqual([])
  })

  it('drops active-terminal entries whose terminal no longer exists', () => {
    const out = migrateState({ ...v1, activeTerminalByProject: { p1: 'gone' } })

    expect(out?.activeTerminalByProject).toEqual({})
  })

  it('returns null for input that is not a state object', () => {
    expect(migrateState(null)).toBeNull()
    expect(migrateState('nope')).toBeNull()
    expect(migrateState({ version: 1 })).toBeNull()
  })
})
