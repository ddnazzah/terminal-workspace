import { describe, expect, it } from 'vitest'
import {
  HOOK_EVENTS,
  hooksInstalled,
  installHooks,
  relayCommand,
  uninstallHooks,
} from './hook-settings'

const RELAY = '/Users/x/Library/Application Support/wTerm/agent-hook.sh'

/** A settings file shaped like the user's real one, with a hook of their own. */
const userSettings = () => ({
  permissions: { defaultMode: 'auto' },
  tui: 'fullscreen',
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'log-it' }] }],
  },
})

describe('installHooks', () => {
  it('adds a relay entry for every listened-for event', () => {
    // Act
    const next = installHooks({}, RELAY)

    // Assert
    const hooks = next.hooks as Record<string, unknown[]>
    for (const event of HOOK_EVENTS) expect(hooks[event]).toHaveLength(1)
  })

  it('keeps the user\'s own hooks on an event it also uses', () => {
    const next = installHooks(userSettings(), RELAY)

    const stop = (next.hooks as Record<string, { hooks: { command: string }[] }[]>).Stop
    expect(stop.map((e) => e.hooks[0].command)).toEqual(['say done', relayCommand(RELAY)])
  })

  it('leaves unrelated hook events and unrelated settings untouched', () => {
    const next = installHooks(userSettings(), RELAY)

    const hooks = next.hooks as Record<string, { matcher?: string }[]>
    expect(hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'log-it' }] },
    ])
    expect(next.permissions).toEqual({ defaultMode: 'auto' })
    expect(next.tui).toBe('fullscreen')
  })

  it('does not mutate the settings it was given', () => {
    const original = userSettings()
    const snapshot = JSON.parse(JSON.stringify(original))

    installHooks(original, RELAY)

    expect(original).toEqual(snapshot)
  })

  it('is idempotent — installing twice leaves one entry per event', () => {
    const once = installHooks(userSettings(), RELAY)
    const twice = installHooks(once, RELAY)

    expect(twice).toEqual(once)
  })

  it('rewrites a stale relay path instead of stacking a second entry', () => {
    const old = installHooks({}, '/old/path/agent-hook.sh')

    const next = installHooks(old, RELAY)

    const stop = (next.hooks as Record<string, { hooks: { command: string }[] }[]>).Stop
    expect(stop).toHaveLength(1)
    expect(stop[0].hooks[0].command).toBe(relayCommand(RELAY))
  })
})

describe('uninstallHooks', () => {
  it('removes wTerm entries and keeps the user\'s', () => {
    const installed = installHooks(userSettings(), RELAY)

    const next = uninstallHooks(installed)

    expect(next.hooks).toEqual({
      Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'log-it' }] }],
    })
  })

  it('drops the hooks key entirely when nothing of the user\'s remains', () => {
    const installed = installHooks({ tui: 'fullscreen' }, RELAY)

    const next = uninstallHooks(installed)

    expect(next).toEqual({ tui: 'fullscreen' })
    expect('hooks' in next).toBe(false)
  })

  it('is safe on settings that were never installed into', () => {
    expect(uninstallHooks({ permissions: {} })).toEqual({ permissions: {} })
  })
})

describe('hooksInstalled', () => {
  it('is false before install and true after', () => {
    expect(hooksInstalled(userSettings(), RELAY)).toBe(false)
    expect(hooksInstalled(installHooks(userSettings(), RELAY), RELAY)).toBe(true)
  })

  it('is false when the relay path is stale, so the caller rewrites it', () => {
    const installed = installHooks({}, '/old/path/agent-hook.sh')

    expect(hooksInstalled(installed, RELAY)).toBe(false)
  })

  it('is false when only some events are wired up', () => {
    const partial = { hooks: { Stop: [{ hooks: [{ type: 'command', command: relayCommand(RELAY) }] }] } }

    expect(hooksInstalled(partial, RELAY)).toBe(false)
  })

  it('tolerates a malformed hooks value instead of throwing', () => {
    expect(hooksInstalled({ hooks: 'nonsense' }, RELAY)).toBe(false)
    expect(hooksInstalled({ hooks: [] }, RELAY)).toBe(false)
  })
})
