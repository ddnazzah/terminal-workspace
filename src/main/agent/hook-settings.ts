// Merging wTerm's hook entries into a Claude Code settings object.
//
// This edits a file the user owns and may well have hand-written, so the rules
// here are deliberately conservative:
//
//   - wTerm only ever adds, finds, or removes entries carrying its own marker.
//     Anything else in `hooks` is copied through untouched.
//   - Nothing is mutated in place; every function returns a new object, so a
//     failed write can never leave a half-edited settings object behind.
//   - Install is idempotent: running it twice leaves exactly one entry per
//     event, and re-running after wTerm moves rewrites the stale path.

/** Marks an entry as wTerm's, so uninstall never removes the user's own hooks. */
export const HOOK_MARKER = '#wterm-agent-hook'

/**
 * The events wTerm listens for. Deliberately the smallest set that answers
 * "is this agent working, or does it need me?" — wTerm has no use for the
 * per-tool events and firing a subprocess on each of those would be rude.
 */
export const HOOK_EVENTS = ['UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'] as const

interface HookCommand {
  type: string
  command: string
}
interface HookMatcher {
  matcher?: string
  hooks: HookCommand[]
}
type HookMap = Record<string, HookMatcher[]>

/** The shell wTerm asks Claude to run for an event. */
export function relayCommand(relayPath: string): string {
  return `'${relayPath}' ${HOOK_MARKER}`
}

function isWtermEntry(entry: HookMatcher): boolean {
  return entry.hooks?.some((h) => typeof h.command === 'string' && h.command.includes(HOOK_MARKER))
}

function asHookMap(settings: Record<string, unknown>): HookMap {
  const hooks = settings.hooks
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return {}
  return hooks as HookMap
}

function entriesFor(map: HookMap, event: string): HookMatcher[] {
  const list = map[event]
  return Array.isArray(list) ? list : []
}

/** Every entry for `event` that wTerm did not write. */
function foreignEntries(map: HookMap, event: string): HookMatcher[] {
  return entriesFor(map, event).filter((entry) => !isWtermEntry(entry))
}

/**
 * Add (or refresh) wTerm's relay hook for every event it listens for, leaving
 * the user's own hooks and every other setting alone.
 */
export function installHooks(
  settings: Record<string, unknown>,
  relayPath: string
): Record<string, unknown> {
  const map = asHookMap(settings)
  const ours: HookMatcher = { hooks: [{ type: 'command', command: relayCommand(relayPath) }] }

  const nextHooks: HookMap = { ...map }
  for (const event of HOOK_EVENTS) {
    nextHooks[event] = [...foreignEntries(map, event), ours]
  }
  return { ...settings, hooks: nextHooks }
}

/** Remove every wTerm-written entry, and drop keys left empty by the removal. */
export function uninstallHooks(settings: Record<string, unknown>): Record<string, unknown> {
  const map = asHookMap(settings)
  const nextHooks: HookMap = {}
  for (const [event, entries] of Object.entries(map)) {
    const kept = Array.isArray(entries) ? entries.filter((e) => !isWtermEntry(e)) : entries
    if (Array.isArray(kept) && kept.length === 0) continue
    nextHooks[event] = kept
  }

  // Leaving an empty `hooks: {}` behind would be wTerm's litter, not the user's.
  if (Object.keys(nextHooks).length === 0) {
    const { hooks: _removed, ...rest } = settings
    return rest
  }
  return { ...settings, hooks: nextHooks }
}

/**
 * True when every listened-for event already points at this exact relay path.
 * A stale path (wTerm moved, or the app was reinstalled) reads as not installed
 * so the caller rewrites it.
 */
export function hooksInstalled(settings: Record<string, unknown>, relayPath: string): boolean {
  const map = asHookMap(settings)
  const wanted = relayCommand(relayPath)
  return HOOK_EVENTS.every((event) =>
    entriesFor(map, event).some((entry) => entry.hooks?.some((h) => h.command === wanted))
  )
}
