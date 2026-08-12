import { statusColor } from '@renderer/lib/git-status-color'
import { STATUS_BADGE } from '@renderer/lib/git-decoration'
import type { RepoChange } from '@renderer/lib/repo-status'

interface Props {
  changes: RepoChange[]
  /** When set, rows become buttons that open the file. Source Control leaves this off. */
  onSelect?: (change: RepoChange) => void
  /** Project-relative path of the file currently open in the editor. */
  activePath?: string | null
}

export function ChangesList({ changes, onSelect, activePath = null }: Props) {
  if (changes.length === 0) {
    return <div className="px-3 py-2 text-[11px] text-foreground/40">No changes.</div>
  }
  return (
    <ul className="pb-1">
      {changes.map((change) => (
        <ChangeRow
          key={change.projectPath}
          change={change}
          onSelect={onSelect}
          isActive={activePath === change.projectPath}
        />
      ))}
    </ul>
  )
}

function ChangeRow({
  change,
  onSelect,
  isActive,
}: {
  change: RepoChange
  onSelect?: (change: RepoChange) => void
  isActive: boolean
}) {
  const slash = change.path.lastIndexOf('/')
  const name = slash === -1 ? change.path : change.path.slice(slash + 1)
  const dir = slash === -1 ? null : change.path.slice(0, slash)
  const color = statusColor(change.status)

  const body = (
    <>
      <span
        className={`truncate text-foreground/85 ${change.status === 'deleted' ? 'line-through' : ''}`}
        style={{ color }}
      >
        {name}
      </span>
      <span className="truncate text-[11px] text-foreground/40 flex-1">{dir ?? ''}</span>
      <span className="text-[11px] font-mono shrink-0" style={{ color }}>
        {STATUS_BADGE[change.status]}
      </span>
    </>
  )

  const rowClass = [
    'flex items-center gap-2 px-3 py-1 text-[12px] w-full text-left',
    isActive ? 'bg-foreground/10' : 'hover:bg-foreground/5',
  ].join(' ')

  // A deleted file has nothing to open — leave it inert rather than wiring a
  // button that fails silently.
  const canOpen = onSelect && change.status !== 'deleted'

  return (
    <li title={change.projectPath}>
      {canOpen ? (
        <button type="button" onClick={() => onSelect(change)} className={rowClass}>
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  )
}
