import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FsEntry, GitFileStatus, GitFileStatusMap, Project } from '@shared/types'
import { createProjectTerminal, useWorkspace } from '@renderer/state/store'
import { FileIcon } from './file-icon'
import { statusColor } from '@renderer/lib/git-status-color'
import { dropFolderFor, planMoves } from '@renderer/lib/file-tree-move'
import { nextSelection, type SelectionState } from '@renderer/lib/file-tree-selection'

interface Props {
  project: Project
}

type ChildrenMap = Record<string, FsEntry[] | undefined>

export function FileTree({ project }: Props) {
  const openFile = useWorkspace((s) => s.openFile)
  const activeFilePath = useWorkspace(
    (s) => s.activeFileByProject[project.id] ?? null
  )

  const [rootEntries, setRootEntries] = useState<FsEntry[]>([])
  const [gitStatus, setGitStatus] = useState<GitFileStatusMap>({})
  const [children, setChildren] = useState<ChildrenMap>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [creatingAt, setCreatingAt] = useState<{
    parent: string
    kind: 'file' | 'folder'
  } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [selectionState, setSelectionState] = useState<SelectionState>({
    selection: new Set<string>(),
    anchor: null,
  })
  // The anchor doubles as the keyboard cursor, so single-row callers (arrow
  // keys, type-ahead, context menu) can keep treating selection as one path.
  const selected = selectionState.anchor
  const setSelected = useCallback((path: string | null) => {
    setSelectionState(
      path === null
        ? { selection: new Set<string>(), anchor: null }
        : { selection: new Set([path]), anchor: path }
    )
  }, [])
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [dropFolder, setDropFolder] = useState<string | null>(null)
  const typeAhead = useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 })

  const visibleRows = useMemo(
    () => flattenVisible(rootEntries, children, expanded),
    [rootEntries, children, expanded]
  )

  const reloadRoot = useCallback(async () => {
    setLoading(true)
    const list = await window.api.fs.list(project.id, '')
    setRootEntries(list)
    setLoading(false)
  }, [project.id])

  const reloadGit = useCallback(async () => {
    setGitStatus(await window.api.git.fileStatus(project.id))
  }, [project.id])

  const reloadFolder = useCallback(
    async (relPath: string) => {
      if (relPath === '') {
        await reloadRoot()
        void reloadGit()
        return
      }
      const list = await window.api.fs.list(project.id, relPath)
      setChildren((c) => ({ ...c, [relPath]: list }))
      void reloadGit()
    },
    [project.id, reloadRoot, reloadGit]
  )

  // reset & load when project changes
  useEffect(() => {
    setChildren({})
    setExpanded({})
    setMenu(null)
    setCreatingAt(null)
    setRenaming(null)
    void reloadRoot()
    void reloadGit()
  }, [project.id, reloadRoot, reloadGit])

  useEffect(() => {
    const onFocus = () => void reloadGit()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reloadGit])

  const toggle = useCallback(
    async (entry: FsEntry) => {
      if (!entry.isDirectory) return
      const isOpen = !!expanded[entry.path]
      setExpanded((e) => ({ ...e, [entry.path]: !isOpen }))
      if (!isOpen && !children[entry.path]) {
        const list = await window.api.fs.list(project.id, entry.path)
        setChildren((c) => ({ ...c, [entry.path]: list }))
      }
    },
    [expanded, children, project.id]
  )

  const handleDropOn = useCallback(
    async (target: FsEntry | null) => {
      const source = draggingPath
      setDraggingPath(null)
      setDropFolder(null)
      if (!source) return

      // Dragging a row that is part of the selection moves the whole
      // selection, as in VS Code; dragging an unselected row moves just it.
      const sources = selectionState.selection.has(source)
        ? [...selectionState.selection]
        : [source]

      const destFolder = dropFolderFor(target)
      const plans = planMoves(sources, destFolder)
      if (plans.length === 0) return

      const movedFrom: string[] = []
      for (const plan of plans) {
        const moved = await window.api.fs.rename(project.id, plan.from, plan.to)
        if (moved) movedFrom.push(plan.from)
      }
      if (movedFrom.length === 0) return

      // Reveal the destination so the moved entries are visible where they landed.
      if (destFolder !== '' && !expanded[destFolder]) {
        setExpanded((e) => ({ ...e, [destFolder]: true }))
      }

      // Refresh every folder that lost an entry, plus the one that gained them.
      const affected = new Set(movedFrom.map(parentOf))
      affected.add(destFolder)
      for (const folder of affected) {
        await reloadFolder(folder)
      }

      setSelectionState({ selection: new Set<string>(), anchor: null })
    },
    [draggingPath, selectionState, project.id, expanded, reloadFolder]
  )

  const handleAction = useCallback(
    async (target: FsEntry | null, action: ActionKey) => {
      setMenu(null)
      if (action === 'new-file' || action === 'new-folder') {
        const parent = target && target.isDirectory ? target.path : ''
        if (target && target.isDirectory && !expanded[target.path]) {
          await toggle(target)
        }
        setCreatingAt({ parent, kind: action === 'new-file' ? 'file' : 'folder' })
        return
      }
      if (!target) return
      if (action === 'reveal') {
        await window.api.fs.reveal(project.id, target.path)
        return
      }
      if (action === 'open') {
        openFile({ projectId: project.id, path: target.path })
        return
      }
      if (action === 'open-externally') {
        await window.api.fs.open(project.id, target.path)
        return
      }
      if (action === 'open-terminal') {
        const cwd = target.isDirectory ? target.path : parentOf(target.path)
        const folderName = cwd.split('/').pop() || project.name
        await createProjectTerminal(project.id, { cwd, name: folderName })
        return
      }
      if (action === 'copy-path') {
        const abs = `${project.path}/${target.path}`
        await navigator.clipboard.writeText(abs)
        return
      }
      if (action === 'copy-relative-path') {
        await navigator.clipboard.writeText(target.path)
        return
      }
      if (action === 'duplicate') {
        const newPath = await window.api.fs.duplicate(project.id, target.path)
        if (newPath) await reloadFolder(parentOf(target.path))
        return
      }
      if (action === 'rename') {
        setRenaming(target.path)
        return
      }
      if (action === 'delete') {
        const ok = window.confirm(`Move "${target.name}" to Trash?`)
        if (!ok) return
        await window.api.fs.remove(project.id, target.path)
        const parent = parentOf(target.path)
        await reloadFolder(parent)
        void reloadGit()
        return
      }
    },
    [expanded, toggle, project.id, project.path, project.name, reloadFolder, reloadGit, openFile]
  )

  const submitCreate = useCallback(
    async (name: string) => {
      if (!creatingAt) return
      const trimmed = name.trim()
      if (!trimmed) {
        setCreatingAt(null)
        return
      }
      const rel = creatingAt.parent ? `${creatingAt.parent}/${trimmed}` : trimmed
      if (creatingAt.kind === 'file') {
        await window.api.fs.createFile(project.id, rel)
      } else {
        await window.api.fs.createFolder(project.id, rel)
      }
      await reloadFolder(creatingAt.parent)
      setCreatingAt(null)
      void reloadGit()
    },
    [creatingAt, project.id, reloadFolder, reloadGit]
  )

  const submitRename = useCallback(
    async (oldPath: string, newName: string) => {
      const trimmed = newName.trim()
      setRenaming(null)
      if (!trimmed) return
      const parent = parentOf(oldPath)
      const newPath = parent ? `${parent}/${trimmed}` : trimmed
      if (newPath === oldPath) return
      const ok = await window.api.fs.rename(project.id, oldPath, newPath)
      if (ok) {
        await reloadFolder(parent)
        setExpanded((e) => {
          const next = { ...e }
          if (next[oldPath] !== undefined) {
            next[newPath] = next[oldPath]!
            delete next[oldPath]
          }
          return next
        })
        void reloadGit()
      }
    },
    [project.id, reloadFolder, reloadGit]
  )

  const onTreeKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (renaming || creatingAt) return
      const idx = visibleRows.findIndex((r) => r.path === selected)
      const cur = idx >= 0 ? visibleRows[idx] : null
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelected(visibleRows[Math.min(visibleRows.length - 1, idx + 1)]?.path ?? selected)
          return
        case 'ArrowUp':
          e.preventDefault()
          setSelected(visibleRows[Math.max(0, idx - 1)]?.path ?? selected)
          return
        case 'ArrowRight':
          if (cur?.isDirectory && !expanded[cur.path]) {
            e.preventDefault()
            void toggle(cur)
          }
          return
        case 'ArrowLeft':
          if (cur?.isDirectory && expanded[cur.path]) {
            e.preventDefault()
            void toggle(cur)
          }
          return
        case 'Enter':
          if (cur) {
            e.preventDefault()
            if (cur.isDirectory) void toggle(cur)
            else openFile({ projectId: project.id, path: cur.path })
          }
          return
        case 'F2':
          if (cur) {
            e.preventDefault()
            setRenaming(cur.path)
          }
          return
        case 'Delete':
        case 'Backspace':
          if (cur && (e.key === 'Delete' || e.metaKey)) {
            e.preventDefault()
            void handleAction(cur, 'delete')
          }
          return
      }
      if ((e.key === 'n' || e.key === 'N') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void handleAction(cur, 'new-file')
        return
      }
      // Type-ahead: jump to next visible row whose name starts with the typed buffer.
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const now = Date.now()
        const ta = typeAhead.current
        ta.buffer = now - ta.at > 600 ? e.key : ta.buffer + e.key
        ta.at = now
        const lower = ta.buffer.toLowerCase()
        const startFrom = idx >= 0 ? idx : 0
        const order = [
          ...visibleRows.slice(startFrom + 1),
          ...visibleRows.slice(0, startFrom + 1),
        ]
        const hit = order.find((r) => r.name.toLowerCase().startsWith(lower))
        if (hit) setSelected(hit.path)
      }
    },
    [renaming, creatingAt, visibleRows, selected, expanded, toggle, openFile, project.id, handleAction]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-accent/7">
        <span className="text-[11px] text-foreground/50 truncate flex-1" title={project.path}>
          {project.path.split('/').slice(-2).join('/')}
        </span>
        <ToolbarButton
          title="New file"
          onClick={() => setCreatingAt({ parent: '', kind: 'file' })}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          title="New folder"
          onClick={() => setCreatingAt({ parent: '', kind: 'folder' })}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
        </ToolbarButton>
        <ToolbarButton title="Refresh" onClick={() => void reloadRoot()}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </ToolbarButton>
      </div>

      <div
        tabIndex={0}
        onKeyDown={onTreeKey}
        className="flex-1 min-h-0 overflow-y-auto py-1 text-[13px] outline-none"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, target: null })
        }}
        onClick={() => setMenu(null)}
        onDragOver={(e) => {
          if (!draggingPath) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropFolder('') // empty space below the rows = project root
        }}
        onDrop={(e) => {
          e.preventDefault()
          void handleDropOn(null)
        }}
      >
        {loading && rootEntries.length === 0 ? (
          <div className="text-[11px] text-foreground/40 px-3 py-2">Loading…</div>
        ) : null}

        {creatingAt && creatingAt.parent === '' && (
          <CreateInput
            depth={0}
            kind={creatingAt.kind}
            onSubmit={submitCreate}
            onCancel={() => setCreatingAt(null)}
          />
        )}

        {rootEntries.map((entry) => (
          <TreeRow
            key={entry.path}
            entry={entry}
            depth={0}
            expanded={expanded}
            children_={children}
            gitStatus={gitStatus}
            selection={selectionState.selection}
            renaming={renaming}
            creatingAt={creatingAt}
            draggingPath={draggingPath}
            dropFolder={dropFolder}
            onDragStartRow={(e) => setDraggingPath(e.path)}
            onDragOverRow={(e) => setDropFolder(dropFolderFor(e))}
            onDropRow={(e) => void handleDropOn(e)}
            onDragEndRow={() => {
              setDraggingPath(null)
              setDropFolder(null)
            }}
            onToggle={toggle}
            onOpen={(e, ev) => {
              const modifiers = {
                meta: ev.metaKey || ev.ctrlKey,
                shift: ev.shiftKey,
              }
              setSelectionState((current) =>
                nextSelection(
                  visibleRows.map((r) => r.path),
                  current,
                  e.path,
                  modifiers
                )
              )
              // A modified click only adjusts the selection — matching VS Code,
              // it never expands a folder or opens a file.
              if (modifiers.meta || modifiers.shift) return
              if (e.isDirectory) void toggle(e)
              else openFile({ projectId: project.id, path: e.path })
            }}
            activePath={activeFilePath}
            onContextMenu={(e, ev) => {
              ev.preventDefault()
              ev.stopPropagation()
              setMenu({ x: ev.clientX, y: ev.clientY, target: e })
            }}
            onSubmitRename={submitRename}
            onSubmitCreate={submitCreate}
            onCancelCreate={() => setCreatingAt(null)}
            onCancelRename={() => setRenaming(null)}
          />
        ))}

        {!loading && rootEntries.length === 0 && (
          <div className="text-[11px] text-foreground/40 px-3 py-4 text-center">
            Empty folder.
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          onClose={() => setMenu(null)}
          onAction={(action) => void handleAction(menu.target, action)}
        />
      )}
    </div>
  )
}

function ToolbarButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex items-center justify-center w-6 h-6 rounded-md text-foreground/55 hover:text-foreground hover:bg-foreground/10 transition-colors"
    >
      {children}
    </button>
  )
}

interface TreeRowProps {
  entry: FsEntry
  depth: number
  expanded: Record<string, boolean>
  children_: ChildrenMap
  gitStatus: GitFileStatusMap
  selection: ReadonlySet<string>
  renaming: string | null
  creatingAt: { parent: string; kind: 'file' | 'folder' } | null
  activePath: string | null
  draggingPath: string | null
  dropFolder: string | null
  onDragStartRow: (entry: FsEntry) => void
  onDragOverRow: (entry: FsEntry) => void
  onDropRow: (entry: FsEntry) => void
  onDragEndRow: () => void
  onToggle: (entry: FsEntry) => void
  onOpen: (entry: FsEntry, ev: React.MouseEvent) => void
  onContextMenu: (entry: FsEntry, ev: React.MouseEvent) => void
  onSubmitRename: (oldPath: string, newName: string) => void
  onSubmitCreate: (name: string) => void
  onCancelCreate: () => void
  onCancelRename: () => void
}

function TreeRow({
  entry,
  depth,
  expanded,
  children_,
  gitStatus,
  selection,
  renaming,
  creatingAt,
  activePath,
  draggingPath,
  dropFolder,
  onDragStartRow,
  onDragOverRow,
  onDropRow,
  onDragEndRow,
  onToggle,
  onOpen,
  onContextMenu,
  onSubmitRename,
  onSubmitCreate,
  onCancelCreate,
  onCancelRename,
}: TreeRowProps) {
  const isOpen = !!expanded[entry.path]
  const kids = children_[entry.path]
  const isActive = !entry.isDirectory && activePath === entry.path
  const isSelected = selection.has(entry.path)
  const isDragging = draggingPath === entry.path
  // Highlight the folder a drop would land in — the row itself when it is a
  // directory, otherwise the containing folder shown via its own row.
  const isDropTarget =
    dropFolder !== null && entry.isDirectory && dropFolder === entry.path
  const status = entry.isDirectory
    ? folderStatus(entry.path, gitStatus)
    : gitStatus[entry.path]
  const color = statusColor(status)

  return (
    <div>
      {renaming === entry.path ? (
        <RenameInput
          depth={depth}
          initialName={entry.name}
          onSubmit={(name) => onSubmitRename(entry.path, name)}
          onCancel={onCancelRename}
        />
      ) : (
        <button
          type="button"
          draggable
          onDragStart={(ev) => {
            ev.dataTransfer.effectAllowed = 'move'
            // Some platforms suppress the drag image without payload data.
            ev.dataTransfer.setData('text/plain', entry.path)
            onDragStartRow(entry)
          }}
          onDragOver={(ev) => {
            if (!draggingPath) return
            ev.preventDefault()
            ev.dataTransfer.dropEffect = 'move'
            onDragOverRow(entry)
          }}
          onDrop={(ev) => {
            ev.preventDefault()
            ev.stopPropagation()
            onDropRow(entry)
          }}
          onDragEnd={onDragEndRow}
          onClick={(ev) => onOpen(entry, ev)}
          onContextMenu={(ev) => onContextMenu(entry, ev)}
          title={entry.ignored ? `${entry.name} — ignored by git` : entry.name}
          className={[
            'group/row relative flex items-center w-full pr-2 py-[3px] text-left',
            isActive ? 'bg-foreground/10' : 'hover:bg-foreground/5',
            isSelected ? 'ring-1 ring-inset ring-accent/40' : '',
            isDropTarget ? 'bg-accent/20 ring-1 ring-inset ring-accent/60' : '',
            isDragging ? 'opacity-40' : '',
          ].join(' ')}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          {/* Indent guides — one vertical rule per ancestor level, matching
              VS Code's explorer. Centred on each level's twisty column. */}
          {Array.from({ length: depth }, (_, level) => (
            <span
              key={level}
              aria-hidden
              className="absolute top-0 bottom-0 w-px bg-foreground/10"
              style={{ left: 8 + level * 12 + 6 }}
            />
          ))}
          <span
            onClick={(ev) => {
              if (entry.isDirectory) {
                ev.stopPropagation()
                onToggle(entry)
              }
            }}
            className={[
              'inline-flex items-center justify-center w-3 h-3 mr-1 text-[8px] text-foreground/45 transition-transform',
              entry.isDirectory ? '' : 'opacity-0',
              isOpen ? 'rotate-90' : '',
            ].join(' ')}
            aria-hidden
          >
            ▶
          </span>
          <FileIcon
            name={entry.name}
            isDirectory={entry.isDirectory}
            isOpen={isOpen}
            className={['mr-1.5', entry.ignored ? 'opacity-45' : ''].join(' ')}
          />
          <span
            className={[
              'truncate',
              status === 'deleted' ? 'line-through' : '',
              entry.ignored
                ? 'text-foreground/40 group-hover/row:text-foreground/60'
                : isActive
                  ? 'text-foreground'
                  : 'text-foreground/85 group-hover/row:text-foreground',
            ].join(' ')}
            style={{ color }}
          >
            {entry.name}
          </span>
        </button>
      )}

      {entry.isDirectory && isOpen && (
        <>
          {creatingAt && creatingAt.parent === entry.path && (
            <CreateInput
              depth={depth + 1}
              kind={creatingAt.kind}
              onSubmit={onSubmitCreate}
              onCancel={onCancelCreate}
            />
          )}
          {kids === undefined ? (
            <div
              className="text-[11px] text-foreground/35 py-0.5"
              style={{ paddingLeft: 8 + (depth + 1) * 12 + 16 }}
            >
              Loading…
            </div>
          ) : (
            kids.map((child) => (
              <TreeRow
                key={child.path}
                entry={child}
                depth={depth + 1}
                expanded={expanded}
                children_={children_}
                gitStatus={gitStatus}
                selection={selection}
                renaming={renaming}
                creatingAt={creatingAt}
                activePath={activePath}
                draggingPath={draggingPath}
                dropFolder={dropFolder}
                onDragStartRow={onDragStartRow}
                onDragOverRow={onDragOverRow}
                onDropRow={onDropRow}
                onDragEndRow={onDragEndRow}
                onToggle={onToggle}
                onOpen={onOpen}
                onContextMenu={onContextMenu}
                onSubmitRename={onSubmitRename}
                onSubmitCreate={onSubmitCreate}
                onCancelCreate={onCancelCreate}
                onCancelRename={onCancelRename}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}

function CreateInput({
  depth,
  kind,
  onSubmit,
  onCancel,
}: {
  depth: number
  kind: 'file' | 'folder'
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  return (
    <div
      className="flex items-center py-[3px]"
      style={{ paddingLeft: 8 + depth * 12 + 16 }}
    >
      <FileIcon
        name={kind === 'folder' ? 'new' : 'new.txt'}
        isDirectory={kind === 'folder'}
        className="mr-1.5"
      />
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={kind === 'folder' ? 'folder-name' : 'file.txt'}
        onBlur={() => onSubmit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(value)
          if (e.key === 'Escape') onCancel()
        }}
        className="flex-1 bg-transparent outline-none text-[13px] border-b border-foreground/30 focus:border-foreground"
      />
    </div>
  )
}

function RenameInput({
  depth,
  initialName,
  onSubmit,
  onCancel,
}: {
  depth: number
  initialName: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialName)
  return (
    <div
      className="flex items-center py-[3px]"
      style={{ paddingLeft: 8 + depth * 12 + 16 }}
    >
      <input
        autoFocus
        value={value}
        onFocus={(e) => {
          const dot = initialName.lastIndexOf('.')
          if (dot > 0) e.currentTarget.setSelectionRange(0, dot)
          else e.currentTarget.select()
        }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onSubmit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(value)
          if (e.key === 'Escape') onCancel()
        }}
        className="flex-1 bg-transparent outline-none text-[13px] border-b border-foreground/30 focus:border-foreground"
      />
    </div>
  )
}

type ActionKey =
  | 'new-file'
  | 'new-folder'
  | 'rename'
  | 'delete'
  | 'duplicate'
  | 'reveal'
  | 'open'
  | 'open-externally'
  | 'open-terminal'
  | 'copy-path'
  | 'copy-relative-path'
interface MenuState {
  x: number
  y: number
  target: FsEntry | null
}

function ContextMenu({
  x,
  y,
  target,
  onClose,
  onAction,
}: {
  x: number
  y: number
  target: FsEntry | null
  onClose: () => void
  onAction: (a: ActionKey) => void
}) {
  useEffect(() => {
    const handler = () => onClose()
    window.addEventListener('click', handler)
    window.addEventListener('blur', handler)
    return () => {
      window.removeEventListener('click', handler)
      window.removeEventListener('blur', handler)
    }
  }, [onClose])

  return (
    <div
      role="menu"
      className="fixed z-50 min-w-44 rounded-lg border border-foreground/15 bg-background/95 backdrop-blur shadow-xl py-1 text-[13px]"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {target && !target.isDirectory && (
        <>
          <MenuItem onClick={() => onAction('open')}>Open</MenuItem>
          <MenuItem onClick={() => onAction('open-externally')}>Open with default app</MenuItem>
          <MenuDivider />
        </>
      )}
      <MenuItem onClick={() => onAction('new-file')}>New file</MenuItem>
      <MenuItem onClick={() => onAction('new-folder')}>New folder</MenuItem>
      {target && (
        <>
          <MenuItem onClick={() => onAction('duplicate')}>Duplicate</MenuItem>
          <MenuItem onClick={() => onAction('rename')}>Rename</MenuItem>
          <MenuItem onClick={() => onAction('delete')} danger>
            Move to Trash
          </MenuItem>
          <MenuDivider />
          <MenuItem onClick={() => onAction('copy-path')}>Copy path</MenuItem>
          <MenuItem onClick={() => onAction('copy-relative-path')}>Copy relative path</MenuItem>
          <MenuDivider />
          <MenuItem onClick={() => onAction('reveal')}>Reveal in Finder</MenuItem>
          <MenuItem onClick={() => onAction('open-terminal')}>New terminal here</MenuItem>
        </>
      )}
    </div>
  )
}

function MenuItem({
  onClick,
  children,
  danger,
}: {
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex items-center w-full px-3 py-1.5 text-left transition-colors',
        danger
          ? 'text-red-400 hover:bg-red-500/15'
          : 'text-foreground/85 hover:bg-foreground/10',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function MenuDivider() {
  return <div className="my-1 mx-2 h-px bg-foreground/10" />
}

function parentOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

function flattenVisible(
  roots: FsEntry[],
  children: ChildrenMap,
  expanded: Record<string, boolean>
): FsEntry[] {
  const out: FsEntry[] = []
  const walk = (entries: FsEntry[]): void => {
    for (const e of entries) {
      out.push(e)
      if (e.isDirectory && expanded[e.path]) {
        const kids = children[e.path]
        if (kids) walk(kids)
      }
    }
  }
  walk(roots)
  return out
}

/** A folder is "dirty" if any changed path sits under it. */
function folderStatus(path: string, map: GitFileStatusMap): GitFileStatus | undefined {
  const prefix = path + '/'
  for (const key of Object.keys(map)) {
    if (key.startsWith(prefix)) return 'modified'
  }
  return undefined
}
