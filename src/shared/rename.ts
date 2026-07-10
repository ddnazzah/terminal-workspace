import type { TerminalRecord } from './types'

export type NameSource = 'auto' | 'user'

/**
 * Resolve a rename against a terminal record. Shared by the main-process store
 * and the renderer's local mirror so both sides apply identical semantics:
 *
 * - Auto rename against a user-owned name: no-op — manual renames always win
 *   over auto-naming.
 * - Non-empty name: adopt it and record who set it. Identical name from the
 *   current owner is a no-op (dedupes repeated auto traffic).
 * - Empty name from the user: keep the current name but reset ownership to
 *   'auto' — the escape hatch that re-enables auto-naming after a manual rename.
 * - Empty name from auto: no-op (auto-naming never blanks a name).
 *
 * Returns the input record unchanged (same reference) when nothing applies.
 */
export function applyRename(
  record: TerminalRecord,
  name: string,
  source: NameSource
): TerminalRecord {
  if (source === 'auto' && record.nameSource === 'user') return record
  const trimmed = name.trim()
  if (!trimmed) {
    return source === 'user' ? { ...record, nameSource: 'auto' } : record
  }
  // Unset nameSource means 'auto', so a same-name USER rename on an unowned
  // terminal still proceeds — it claims ownership even though the name stands.
  if (trimmed === record.name && (record.nameSource ?? 'auto') === source) return record
  return { ...record, name: trimmed, nameSource: source }
}
