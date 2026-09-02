import type { ReactNode } from 'react'
import { useWorkspace, tabKey, type FilePane, type OpenedFile } from '@renderer/state/store'
import { statusColor } from '@renderer/lib/git-status-color'
import { statusLetter } from '@renderer/lib/git-groups'
import { useFileChange } from '@renderer/hooks/use-file-change'
import { DiffViewer } from './diff-viewer'

interface Props {
  file: OpenedFile
  /** Last-saved content — changes on ⌘S, re-running the status check. */
  revision: string
  /** The file's own surface: editor, markdown pane, SVG pane. */
  children: ReactNode
}

/**
 * Gives a changed file two tabs — its diff and its source — with Changes first
 * and selected by default.
 *
 * Source Control still opens its own per-group diff tabs, which answer a
 * narrower question (what is staged, what is not). This pane answers the one a
 * file tab implies: what has changed in this file since the last commit. A file
 * with no uncommitted change gets no strip at all and renders exactly as before.
 */
export function FilePanes({ file, revision, children }: Props) {
  const change = useFileChange(file.projectId, file.path, revision)
  const pane = useWorkspace((s) => s.filePaneByTab[tabKey(file)])
  const setFilePane = useWorkspace((s) => s.setFilePane)

  if (!change) return <>{children}</>

  // Unset means Changes: for a file that has some, the diff is what you came for.
  const active: FilePane = pane ?? 'changes'

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1"
        style={{ borderColor: 'var(--vscode-panel-border)' }}
      >
        <PaneTab active={active === 'changes'} onClick={() => setFilePane(file, 'changes')}>
          Changes
          <span
            className="ml-1 font-mono text-[10px]"
            style={{ color: statusColor(change.row.status) }}
          >
            {statusLetter(change.row.status)}
          </span>
        </PaneTab>
        <PaneTab active={active === 'file'} onClick={() => setFilePane(file, 'file')}>
          File
        </PaneTab>
      </div>
      <div className="min-h-0 flex-1">
        {active === 'changes' ? (
          <DiffViewer
            projectId={file.projectId}
            repoRel={change.repoRel}
            row={change.row}
            revision={revision}
          />
        ) : (
          children
        )}
      </div>
    </div>
  )
}

function PaneTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'flex items-center rounded px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'bg-foreground/10 text-foreground'
          : 'text-foreground/55 hover:bg-foreground/5 hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
