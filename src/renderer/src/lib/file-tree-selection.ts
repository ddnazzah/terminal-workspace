/**
 * Pure selection rules for the file explorer, matching VS Code's list
 * behaviour: plain click replaces, cmd/ctrl click toggles, shift click
 * extends an inclusive range from a fixed anchor.
 */

export interface SelectionState {
  /** Currently selected project-relative paths. */
  readonly selection: ReadonlySet<string>
  /** Row that shift-ranges extend from; null when nothing has been clicked. */
  readonly anchor: string | null
}

export interface ClickModifiers {
  /** Cmd on macOS, Ctrl elsewhere. */
  readonly meta: boolean
  readonly shift: boolean
}

/** Selection containing only `path`, anchored there. */
function single(path: string): SelectionState {
  return { selection: new Set([path]), anchor: path }
}

/**
 * Selection after clicking `clicked`, given the currently visible rows in
 * display order. Returns a new state; the input is never mutated.
 *
 * `visiblePaths` must be the flattened, expanded-only row order, because a
 * shift-range spans what the user can actually see — not the full tree.
 */
export function nextSelection(
  visiblePaths: readonly string[],
  current: SelectionState,
  clicked: string,
  modifiers: ClickModifiers
): SelectionState {
  if (modifiers.shift) {
    const anchorIndex = current.anchor === null ? -1 : visiblePaths.indexOf(current.anchor)
    const clickedIndex = visiblePaths.indexOf(clicked)

    // No usable anchor (never clicked, or its folder was collapsed away), or
    // the clicked row is not visible — degrade to a plain selection.
    if (anchorIndex === -1 || clickedIndex === -1) {
      return single(clicked)
    }

    const start = Math.min(anchorIndex, clickedIndex)
    const end = Math.max(anchorIndex, clickedIndex)

    return {
      selection: new Set(visiblePaths.slice(start, end + 1)),
      // Anchor stays put so the range can be resized by shift-clicking again.
      anchor: current.anchor,
    }
  }

  if (modifiers.meta) {
    const selection = new Set(current.selection)
    if (selection.has(clicked)) {
      selection.delete(clicked)
    } else {
      selection.add(clicked)
    }

    return { selection, anchor: clicked }
  }

  return single(clicked)
}

/** The single selected path, or null when the selection is empty or multiple. */
export function soleSelection(state: SelectionState): string | null {
  if (state.selection.size !== 1) {
    return null
  }

  const [only] = state.selection
  return only
}
