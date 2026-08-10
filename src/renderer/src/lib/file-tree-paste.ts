import { planMove, topMostPaths } from './file-tree-move'

/** What the clipboard will do when pasted. */
export type ClipboardMode = 'cut' | 'copy'

export interface PasteStep {
  from: string
  to: string
  mode: 'move' | 'copy'
}

/** Split a filename into stem and extension, keeping compound suffixes sane. */
function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')

  // `dot <= 0` covers dotfiles ('.gitignore'), whose leading dot starts a name
  // rather than an extension. Splitting on the LAST dot keeps 'archive.tar.gz'
  // stemmed as 'archive.tar' instead of 'archive'.
  if (dot <= 0) {
    return { stem: name, ext: '' }
  }

  return { stem: name.slice(0, dot), ext: name.slice(dot) }
}

/**
 * `name`, or the first non-colliding variant of it.
 *
 * Follows Finder and VS Code: "notes.md" becomes "notes copy.md", then
 * "notes copy 2.md", "notes copy 3.md" and so on.
 */
export function nextAvailableName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) {
    return name
  }

  const { stem, ext } = splitName(name)

  const firstCopy = `${stem} copy${ext}`
  if (!taken.has(firstCopy)) {
    return firstCopy
  }

  for (let n = 2; ; n++) {
    const candidate = `${stem} copy ${n}${ext}`
    if (!taken.has(candidate)) {
      return candidate
    }
  }
}

/** Final path segment. */
function basenameOf(path: string): string {
  return path.split('/').pop() ?? path
}

/**
 * Plan a paste of `sources` into `destFolder`.
 *
 * `existingNames` are the names already in the destination. Names allocated
 * during this paste are added as we go, so two sources with the same basename
 * do not both get planned onto the same destination path.
 *
 * Cut reuses the move rules, so pasting back into the folder a file already
 * lives in is dropped as a no-op and pasting a folder into its own descendant
 * is refused. Copy is exempt from the no-op rule — copying into the current
 * folder is a legitimate duplicate — but still refuses descendants.
 */
export function planPaste(
  sources: readonly string[],
  destFolder: string,
  mode: ClipboardMode,
  existingNames: ReadonlySet<string>
): PasteStep[] {
  const steps: PasteStep[] = []
  const taken = new Set(existingNames)

  for (const source of topMostPaths(sources)) {
    if (mode === 'cut') {
      // planMove enforces no-ops, self-drops and descendant drops.
      if (!planMove(source, destFolder)) {
        continue
      }
    } else if (destFolder === source || destFolder.startsWith(`${source}/`)) {
      // Copying a folder into itself or below itself would recurse.
      continue
    }

    const name = nextAvailableName(basenameOf(source), taken)
    taken.add(name)

    steps.push({
      from: source,
      to: destFolder === '' ? name : `${destFolder}/${name}`,
      mode: mode === 'cut' ? 'move' : 'copy',
    })
  }

  return steps
}
