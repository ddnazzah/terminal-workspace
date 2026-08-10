/**
 * Keyboard chord parsing and matching for the command keybindings.
 *
 * Chords are written the way VS Code writes them — `mod+shift+p` — and are
 * compared structurally rather than by string, so `shift+cmd+p` and
 * `cmd+shift+p` are the same binding.
 */

export interface Chord {
  /** Lowercased `KeyboardEvent.key`, e.g. 'p', 'arrowdown', 'escape'. */
  key: string
  meta: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
}

type Platform = 'darwin' | (string & {})

const MODIFIERS: Record<string, keyof Omit<Chord, 'key'> | 'mod'> = {
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  mod: 'mod',
}

/**
 * Parse a chord string, or null when it names no actual key.
 *
 * `mod` resolves to Cmd on macOS and Ctrl elsewhere, so a single binding table
 * serves both platforms.
 */
export function parseChord(spec: string, platform: Platform = process.platform): Chord | null {
  const parts = spec
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return null
  }

  const chord: Chord = { key: '', meta: false, ctrl: false, shift: false, alt: false }

  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()]
    if (modifier === 'mod') {
      if (platform === 'darwin') chord.meta = true
      else chord.ctrl = true
      continue
    }
    if (modifier) {
      chord[modifier] = true
      continue
    }
    // Lowercased so a shifted letter keeps a stable identity: shift is carried
    // by its own flag, not by the key's case.
    chord.key = part.toLowerCase()
  }

  return chord.key === '' ? null : chord
}

/** The chord a keyboard event represents. */
export function chordFromEvent(event: KeyboardEvent): Chord {
  return {
    key: event.key.toLowerCase(),
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  }
}

/**
 * Exact structural equality.
 *
 * Every modifier must match, including the absent ones — otherwise ⌘⇧P would
 * also fire a binding registered for ⌘P.
 */
export function chordsMatch(binding: Chord, pressed: Chord): boolean {
  return (
    binding.key === pressed.key &&
    binding.meta === pressed.meta &&
    binding.ctrl === pressed.ctrl &&
    binding.shift === pressed.shift &&
    binding.alt === pressed.alt
  )
}

const MAC_SYMBOLS = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' } as const

/** Human-readable form for menus and tooltips. */
export function formatChord(chord: Chord, platform: Platform = process.platform): string {
  const label = chord.key.length === 1 ? chord.key.toUpperCase() : capitalise(chord.key)

  if (platform === 'darwin') {
    // macOS order is fixed: ⌃⌥⇧⌘ then the key, with no separators.
    return (
      (chord.ctrl ? MAC_SYMBOLS.ctrl : '') +
      (chord.alt ? MAC_SYMBOLS.alt : '') +
      (chord.shift ? MAC_SYMBOLS.shift : '') +
      (chord.meta ? MAC_SYMBOLS.meta : '') +
      label
    )
  }

  const parts: string[] = []
  if (chord.ctrl) parts.push('Ctrl')
  if (chord.alt) parts.push('Alt')
  if (chord.shift) parts.push('Shift')
  if (chord.meta) parts.push('Meta')
  parts.push(label)
  return parts.join('+')
}

/** Restore the conventional casing of a named key ('arrowdown' -> 'ArrowDown'). */
function capitalise(key: string): string {
  const NAMED = [
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Escape',
    'Enter',
    'Backspace',
    'Delete',
    'Tab',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ]
  return NAMED.find((n) => n.toLowerCase() === key) ?? key.charAt(0).toUpperCase() + key.slice(1)
}
