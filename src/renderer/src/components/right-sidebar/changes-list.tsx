import type { GitFileStatus } from '@shared/types'
import { statusColor } from '@renderer/lib/git-status-color'
import type { RepoChange } from '@renderer/lib/repo-status'

const STATUS_BADGE: Record<GitFileStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'U',
  conflict: 'C',
}

export function ChangesList({ changes }: { changes: RepoChange[] }) {
  if (changes.length === 0) {
    return <div className="px-3 py-2 text-[11px] text-foreground/40">No changes.</div>
  }
  return (
    <ul className="pb-1">
      {changes.map((c) => {
        const slash = c.path.lastIndexOf('/')
        const name = slash === -1 ? c.path : c.path.slice(slash + 1)
        const dir = slash === -1 ? null : c.path.slice(0, slash)
        return (
          <li
            key={c.projectPath}
            title={c.projectPath}
            className="flex items-center gap-2 px-3 py-1 text-[12px] hover:bg-foreground/5"
          >
            <span
              className="truncate text-foreground/85"
              style={{ color: statusColor(c.status) }}
            >
              {name}
            </span>
            <span className="truncate text-[11px] text-foreground/40 flex-1">
              {dir ?? ''}
            </span>
            <span
              className="text-[11px] font-mono shrink-0"
              style={{ color: statusColor(c.status) }}
            >
              {STATUS_BADGE[c.status]}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
