import { watch, type FSWatcher } from 'node:fs'
import { dirname, basename } from 'node:path'

/**
 * Watch a changing set of files and report when any of them changes on disk.
 *
 * Directories are watched rather than individual files: editors and formatters
 * routinely save by writing a temp file and renaming it over the target, which
 * destroys the inode a per-file watch is bound to. A per-file watcher goes
 * deaf after the first such save; a directory watcher keeps reporting.
 *
 * Events are debounced per path because a single save can emit several
 * (`rename` then `change`, plus editor-specific extras).
 */
export class OpenFileWatcher {
  private readonly watchers = new Map<string, FSWatcher>()
  /** Absolute paths currently of interest, grouped by their directory. */
  private readonly watched = new Map<string, Set<string>>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly onChange: (absPath: string) => void,
    private readonly debounceMs = 120
  ) {}

  /** Replace the watched set with exactly these absolute paths. */
  setPaths(absPaths: readonly string[]): void {
    const next = new Map<string, Set<string>>()
    for (const abs of absPaths) {
      const dir = dirname(abs)
      const set = next.get(dir) ?? new Set<string>()
      set.add(basename(abs))
      next.set(dir, set)
    }

    // Drop watchers for directories no longer holding anything we care about.
    for (const [dir, watcher] of this.watchers) {
      if (!next.has(dir)) {
        watcher.close()
        this.watchers.delete(dir)
      }
    }

    for (const dir of next.keys()) {
      if (this.watchers.has(dir)) continue
      try {
        const watcher = watch(dir, (_event, filename) => {
          if (!filename) return
          const names = this.watched.get(dir)
          const name = String(filename)
          if (!names?.has(name)) return
          this.schedule(`${dir}/${name}`)
        })
        watcher.on('error', () => {
          // A removed or unreadable directory should not take the app down.
          watcher.close()
          this.watchers.delete(dir)
        })
        this.watchers.set(dir, watcher)
      } catch {
        // Directory vanished between listing and watching — ignore.
      }
    }

    this.watched.clear()
    for (const [dir, names] of next) this.watched.set(dir, names)
  }

  private schedule(absPath: string): void {
    const existing = this.timers.get(absPath)
    if (existing) clearTimeout(existing)

    this.timers.set(
      absPath,
      setTimeout(() => {
        this.timers.delete(absPath)
        this.onChange(absPath)
      }, this.debounceMs)
    )
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    this.watched.clear()
  }
}
