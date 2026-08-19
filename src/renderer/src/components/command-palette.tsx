import { useEffect, useMemo, useRef, useState } from 'react'
import { COMMAND_CATALOGUE, chordForCommand } from '@renderer/lib/commands'
import { rankCommands } from '@renderer/lib/command-search'
import { formatChord, parseChord } from '@renderer/lib/keybindings'

interface Props {
  open: boolean
  /** Initial query, used when quick-open hands over via the '>' prefix. */
  seed?: string
  /** Command ids that currently have a handler; others are hidden. */
  available: ReadonlySet<string>
  onRun: (commandId: string) => void
  onClose: () => void
}

/** Highlight the characters that matched the query. */
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>

  const hit = new Set(indices)
  return (
    <>
      {[...text].map((ch, i) => (
        <span
          key={i}
          className={hit.has(i) ? 'text-[var(--vscode-list-activeSelectionForeground)]' : ''}
          style={hit.has(i) ? { fontWeight: 600 } : undefined}
        >
          {ch}
        </span>
      ))}
    </>
  )
}

/**
 * VS Code's ⌘⇧P palette: fuzzy-search every registered command and run it.
 *
 * Commands come from the registry rather than a separate list, so anything
 * with a keybinding is automatically discoverable here — and its shortcut is
 * shown alongside, which is how users learn the bindings exist.
 */
export function CommandPalette({ open, seed = '', available, onRun, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const results = useMemo(() => {
    const runnable = COMMAND_CATALOGUE.filter((c) => available.has(c.id))
    return rankCommands(query, runnable)
  }, [query, available])

  // Reset on each open so the palette never reappears mid-query.
  useEffect(() => {
    if (open) {
      setQuery(seed)
      setIndex(0)
      inputRef.current?.focus()
    }
  }, [open, seed])

  // Selection can outrun a narrowing result list.
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, results.length - 1)))
  }, [results.length])

  // Keep the highlighted row visible while arrowing.
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  const run = (commandId: string): void => {
    onClose()
    onRun(commandId)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[index]
      if (hit) run(hit.command.id)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Command Palette"
        onMouseDown={(e) => e.stopPropagation()}
        className="h-fit w-[min(46rem,90vw)] overflow-hidden rounded-md shadow-2xl"
        style={{
          background: 'var(--vscode-input-background)',
          border: '1px solid var(--vscode-input-border)',
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Search commands"
          placeholder="Type a command name…"
          className="w-full bg-transparent px-3 py-2 text-[13px] outline-none"
          style={{ color: 'var(--vscode-input-foreground)' }}
        />

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-[13px] opacity-50">No matching commands</div>
          ) : (
            results.map((hit, i) => {
              const chord = chordForCommand(hit.command.id)
              const parsed = chord ? parseChord(chord) : null
              const selected = i === index
              return (
                <button
                  key={hit.command.id}
                  type="button"
                  data-selected={selected}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(hit.command.id)}
                  className="flex w-full items-center gap-2 px-3 text-left text-[13px]"
                  style={{
                    height: 22,
                    background: selected
                      ? 'var(--vscode-list-activeSelectionBackground)'
                      : 'transparent',
                    color: 'var(--vscode-sideBar-foreground)',
                  }}
                >
                  <span className="shrink-0 opacity-50">{hit.command.category}:</span>
                  <span className="truncate">
                    <Highlighted text={hit.command.title} indices={hit.titleIndices} />
                  </span>
                  {parsed && (
                    <span className="ml-auto shrink-0 text-[11px] opacity-45">
                      {formatChord(parsed)}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
