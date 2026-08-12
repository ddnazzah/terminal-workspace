import { useCallback, useEffect, useRef } from 'react'
import {
  RIGHT_SIDEBAR_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
  useWorkspace,
} from '@renderer/state/store'
import type { Project } from '@shared/types'
import { FileTree } from './file-tree'
import { GitPanel } from './git-panel'
import { SearchPanel } from './search-panel'

interface Props {
  project: Project
}

export function RightSidebar({ project }: Props) {
  const width = useWorkspace((s) => s.rightSidebarWidth)
  const setWidth = useWorkspace((s) => s.setRightSidebarWidth)
  const tab = useWorkspace((s) => s.rightSidebarTab)

  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(width)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      draggingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = width
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.style.cursor = 'col-resize'
    },
    [width]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      const delta = startXRef.current - e.clientX
      setWidth(startWidthRef.current + delta)
    },
    [setWidth]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      e.currentTarget.releasePointerCapture(e.pointerId)
      document.body.style.cursor = ''
    },
    []
  )

  useEffect(
    () => () => {
      document.body.style.cursor = ''
    },
    []
  )

  return (
    <aside
      className="relative flex flex-shrink-0 h-full"
      style={{ width, minWidth: RIGHT_SIDEBAR_MIN_WIDTH, maxWidth: RIGHT_SIDEBAR_MAX_WIDTH }}
    >
      <div className="flex flex-col h-full w-full rounded-lg bg-background overflow-hidden">
        <header className="app-titlebar h-11 flex items-center px-4">
          <span className="text-[10px] uppercase tracking-wider text-foreground/55 font-medium">
            {tab === 'files' ? 'Files' : tab === 'search' ? 'Search' : 'Source Control'}
          </span>
        </header>

        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === 'search' ? (
            <SearchPanel projectId={project.id} />
          ) : tab === 'files' ? (
            <FileTree project={project} />
          ) : (
            // Keyed so in-flight git work (e.g. a push) from a previous project
            // can never write its results into the next project's panel.
            <GitPanel key={project.id} project={project} />
          )}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right sidebar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="group absolute top-0 left-0 h-full w-1.5 -ml-0.5 cursor-col-resize z-10"
      >
        <div className="absolute inset-y-0 left-0 w-px bg-transparent group-hover:bg-foreground/30 transition-colors" />
      </div>
    </aside>
  )
}
