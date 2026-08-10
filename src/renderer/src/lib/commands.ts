import { chordsMatch, parseChord, type Chord } from './keybindings'

/**
 * A keybinding: a chord, the command it runs, and optionally the context it
 * only applies in.
 *
 * `when` is a single context key rather than VS Code's full boolean expression
 * language — enough to disambiguate the same chord across surfaces (⌘W closing
 * an editor vs a terminal) without hauling in an expression parser.
 */
export interface CommandBinding {
  command: string
  /** Chord spec, e.g. 'mod+shift+p'. `mod` is Cmd on macOS, Ctrl elsewhere. */
  chord: string
  when?: string
}

type Platform = 'darwin' | (string & {})

/**
 * The command a pressed chord should run, or null when nothing applies.
 *
 * Resolution order, matching VS Code's precedence:
 *  1. bindings whose `when` context is currently active — most specific wins
 *  2. unconditional bindings
 *
 * Within each tier the LAST match wins, so user bindings appended after the
 * defaults override them. A binding with an unparseable chord is skipped
 * rather than throwing, so one bad entry in user config cannot break every
 * other shortcut.
 */
export function resolveBinding(
  bindings: readonly CommandBinding[],
  pressed: Chord,
  activeContexts: ReadonlySet<string>,
  platform: Platform = process.platform
): string | null {
  let contextual: string | null = null
  let unconditional: string | null = null

  for (const binding of bindings) {
    const chord = parseChord(binding.chord, platform)
    if (!chord || !chordsMatch(chord, pressed)) {
      continue
    }

    if (binding.when === undefined) {
      unconditional = binding.command
    } else if (activeContexts.has(binding.when)) {
      contextual = binding.command
    }
  }

  return contextual ?? unconditional
}

/** Context keys the app sets while a surface has focus. */
export const CONTEXT = {
  editorFocus: 'editorFocus',
  terminalFocus: 'terminalFocus',
  explorerFocus: 'explorerFocus',
} as const

/**
 * Default keybindings. Written with `mod` so one table covers both platforms.
 *
 * These mirror the shortcuts that were previously hard-coded across
 * components; centralising them is what makes rebinding possible at all.
 */
export const DEFAULT_BINDINGS: CommandBinding[] = [
  { command: 'workbench.toggleSidebar', chord: 'mod+b' },
  { command: 'workbench.toggleRightSidebar', chord: 'mod+shift+b' },
  { command: 'workbench.togglePanel', chord: 'mod+j' },
  { command: 'workbench.quickOpen', chord: 'mod+p' },
  { command: 'workbench.openSettings', chord: 'mod+,' },
  { command: 'terminal.new', chord: 'mod+t' },
  { command: 'terminal.close', chord: 'mod+w', when: CONTEXT.terminalFocus },
  { command: 'workbench.closeEditor', chord: 'mod+w', when: CONTEXT.editorFocus },
  { command: 'explorer.cut', chord: 'mod+x', when: CONTEXT.explorerFocus },
  { command: 'explorer.copy', chord: 'mod+c', when: CONTEXT.explorerFocus },
  { command: 'explorer.paste', chord: 'mod+v', when: CONTEXT.explorerFocus },
  { command: 'explorer.newFile', chord: 'mod+n', when: CONTEXT.explorerFocus },
]
