import { useEffect, useRef } from 'react'
import { chordFromEvent } from '@renderer/lib/keybindings'
import { resolveBinding, type CommandBinding } from '@renderer/lib/commands'

/** Map of command id to the function that runs it. */
export type CommandHandlers = Record<string, () => void>

interface Options {
  bindings: readonly CommandBinding[]
  handlers: CommandHandlers
  /** Context keys currently active, e.g. 'editorFocus'. */
  activeContexts: ReadonlySet<string>
  /** Set false to suspend dispatch, e.g. while a modal owns the keyboard. */
  enabled?: boolean
}

/**
 * Dispatch global keyboard shortcuts through the command registry.
 *
 * A single window-level listener resolves the pressed chord to a command and
 * runs its handler, replacing the per-component `e.key === '...'` checks that
 * were scattered across the app and could not be rebound.
 *
 * Typing is never intercepted: while focus is in a text field the event is
 * left alone unless the chord uses a non-shift modifier, so ⌘C still works in
 * an input but a bare letter binding never eats a keystroke.
 */
export function useKeybindings({ bindings, handlers, activeContexts, enabled = true }: Options): void {
  // Kept in refs so the listener is installed once rather than being town down
  // and rebuilt on every render that changes a handler identity.
  const handlersRef = useRef(handlers)
  const contextsRef = useRef(activeContexts)
  const bindingsRef = useRef(bindings)
  handlersRef.current = handlers
  contextsRef.current = activeContexts
  bindingsRef.current = bindings

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent): void => {
      const chord = chordFromEvent(event)

      // Shift alone is not enough to claim a keystroke from a text field.
      const hasRealModifier = chord.meta || chord.ctrl || chord.alt
      if (!hasRealModifier && isTypingTarget(event.target)) {
        return
      }

      const command = resolveBinding(bindingsRef.current, chord, contextsRef.current)
      if (!command) return

      const handler = handlersRef.current[command]
      if (!handler) return

      event.preventDefault()
      handler()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/** True when the event target accepts text input. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}
