import { useMemo, useState } from 'react'
import { useSettings } from '@renderer/state/settings'
import { COMMAND_CATALOGUE, DEFAULT_BINDINGS } from '@renderer/lib/commands'
import { mergeBindings, findConflicts } from '@renderer/lib/keybinding-overrides'
import { chordFromEvent, formatChord, parseChord } from '@renderer/lib/keybindings'
import { Codicon } from '../codicon'

/** Modifier-only presses while recording, which are never a complete chord. */
const MODIFIER_KEYS = new Set(['meta', 'control', 'shift', 'alt'])

export function KeybindingsPane() {
  const overrides = useSettings((s) => s.keybindings)
  const setKeybinding = useSettings((s) => s.setKeybinding)
  const resetKeybindings = useSettings((s) => s.resetKeybindings)
  const [recording, setRecording] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const merged = useMemo(() => mergeBindings(DEFAULT_BINDINGS, overrides), [overrides])
  const conflicts = useMemo(() => findConflicts(merged), [merged])

  /** Commands involved in a clash, so their rows can be flagged. */
  const conflicting = useMemo(
    () => new Set(conflicts.flatMap((c) => c.commands)),
    [conflicts]
  )

  /** Effective chord per command — the last match wins, matching resolution. */
  const chordFor = (command: string): string | null => {
    const found = [...merged].reverse().find((b) => b.command === command)
    return found?.chord ?? null
  }

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return COMMAND_CATALOGUE.filter(
      (c) =>
        needle === '' ||
        c.title.toLowerCase().includes(needle) ||
        c.category.toLowerCase().includes(needle)
    )
  }, [filter])

  const record = (command: string, e: React.KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Escape') {
      setRecording(null)
      return
    }

    // Wait for a real key: a bare modifier is the user still reaching for it.
    if (MODIFIER_KEYS.has(e.key.toLowerCase())) return

    const chord = chordFromEvent(e.nativeEvent)
    const when = DEFAULT_BINDINGS.find((b) => b.command === command)?.when

    // Persist in the portable `mod+` form so the binding follows the platform.
    const parts: string[] = []
    if (chord.meta || chord.ctrl) parts.push('mod')
    if (chord.shift) parts.push('shift')
    if (chord.alt) parts.push('alt')
    parts.push(chord.key)

    setKeybinding(command, parts.join('+'), when)
    setRecording(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter commands"
          aria-label="Filter commands"
          className="min-w-0 flex-1 rounded px-2 py-1 text-[13px] outline-none"
          style={{
            background: 'var(--vscode-input-background)',
            border: '1px solid var(--vscode-input-border)',
            color: 'var(--vscode-input-foreground)',
          }}
        />
        <button
          type="button"
          onClick={resetKeybindings}
          disabled={overrides.length === 0}
          className="shrink-0 rounded px-2 py-1 text-[11px] disabled:opacity-35"
          style={{ background: 'var(--vscode-list-hoverBackground)' }}
        >
          Reset all
        </button>
      </div>

      {conflicts.length > 0 && (
        <div
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px]"
          style={{ color: 'var(--vscode-gitDecoration-conflictingResourceForeground)' }}
        >
          <Codicon name="warning" size={16} />
          {conflicts.length} chord{conflicts.length === 1 ? '' : 's'} bound to more than one
          command
        </div>
      )}

      <div className="flex flex-col">
        {rows.map((cmd) => {
          const chord = chordFor(cmd.id)
          const parsed = chord ? parseChord(chord) : null
          const isRecording = recording === cmd.id
          const overridden = overrides.some((o) => o.command === cmd.id)

          return (
            <div
              key={cmd.id}
              className="flex items-center gap-2 border-b py-1.5 text-[13px]"
              style={{ borderColor: 'var(--vscode-panel-border)' }}
            >
              <span className="shrink-0 opacity-50">{cmd.category}:</span>
              <span className="truncate">{cmd.title}</span>
              {conflicting.has(cmd.id) && (
                <Codicon
                  name="warning"
                  size={16}
                  className="shrink-0"
                />
              )}

              <button
                type="button"
                onClick={() => setRecording(cmd.id)}
                onKeyDown={(e) => isRecording && record(cmd.id, e)}
                onBlur={() => isRecording && setRecording(null)}
                className="ml-auto shrink-0 rounded px-2 py-0.5 font-mono text-[11px]"
                style={{
                  background: isRecording
                    ? 'var(--vscode-list-activeSelectionBackground)'
                    : 'var(--vscode-input-background)',
                  border: '1px solid var(--vscode-input-border)',
                  color: overridden
                    ? 'var(--vscode-gitDecoration-modifiedResourceForeground)'
                    : 'var(--vscode-input-foreground)',
                }}
              >
                {isRecording ? 'Press keys…' : parsed ? formatChord(parsed) : 'Unbound'}
              </button>

              <button
                type="button"
                onClick={() => setKeybinding(cmd.id, '')}
                title="Unbind"
                aria-label={`Unbind ${cmd.title}`}
                className="shrink-0 rounded p-0.5 opacity-50 hover:opacity-100"
              >
                <Codicon name="close" size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
