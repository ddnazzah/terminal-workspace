import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { planRestore, type RestorePlanSettings } from './restore-plan'

const PROJECT_PATH = '/Users/me/Workspace/app'

function project(terminals: Project['terminals']): Project {
  return { id: 'p1', name: 'app', path: PROJECT_PATH, color: '#fff', terminals }
}

const SETTINGS: RestorePlanSettings = {
  startupCommand: undefined,
  agentRestoreEnabled: true,
  rules: [
    { match: 'claude', resume: 'claude --continue' },
    { match: 'aider', resume: 'aider' },
  ],
}

describe('planRestore', () => {
  it('resumes a wTerm-owned session by exact id, preferring the captured flags', () => {
    const plan = planRestore(
      [
        project([
          {
            id: 't1',
            name: 'Tab',
            shell: '/bin/zsh',
            claudeSessionId: 'owned-1',
            agent: { command: 'claude --dangerously-skip-permissions', cwd: PROJECT_PATH },
          },
        ]),
      ],
      SETTINGS
    )
    expect(plan).toEqual([
      {
        projectId: 'p1',
        id: 't1',
        name: 'Tab',
        cwd: undefined,
        resumeSessionId: 'owned-1',
        startupCommand: 'claude --dangerously-skip-permissions --resume owned-1',
      },
    ])
  })

  it('falls back to the configured startup command for owned sessions without a capture', () => {
    const plan = planRestore(
      [project([{ id: 't1', name: 'Tab', shell: '/bin/zsh', claudeSessionId: 'owned-1' }])],
      { ...SETTINGS, startupCommand: 'claude --model opus' }
    )
    expect(plan[0].startupCommand).toBe('claude --model opus --resume owned-1')
    expect(plan[0].resumeSessionId).toBe('owned-1')
  })

  it('resumes a sniffed agent session by exact id', () => {
    const plan = planRestore(
      [
        project([
          {
            id: 't1',
            name: 'Tab',
            shell: '/bin/zsh',
            agent: {
              command: 'claude --dangerously-skip-permissions',
              cwd: PROJECT_PATH,
              sessionId: 'sniffed-1',
            },
          },
        ]),
      ],
      SETTINGS
    )
    expect(plan[0].startupCommand).toBe(
      'claude --dangerously-skip-permissions --resume sniffed-1'
    )
    // Sniffed ids are agent-scoped, not wTerm-owned — no resumeSessionId claim.
    expect(plan[0].resumeSessionId).toBeUndefined()
  })

  it('falls back to the rule flags when no exact id is known', () => {
    const plan = planRestore(
      [
        project([
          {
            id: 't1',
            name: 'Tab',
            shell: '/bin/zsh',
            agent: { command: 'claude --dangerously-skip-permissions', cwd: PROJECT_PATH },
          },
        ]),
      ],
      SETTINGS
    )
    expect(plan[0].startupCommand).toBe('claude --dangerously-skip-permissions --continue')
  })

  it('restores an unmatched agent as a plain shell in its cwd — never a dead tab', () => {
    const plan = planRestore(
      [
        project([
          {
            id: 't1',
            name: 'Tab',
            shell: '/bin/zsh',
            agent: { command: 'cc', cwd: `${PROJECT_PATH}/packages/web` },
          },
        ]),
      ],
      SETTINGS
    )
    expect(plan).toEqual([
      { projectId: 'p1', id: 't1', name: 'Tab', cwd: 'packages/web', startupCommand: undefined },
    ])
  })

  it('restores agents as plain shells when agent restore is disabled', () => {
    const plan = planRestore(
      [
        project([
          {
            id: 't1',
            name: 'Tab',
            shell: '/bin/zsh',
            agent: { command: 'claude', cwd: PROJECT_PATH, sessionId: 'sniffed-1' },
          },
        ]),
      ],
      { ...SETTINGS, agentRestoreEnabled: false }
    )
    expect(plan[0].startupCommand).toBeUndefined()
  })

  it('restores a plain-shell record as a plain shell', () => {
    const plan = planRestore(
      [project([{ id: 't1', name: 'Tab', shell: '/bin/zsh' }])],
      SETTINGS
    )
    expect(plan).toEqual([
      { projectId: 'p1', id: 't1', name: 'Tab', cwd: undefined, startupCommand: undefined },
    ])
  })

  it('maps a cwd outside the project root back to the root', () => {
    const plan = planRestore(
      [
        project([
          {
            id: 't1',
            name: 'Tab',
            shell: '/bin/zsh',
            agent: { command: 'claude', cwd: '/somewhere/else' },
          },
        ]),
      ],
      SETTINGS
    )
    expect(plan[0].cwd).toBeUndefined()
  })

  it('plans one create per persisted tab across projects', () => {
    const plan = planRestore(
      [
        project([
          { id: 't1', name: 'A', shell: '/bin/zsh' },
          { id: 't2', name: 'B', shell: '/bin/zsh', claudeSessionId: 'x' },
        ]),
      ],
      SETTINGS
    )
    expect(plan.map((p) => p.id)).toEqual(['t1', 't2'])
  })
})
