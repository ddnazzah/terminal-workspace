import { useCallback, useEffect, useRef } from 'react'
import { useWorkspace } from '@renderer/state/store'
import { EditorShell } from './editor-shell'

interface Props {
  projectId: string
  onClose: () => void
}

export function ModalEditor({ projectId, onClose }: Props) {
  const width = useWorkspace((s) => s.fileModalWidth)
  const height = useWorkspace((s) => s.fileModalHeight)
  const setSize = useWorkspace((s) => s.setFileModalSize)
  const dragRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (document.querySelector('.monaco-editor .find-widget.visible')) return
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Re-fit when the window changes size — moving to another display, or
  // resizing the window, should not leave the modal stuck at the old geometry.
  useEffect(() => {
    const onResize = (): void => {
      setSize(width, height)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [width, height, setSize])

  const onResizeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { x: e.clientX, y: e.clientY, w: width, h: height }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [width, height])
  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    setSize(d.w + (e.clientX - d.x) * 2, d.h + (e.clientY - d.y) * 2)
  }, [setSize])
  const onResizeUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col rounded-lg border border-accent/20 shadow-2xl overflow-hidden"
        style={{ width, height, maxWidth: '94vw', maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <EditorShell projectId={projectId} onClose={onClose} />
        <div
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          role="separator"
          aria-label="Resize file window"
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{ touchAction: 'none' }}
        />
      </div>
    </div>
  )
}
