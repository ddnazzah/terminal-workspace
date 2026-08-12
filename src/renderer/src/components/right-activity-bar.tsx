import { useWorkspace, type RightSidebarTab } from '@renderer/state/store'
import { isWindows, kbd } from '@renderer/lib/platform'

interface Props {
  onOpenSettings: () => void
  /** When true, panel-bound icons (files/git) are disabled — there's no project to inspect. */
  panelDisabled?: boolean
}

export function RightActivityBar({ onOpenSettings, panelDisabled = false }: Props) {
  const tab = useWorkspace((s) => s.rightSidebarTab)
  const setTab = useWorkspace((s) => s.setRightSidebarTab)
  const collapsed = useWorkspace((s) => s.rightSidebarCollapsed)
  const setCollapsed = useWorkspace((s) => s.setRightSidebarCollapsed)

  const onPanelClick = (clicked: RightSidebarTab): void => {
    if (panelDisabled) return
    if (collapsed) {
      setTab(clicked)
      setCollapsed(false)
      return
    }
    if (clicked === tab) {
      setCollapsed(true)
      return
    }
    setTab(clicked)
  }

  const isActive = (which: RightSidebarTab): boolean =>
    !panelDisabled && !collapsed && tab === which

  return (
    <aside
      className={`app-titlebar flex flex-col items-center justify-between gap-1 py-2 ${
        isWindows ? 'pt-12' : ''
      } w-11 flex-shrink-0 bg-surface`}
    >
      <div className="flex flex-col items-center gap-1">
        <ActivityButton
          active={isActive('files')}
          disabled={panelDisabled}
          onClick={() => onPanelClick('files')}
          label={isActive('files') ? 'Hide files panel' : 'Files'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </ActivityButton>
        <ActivityButton
          active={isActive('search')}
          disabled={panelDisabled}
          onClick={() => onPanelClick('search')}
          label={isActive('search') ? 'Hide search panel' : 'Search'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </ActivityButton>
        <ActivityButton
          active={isActive('git')}
          disabled={panelDisabled}
          onClick={() => onPanelClick('git')}
          label={isActive('git') ? 'Hide source control panel' : 'Source control'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
        </ActivityButton>
      </div>

      <div className="flex flex-col items-center gap-1">
        <ActivityButton onClick={onOpenSettings} label={`Settings (${kbd(',')})`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </ActivityButton>
      </div>
    </aside>
  )
}

function ActivityButton({
  active = false,
  disabled = false,
  onClick,
  label,
  children,
}: {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={[
        'relative flex items-center justify-center w-9 h-9 rounded-md transition-colors',
        disabled
          ? 'text-foreground/20 cursor-not-allowed'
          : active
            ? 'text-foreground bg-foreground/10'
            : 'text-foreground/55 hover:text-foreground hover:bg-foreground/10',
      ].join(' ')}
    >
      {children}
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-r bg-foreground"
        />
      )}
    </button>
  )
}
