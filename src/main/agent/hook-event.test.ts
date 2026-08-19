import { describe, expect, it } from 'vitest'
import { parseHookMessage } from './hook-event'

// Bodies captured from Claude Code 2.1.235 running under `script`, with the
// relay's `terminal_id` added.
const promptSubmit = JSON.stringify({
  hook_event_name: 'UserPromptSubmit',
  session_id: 'd7e9ddbf-f3fa-45fb-83d3-98d09909f181',
  transcript_path: '/Users/x/.claude/projects/-Users-x/d7e9ddbf.jsonl',
  cwd: '/Users/x/project',
  permission_mode: 'default',
  terminal_id: 'term-1',
})
const notification = JSON.stringify({
  hook_event_name: 'Notification',
  session_id: 'd7e9ddbf-f3fa-45fb-83d3-98d09909f181',
  message: 'Claude needs your permission',
  terminal_id: 'term-1',
})
const stop = JSON.stringify({
  hook_event_name: 'Stop',
  session_id: 'd73cb096-c916-4c11-ad85-cd7b7832e2db',
  stop_hook_active: false,
  terminal_id: 'term-1',
})

describe('parseHookMessage', () => {
  it('reads a submitted prompt as the start of work', () => {
    // Arrange / Act
    const message = parseHookMessage(promptSubmit)

    // Assert
    expect(message).toEqual({
      terminalId: 'term-1',
      sessionId: 'd7e9ddbf-f3fa-45fb-83d3-98d09909f181',
      event: { kind: 'promptSubmitted' },
    })
  })

  it('keeps the notification message so the reason can be shown', () => {
    const message = parseHookMessage(notification)

    expect(message?.event).toEqual({
      kind: 'needsInput',
      message: 'Claude needs your permission',
    })
  })

  it('falls back to a generic reason when a notification carries no message', () => {
    const message = parseHookMessage(
      JSON.stringify({ hook_event_name: 'Notification', terminal_id: 'term-1' })
    )

    expect(message?.event).toEqual({ kind: 'needsInput', message: 'Waiting for you' })
  })

  it('reads Stop as a finished turn', () => {
    const message = parseHookMessage(stop)

    expect(message?.event).toEqual({ kind: 'turnDone' })
  })

  it('returns null without a terminal id, since nothing could be updated', () => {
    const message = parseHookMessage(
      JSON.stringify({ hook_event_name: 'Stop', session_id: 'abc' })
    )

    expect(message).toBeNull()
  })

  it('returns null for hook events wTerm does not react to', () => {
    const message = parseHookMessage(
      JSON.stringify({ hook_event_name: 'PreToolUse', terminal_id: 'term-1' })
    )

    expect(message).toBeNull()
  })

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseHookMessage('{not json')).toBeNull()
    expect(parseHookMessage('')).toBeNull()
    expect(parseHookMessage('[]')).toBeNull()
    expect(parseHookMessage('null')).toBeNull()
  })

  it('tolerates a missing session id', () => {
    const message = parseHookMessage(
      JSON.stringify({ hook_event_name: 'Stop', terminal_id: 'term-1' })
    )

    expect(message?.sessionId).toBeNull()
  })
})
