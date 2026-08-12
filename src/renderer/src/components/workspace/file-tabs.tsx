import { useCallback, useEffect, useMemo, useRef } from 'react'
import { tabKey, useWorkspace, type OpenedFile } from '@renderer/state/store'
import { parseTabPath } from '@renderer/lib/tab-uri'
import { useBoard } from '@renderer/hooks/use-board'
import { FileIcon } from '../right-sidebar/file-icon'

interface Props {
  projectId: string
}

export function FileTabs({ projectId }: Props) {
  const openFiles = useWorkspace((s) => s.openFiles)
  const fileStates = useWorkspace((s) => s.fileStates)
  const activeFileByProject = useWorkspace((s) => s.activeFileByProject)
  const setActiveFile = useWorkspace((s) => s.setActiveFile)
  const closeFile = useWorkspace((s) => s.closeFile)
  const reorderFile = useWorkspace((s) => s.reorderFile)

  const projectTabs = useMemo(
    () => openFiles.filter((f) => f.projectId === projectId),
    [openFiles, projectId]
  )
  const activePath = activeFileByProject[projectId] ?? null
  // Note tabs are titled by their note, which is renamed from inside the tab.
  const { snapshot } = useBoard(projectId)
  const notes = snapshot.notes

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      const n = Number.parseInt(e.key, 10)
      if (Number.isInteger(n) && n >= 1 && n <= 9 && projectTabs[n - 1]) {
        e.preventDefault()
        setActiveFile(projectId, projectTabs[n - 1].path)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projectTabs, projectId, setActiveFile])

  const closeWithConfirm = useCallback(
    (file: OpenedFile) => {
      const state = fileStates[tabKey(file)]
      const dirty = state?.kind === 'text' && state.current !== state.saved
      if (dirty) {
        const ok = window.confirm(
          `"${file.path.split('/').pop()}" has unsaved changes. Discard and close?`
        )
        if (!ok) return
      }
      closeFile(file)
    },
    [fileStates, closeFile]
  )

  const dragIndex = useRef<number | null>(null)

  if (projectTabs.length === 0) return null

  return (
    <div
      className="flex items-stretch h-full min-w-0 overflow-x-auto"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {projectTabs.map((file, i) => {
        const isActive = file.path === activePath
        const target = parseTabPath(file.path)
        const name =
          target.kind === 'board'
            ? 'Board'
            : target.kind === 'note'
              ? notes.find((n) => n.id === target.noteId)?.title || 'Untitled note'
              : (file.path.split('/').pop() ?? file.path)
        const state = fileStates[tabKey(file)]
        // Virtual tabs autosave and have no file state, so they are never dirty.
        const dirty = state?.kind === 'text' && state.current !== state.saved
        return (
          <div
            key={file.path}
            className={[
              'group/tab relative flex items-center gap-1.5 pl-3 pr-2 text-[12px] cursor-pointer border-r border-accent/14 transition-colors min-w-0 flex-shrink-0',
              isActive
                ? 'bg-background text-foreground'
                : 'text-foreground/65 hover:bg-foreground/5 hover:text-foreground',
            ].join(' ')}
            draggable
            onDragStart={() => (dragIndex.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex.current !== null && dragIndex.current !== i) {
                reorderFile(projectId, dragIndex.current, i)
              }
              dragIndex.current = null
            }}
            onClick={() => setActiveFile(projectId, file.path)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                closeWithConfirm(file)
              }
            }}
            title={file.path}
          >
            <FileIcon name={name} isDirectory={false} size={14} />
            <span className="truncate max-w-[180px]">{name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                closeWithConfirm(file)
              }}
              aria-label="Close file"
              className={[
                'flex items-center justify-center w-4 h-4 rounded text-foreground/45',
                dirty
                  ? 'opacity-100 hover:bg-foreground/10'
                  : 'opacity-0 group-hover/tab:opacity-100 hover:bg-foreground/10',
              ].join(' ')}
              title={dirty ? 'Unsaved changes — click to discard' : 'Close'}
            >
              {dirty ? (
                <span className="block w-1.5 h-1.5 rounded-full bg-accent" />
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
            </button>
            {isActive && (
              <span aria-hidden className="absolute bottom-0 left-0 right-0 h-px bg-foreground" />
            )}
          </div>
        )
      })}
    </div>
  )
}
