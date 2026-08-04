import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitStatusEntry } from '@shared/types'
import { useWorkspace } from '@renderer/state/store'
import { groupChanges, statusLetter, type GitChangeRow } from '@renderer/lib/git-groups'
import { FileIcon } from './file-icon'
import { Codicon, type CodiconName } from '../codicon'

interface Props {
  projectId: string
  /** Repo path relative to the project root; '' for the project root itself. */
  repoRel: string
  onChanged: () => void
}

/**
 * VS Code's Source Control view: a commit box over Merge / Staged / Changes
 * groups, with per-row and per-group stage, unstage and discard.
 */
export function SourceControl({ projectId, repoRel, onChanged }: Props) {
  const [entries, setEntries] = useState<GitStatusEntry[] | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const openFile = useWorkspace((s) => s.openFile)

  const reload = useCallback(async () => {
    setEntries(await window.api.git.statusEntries(projectId, repoRel))
  }, [projectId, repoRel])

  useEffect(() => {
    void reload()
  }, [reload])

  const groups = useMemo(() => groupChanges(entries ?? []), [entries])

  /** Run a git mutation, then refresh both this view and the caller's status. */
  const run = useCallback(
    async (op: () => Promise<unknown>) => {
      setBusy(true)
      try {
        await op()
        await reload()
        onChanged()
      } finally {
        setBusy(false)
      }
    },
    [reload, onChanged]
  )

  const stage = (paths: string[]) =>
    void run(() => window.api.git.stage(projectId, repoRel, paths))

  const unstage = (paths: string[]) =>
    void run(() => window.api.git.unstage(projectId, repoRel, paths))

  const discard = (rows: GitChangeRow[]) => {
    const label =
      rows.length === 1
        ? `Discard changes in "${basename(rows[0].path)}"?`
        : `Discard changes in ${rows.length} files?`
    // Untracked files are deleted outright, so say so before doing it.
    if (!window.confirm(`${label}\n\nThis cannot be undone.`)) return

    const tracked = rows.filter((r) => !r.isUntracked).map((r) => r.path)
    const untracked = rows.filter((r) => r.isUntracked).map((r) => r.path)
    void run(() => window.api.git.discard(projectId, repoRel, tracked, untracked))
  }

  const commit = () => {
    if (!message.trim() || groups.staged.length === 0) return
    void run(async () => {
      const res = await window.api.git.commit(projectId, repoRel, message)
      setResult(res.ok ? null : res.output.split('\n').slice(-2).join(' '))
      if (res.ok) setMessage('')
    })
  }

  const open = (row: GitChangeRow) => {
    const full = repoRel ? `${repoRel}/${row.path}` : row.path
    openFile({ projectId, path: full })
  }

  if (entries === null) {
    return <div className="px-3 py-3 text-[11px] text-foreground/40">Loading changes…</div>
  }

  const canCommit = message.trim().length > 0 && groups.staged.length > 0 && !busy

  return (
    <div className="flex flex-col gap-2 px-2 py-2">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter commits, as in VS Code.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        rows={2}
        placeholder="Message (⌘Enter to commit)"
        className="w-full resize-y rounded-md border border-foreground/10 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none placeholder:text-foreground/35 focus:border-accent/50"
      />

      <button
        type="button"
        onClick={commit}
        disabled={!canCommit}
        className="rounded-md bg-accent/80 px-2 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:bg-foreground/10 disabled:text-foreground/35"
      >
        <span className="inline-flex items-center justify-center gap-1.5">
          <Codicon name="check" size={16} />
          {busy ? 'Working…' : `Commit${groups.staged.length ? ` (${groups.staged.length})` : ''}`}
        </span>
      </button>

      {result && <div className="px-1 text-[11px] text-red-400">{result}</div>}

      <Group
        title="Merge Changes"
        rows={groups.merge}
        onOpen={open}
        actions={(rows) => [{ label: 'Stage All', icon: 'add', run: () => stage(rows.map((r) => r.path)) }]}
        rowActions={(row) => [{ label: 'Stage', icon: 'add', run: () => stage([row.path]) }]}
      />

      <Group
        title="Staged Changes"
        rows={groups.staged}
        onOpen={open}
        actions={(rows) => [
          { label: 'Unstage All', icon: 'remove', run: () => unstage(rows.map((r) => r.path)) },
        ]}
        rowActions={(row) => [{ label: 'Unstage', icon: 'remove', run: () => unstage([row.path]) }]}
      />

      <Group
        title="Changes"
        rows={groups.changes}
        onOpen={open}
        actions={(rows) => [
          { label: 'Discard All', icon: 'discard', run: () => discard(rows) },
          { label: 'Stage All', icon: 'add', run: () => stage(rows.map((r) => r.path)) },
        ]}
        rowActions={(row) => [
          { label: 'Discard', icon: 'discard', run: () => discard([row]) },
          { label: 'Stage', icon: 'add', run: () => stage([row.path]) },
        ]}
      />

      {groups.merge.length + groups.staged.length + groups.changes.length === 0 && (
        <div className="px-1 py-2 text-[11px] text-foreground/40">No changes.</div>
      )}
    </div>
  )
}

interface RowAction {
  label: string
  icon: CodiconName
  run: () => void
}

function Group({
  title,
  rows,
  onOpen,
  actions,
  rowActions,
}: {
  title: string
  rows: GitChangeRow[]
  onOpen: (row: GitChangeRow) => void
  actions: (rows: GitChangeRow[]) => RowAction[]
  rowActions: (row: GitChangeRow) => RowAction[]
}) {
  const [collapsed, setCollapsed] = useState(false)
  if (rows.length === 0) return null

  return (
    <div>
      <div className="group/hdr flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-1 text-left text-[11px] font-medium uppercase tracking-wide text-foreground/55 hover:text-foreground/80"
        >
          <Codicon name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} />
          {title}
        </button>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/hdr:opacity-100">
          {actions(rows).map((a) => (
            <IconButton key={a.label} action={a} />
          ))}
        </div>
        <span className="ml-1 min-w-4 rounded bg-foreground/10 px-1 text-center text-[10px] text-foreground/60">
          {rows.length}
        </span>
      </div>

      {!collapsed &&
        rows.map((row) => (
          <div
            key={`${title}:${row.path}`}
            /* 22px row — VS Code's .scm-view .monaco-list-row line-height */
            style={{ height: 22 }}
            className="group/row flex items-center gap-1.5 rounded px-1 hover:bg-foreground/5"
          >
            <button
              type="button"
              onClick={() => onOpen(row)}
              title={row.oldPath ? `${row.oldPath} → ${row.path}` : row.path}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            >
              <FileIcon name={basename(row.path)} isDirectory={false} />
              <span className="truncate text-[12px] text-foreground/85">
                {basename(row.path)}
              </span>
              <span className="truncate text-[10px] text-foreground/35">
                {dirname(row.path)}
              </span>
            </button>
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
              {rowActions(row).map((a) => (
                <IconButton key={a.label} action={a} />
              ))}
            </div>
            <span
              className="w-4 shrink-0 text-center text-[11px] font-medium"
              style={{ color: statusColorFor(row.status) }}
            >
              {statusLetter(row.status)}
            </span>
          </div>
        ))}
    </div>
  )
}

function IconButton({ action }: { action: RowAction }) {
  return (
    <button
      type="button"
      onClick={action.run}
      title={action.label}
      aria-label={action.label}
      className="flex h-5 w-5 items-center justify-center rounded text-foreground/60 hover:bg-foreground/10 hover:text-foreground"
    >
      <Codicon name={action.icon} size={16} />
    </button>
  )
}

/**
 * VS Code's own git decoration tokens (see globals.css). Returned as a CSS
 * value rather than a Tailwind class so the colors stay exactly the upstream
 * hexes instead of the nearest palette approximation.
 */
function statusColorFor(status: GitChangeRow['status']): string {
  switch (status) {
    case 'added':
      return 'var(--vscode-gitDecoration-addedResourceForeground)'
    case 'untracked':
      return 'var(--vscode-gitDecoration-untrackedResourceForeground)'
    case 'deleted':
      return 'var(--vscode-gitDecoration-deletedResourceForeground)'
    case 'renamed':
      return 'var(--vscode-gitDecoration-renamedResourceForeground)'
    default:
      return 'var(--vscode-gitDecoration-modifiedResourceForeground)'
  }
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}
