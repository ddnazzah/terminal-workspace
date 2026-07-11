import { describe, expect, it } from 'vitest'
import {
  buildAgentResumeCommand,
  buildResumeCommand,
  extractPinnedSessionId,
  isClaudeLaunch,
  isContinueLaunch,
  stripSessionPinning,
  withSessionId,
} from './claude-session'

describe('isClaudeLaunch', () => {
  it('matches claude as the program', () => {
    expect(isClaudeLaunch('claude')).toBe(true)
    expect(isClaudeLaunch('  claude --dangerously-skip-permissions ')).toBe(true)
  })

  it('rejects non-claude / empty commands', () => {
    expect(isClaudeLaunch(undefined)).toBe(false)
    expect(isClaudeLaunch('')).toBe(false)
    expect(isClaudeLaunch('npm run dev')).toBe(false)
    // Must be the program, not just a substring.
    expect(isClaudeLaunch('echo claude')).toBe(false)
    expect(isClaudeLaunch('claudette')).toBe(false)
  })
})

describe('withSessionId', () => {
  it('appends a generated session id', () => {
    expect(withSessionId('claude', 'abc')).toBe('claude --session-id abc')
    expect(withSessionId('claude --dangerously-skip-permissions', 'abc')).toBe(
      'claude --dangerously-skip-permissions --session-id abc'
    )
  })

  it('leaves the command alone when the user pins a session', () => {
    expect(withSessionId('claude --resume xyz', 'abc')).toBe('claude --resume xyz')
    expect(withSessionId('claude --session-id fixed', 'abc')).toBe('claude --session-id fixed')
    expect(withSessionId('claude -c', 'abc')).toBe('claude -c')
    expect(withSessionId('claude --continue', 'abc')).toBe('claude --continue')
  })

  it('does not touch non-claude commands', () => {
    expect(withSessionId('npm run dev', 'abc')).toBe('npm run dev')
  })
})

describe('buildResumeCommand', () => {
  it('appends --resume preserving other flags', () => {
    expect(buildResumeCommand('claude', 'id1')).toBe('claude --resume id1')
    expect(buildResumeCommand('claude --dangerously-skip-permissions', 'id1')).toBe(
      'claude --dangerously-skip-permissions --resume id1'
    )
  })

  it('strips any pre-existing session-pinning flags', () => {
    expect(buildResumeCommand('claude --session-id old', 'id1')).toBe('claude --resume id1')
    expect(buildResumeCommand('claude --resume other', 'id1')).toBe('claude --resume id1')
    expect(buildResumeCommand('claude -r other --model opus', 'id1')).toBe(
      'claude --model opus --resume id1'
    )
    expect(buildResumeCommand('claude --continue --verbose', 'id1')).toBe(
      'claude --verbose --resume id1'
    )
  })

  it('falls back to bare claude when the command is missing or changed', () => {
    expect(buildResumeCommand(undefined, 'id1')).toBe('claude --resume id1')
    expect(buildResumeCommand('', 'id1')).toBe('claude --resume id1')
    expect(buildResumeCommand('npm run dev', 'id1')).toBe('claude --resume id1')
  })
})

describe('stripSessionPinning', () => {
  it('removes session-pinning flags and their values', () => {
    expect(stripSessionPinning('claude --resume abc')).toBe('claude')
    expect(stripSessionPinning('claude -r abc --model opus')).toBe('claude --model opus')
    expect(stripSessionPinning('claude --session-id abc -c')).toBe('claude')
    expect(stripSessionPinning('claude --resume=abc --continue')).toBe('claude')
  })

  it('keeps unrelated flags untouched', () => {
    expect(stripSessionPinning('claude --dangerously-skip-permissions')).toBe(
      'claude --dangerously-skip-permissions'
    )
    expect(stripSessionPinning('aider --model gpt-4o')).toBe('aider --model gpt-4o')
  })

  it('does not eat a following flag as a value', () => {
    expect(stripSessionPinning('claude --resume --verbose')).toBe('claude --verbose')
  })
})

describe('extractPinnedSessionId', () => {
  it('extracts explicit resume/session ids', () => {
    expect(extractPinnedSessionId('claude --resume abc-123')).toBe('abc-123')
    expect(extractPinnedSessionId('claude -r abc')).toBe('abc')
    expect(extractPinnedSessionId('claude --session-id abc')).toBe('abc')
    expect(extractPinnedSessionId('claude --resume=abc')).toBe('abc')
    expect(extractPinnedSessionId('claude --session-id=abc')).toBe('abc')
  })

  it('returns null when no id is pinned', () => {
    expect(extractPinnedSessionId('claude')).toBeNull()
    expect(extractPinnedSessionId('claude --continue')).toBeNull()
    // Picker form: --resume with no value.
    expect(extractPinnedSessionId('claude --resume')).toBeNull()
    expect(extractPinnedSessionId('claude --resume --verbose')).toBeNull()
  })
})

describe('isContinueLaunch', () => {
  it('detects --continue / -c launches', () => {
    expect(isContinueLaunch('claude --continue')).toBe(true)
    expect(isContinueLaunch('claude -c')).toBe(true)
    expect(isContinueLaunch('claude --dangerously-skip-permissions -c')).toBe(true)
  })

  it('rejects fresh launches', () => {
    expect(isContinueLaunch('claude')).toBe(false)
    expect(isContinueLaunch('claude --resume abc')).toBe(false)
  })
})

describe('buildAgentResumeCommand', () => {
  it('resumes an exact session, preserving the captured launch flags', () => {
    expect(
      buildAgentResumeCommand('claude --dangerously-skip-permissions', 'claude --continue', 'id1')
    ).toBe('claude --dangerously-skip-permissions --resume id1')
  })

  it('strips stale pinning from the captured command before resuming', () => {
    expect(
      buildAgentResumeCommand('claude --resume old --model opus', 'claude --continue', 'id1')
    ).toBe('claude --model opus --resume id1')
  })

  it('falls back to the rule flags when no exact id is known', () => {
    expect(
      buildAgentResumeCommand('claude --dangerously-skip-permissions', 'claude --continue')
    ).toBe('claude --dangerously-skip-permissions --continue')
    expect(buildAgentResumeCommand('cursor-agent', 'cursor-agent --resume')).toBe(
      'cursor-agent --resume'
    )
  })

  it('re-runs the captured command as-is when the rule adds no flags', () => {
    expect(buildAgentResumeCommand('aider --model gpt-4o', 'aider')).toBe('aider --model gpt-4o')
  })
})
