import { parseChord } from './keybindings'
import type { CommandBinding } from './commands'

/** A user's rebinding, persisted alongside the defaults. */
export type UserBinding = CommandBinding

export interface Conflict {
  /** Chord spec as written by the first binding that claimed it. */
  chord: string
  when?: string
  commands: string[]
}

/**
 * Combine the built-in bindings with the user's overrides.
 *
 * Overrides are appended rather than substituted because `resolveBinding`
 * takes the last match — appending is what makes an override win. The original
 * entry is deliberately left in place: removing it would silently free the old
 * chord for something else, which is not what rebinding one command means.
 *
 * An override with an empty chord removes the command's bindings entirely,
 * which is how a shortcut is unbound.
 */
export function mergeBindings(
  defaults: readonly CommandBinding[],
  overrides: readonly UserBinding[]
): CommandBinding[] {
  const unbound = new Set(overrides.filter((o) => o.chord.trim() === '').map((o) => o.command))

  const kept = defaults.filter((b) => !unbound.has(b.command))
  const applied = overrides.filter((o) => o.chord.trim() !== '')

  return [...kept, ...applied]
}

/** Stable key for "the same keystroke in the same context". */
function conflictKey(binding: CommandBinding, platform: string): string | null {
  const chord = parseChord(binding.chord, platform)
  if (!chord) return null

  // Built from the parsed flags, not the written string, so 'shift+cmd+p' and
  // 'cmd+shift+p' collide as they should.
  const mods = [chord.meta && 'M', chord.ctrl && 'C', chord.shift && 'S', chord.alt && 'A']
    .filter(Boolean)
    .join('')

  return `${mods}:${chord.key}:${binding.when ?? ''}`
}

/**
 * Chords claimed by more than one command in the same context.
 *
 * The same chord in *different* contexts is not a conflict — that is the whole
 * purpose of when-clauses, and ⌘W closing either an editor or a terminal
 * depends on it. Unparseable chords are skipped rather than reported as
 * clashing with each other.
 */
export function findConflicts(
  bindings: readonly CommandBinding[],
  platform: string = process.platform
): Conflict[] {
  const byKey = new Map<string, CommandBinding[]>()

  for (const binding of bindings) {
    const key = conflictKey(binding, platform)
    if (!key) continue

    const list = byKey.get(key)
    if (list) list.push(binding)
    else byKey.set(key, [binding])
  }

  const conflicts: Conflict[] = []
  for (const group of byKey.values()) {
    // Several entries for the SAME command is an override, not a clash.
    const commands = [...new Set(group.map((b) => b.command))]
    if (commands.length > 1) {
      conflicts.push({
        chord: group[0].chord,
        ...(group[0].when ? { when: group[0].when } : {}),
        commands,
      })
    }
  }

  return conflicts
}
