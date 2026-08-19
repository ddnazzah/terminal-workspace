import { useCallback, useRef } from 'react'
import { createProjectTerminal, useWorkspace } from '@renderer/state/store'
import { HOME_PROJECT_ID, type Project, type TerminalRecord } from '@shared/types'
import { TerminalPane } from './terminal-pane'
import { ActivityDot } from '../activity-dot'

interface Props {
  /** The synthesized Home workspace whose project-less terminals this dock hosts. */
  home: Project
  onBell: (project: Project, terminal: TerminalRecord, kind: 'bell' | 'attention') => void
}

/**
 * Bottom terminal dock for Home (project-less) terminals — the VS Code
 * integrated-terminal pattern. Resizable from its top edge, toggled via ⌘J, with
 * a right-side list of the open Home terminals (the "group"). Kept mounted while
 * collapsed (display:none) so the shells + scrollback survive; TerminalPane
 * refits via its ResizeObserver when the dock is shown again.
 */
export function BottomPanel({ home, onBell }: Props) {
  const open = useWorkspace((s) => s.bottomPanelOpen)
  const height = useWorkspace((s) => s.bottomPanelHeight)
  const setHeight = useWorkspace((s) => s.setBottomPanelHeight)
  const toggle = useWorkspace((s) => s.toggleBottomPanel)
  const activeId = useWorkspace((s) => s.activeTerminalByProject[HOME_PROJECT_ID] ?? null)
  const setActive = useWorkspace((s) => s.setActiveTerminal)
  const requestTerminalClose = useWorkspace((s) => s.requestTerminalClose)
  const titleByTerminal = useWorkspace((s) => s.titleByTerminal)
  const unreadByTerminal = useWorkspace((s) => s.unreadByTerminal)
  const busyByTerminal = useWorkspace((s) => s.busyByTerminal)
  const attentionByTerminal = useWorkspace((s) => s.attentionByTerminal)
  const attentionMetaByTerminal = useWorkspace((s) => s.attentionMetaByTerminal)

  const dragRef = useRef<{ y: number; h: number } | null>(null)

  const onResizeDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      dragRef.current = { y: e.clientY, h: height }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [height]
  )
  const onResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current
      if (!d) return
      // Drag up grows the dock.
      setHeight(d.h - (e.clientY - d.y))
    },
    [setHeight]
  )
  const onResizeUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const closeTerminal = (id: string): void => {
    requestTerminalClose(HOME_PROJECT_ID, id)
  }

  const terminals = home.terminals

  return (
    <div
      className={
        open
          ? 'relative flex flex-col rounded-lg bg-background overflow-hidden flex-shrink-0'
          : 'hidden'
      }
      style={open ? { height } : undefined}
    >
      <div
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
        className="group absolute top-0 left-0 right-0 h-1.5 -mt-0.5 cursor-row-resize z-10"
        style={{ touchAction: 'none' }}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-transparent group-hover:bg-foreground/30 transition-colors" />
      </div>

      <div className="flex items-center h-8 px-2 flex-shrink-0">
        <span className="text-[11px] uppercase tracking-wider text-foreground/55 font-medium px-1">
          Terminal
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void createProjectTerminal(HOME_PROJECT_ID)}
          aria-label="New terminal"
          title="New terminal"
          className="flex items-center justify-center w-6 h-6 rounded-md text-foreground/55 hover:text-foreground hover:bg-foreground/10 transition-colors text-base leading-none"
        >
          +
        </button>
        {activeId && (
          <button
            type="button"
            onClick={() => closeTerminal(activeId)}
            aria-label="Kill terminal"
            title="Kill active terminal"
            className="flex items-center justify-center w-6 h-6 rounded-md text-foreground/55 hover:text-foreground hover:bg-foreground/10 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label="Close panel"
          title="Close panel (⌘J)"
          className="flex items-center justify-center w-6 h-6 rounded-md text-foreground/55 hover:text-foreground hover:bg-foreground/10 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="@container relative flex-1 min-w-0 overflow-hidden">
          {terminals.map((t) => (
            <TerminalPane
              key={t.id}
              terminalId={t.id}
              active={open && t.id === activeId}
              onBell={(kind) => onBell(home, t, kind)}
            />
          ))}
          {terminals.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[12px] text-foreground/40">
              No terminals — click + to start one
            </div>
          )}
        </div>

        {terminals.length > 0 && (
          <div className="w-40 flex-shrink-0 overflow-y-auto py-1 px-1 flex flex-col gap-0.5">
            {terminals.map((t) => {
              const isActive = t.id === activeId
              const name = titleByTerminal[t.id] || t.name
              const unread = (unreadByTerminal[t.id] ?? 0) > 0
              const busy = !!busyByTerminal[t.id]
              const attention = !!attentionByTerminal[t.id]
              return (
                <div
                  key={t.id}
                  onClick={() => setActive(HOME_PROJECT_ID, t.id)}
                  className={[
                    'group/ht relative flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-md cursor-pointer transition-colors text-xs',
                    isActive
                      ? 'bg-foreground/8 text-foreground'
                      : 'text-foreground/65 hover:bg-foreground/5 hover:text-foreground',
                  ].join(' ')}
                  title={name}
                >
                  <ActivityDot
                    busy={busy}
                    attention={attention}
                    unread={unread}
                    meta={attentionMetaByTerminal[t.id]}
                  />
                  <span className={['flex-1 truncate', unread ? 'text-foreground font-medium' : ''].join(' ')}>
                    {name}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTerminal(t.id)
                    }}
                    aria-label={`Close ${name}`}
                    className="opacity-0 group-hover/ht:opacity-100 text-foreground/40 hover:text-foreground hover:bg-foreground/10 rounded-sm w-4 h-4 inline-flex items-center justify-center text-[11px] leading-none transition-opacity"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
