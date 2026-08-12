import { useWorkspace } from '@renderer/state/store'
import { decodeDiffTab, diffTabLabel } from '@renderer/lib/diff-tab'
import { Codicon } from '../codicon'
import { FileIcon } from '../right-sidebar/file-icon'

interface Props {
  projectId: string
}

/**
 * VS Code's breadcrumb bar: the active file's path, one clickable segment per
 * folder, separated by chevrons.
 *
 * Symbol breadcrumbs (the second half of VS Code's bar) need a language
 * service to supply an outline, so only the file path is shown here.
 */
export function Breadcrumbs({ projectId }: Props) {
  const activePath = useWorkspace((s) => s.activeFileByProject[projectId] ?? null)
  const openFile = useWorkspace((s) => s.openFile)

  if (!activePath) return null

  // A diff tab has an encoded path; show the file it diffs, not the payload.
  const diff = decodeDiffTab(activePath)
  const displayPath = diff ? diff.path : activePath
  const segments = displayPath.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const fileName = segments[segments.length - 1]

  return (
    <div
      className="flex shrink-0 items-center gap-0.5 overflow-hidden px-2 text-[13px]"
      // 22px, matching VS Code's breadcrumb row.
      style={{ height: 22, color: 'var(--vscode-sideBar-foreground)' }}
      aria-label="Breadcrumbs"
    >
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1
        // Clicking a folder is a no-op for now; only the file navigates.
        const path = segments.slice(0, i + 1).join('/')
        return (
          <span key={path} className="flex min-w-0 items-center">
            {i > 0 && (
              <Codicon name="chevron-right" size={16} className="shrink-0 opacity-40" />
            )}
            <button
              type="button"
              disabled={!isLast || diff !== null}
              onClick={() => !diff && openFile({ projectId, path: activePath })}
              className="truncate px-1 hover:opacity-100 disabled:cursor-default"
              style={{ opacity: isLast ? 0.9 : 0.55 }}
            >
              {isLast && (
                <FileIcon name={fileName} isDirectory={false} className="mr-1 inline-block" />
              )}
              {segment}
            </button>
          </span>
        )
      })}
      {diff && <span className="ml-1 shrink-0 opacity-45">{diffTabLabel(diff)}</span>}
    </div>
  )
}
