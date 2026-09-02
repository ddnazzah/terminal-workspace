import { useCallback, useRef, type ReactNode } from 'react'
import { useWorkspace } from '@renderer/state/store'
import { EditorShell } from './editor-shell'

interface Props {
  projectId: string
  onClose: () => void
  children: ReactNode
}

export function DockedEditor({ projectId, onClose, children }: Props) {
  const ratio = useWorkspace((s) => s.dockSplitRatio)
  const setRatio = useWorkspace((s) => s.setDockSplitRatio)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)

  const onDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])
  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !hostRef.current) return
    const rect = hostRef.current.getBoundingClientRect()
    // `ratio` is the editor's fraction of the width; the editor sits on the
    // right, so dragging the divider left (toward the terminal) grows it.
    setRatio((rect.right - e.clientX) / rect.width)
  }, [setRatio])
  const onUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  return (
    <div ref={hostRef} className="flex flex-row h-full min-w-0">
      {/* A flex column, not a bare block: the terminal area sizes itself with
          `flex-1` and its panes are absolutely positioned, so a non-flex slot
          collapses it to a ~16px sliver and the split looks empty. */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="w-1 cursor-col-resize bg-accent/10 hover:bg-accent/30 transition-colors flex-shrink-0"
        style={{ touchAction: 'none' }}
      />
      <div style={{ flexBasis: `${ratio * 100}%` }} className="min-w-0 overflow-hidden flex-shrink-0">
        <EditorShell projectId={projectId} onClose={onClose} />
      </div>
    </div>
  )
}
