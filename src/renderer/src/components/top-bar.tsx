import { isMac, isWindows } from '@renderer/lib/platform'
import { ProfileMenu } from './profile-menu'

interface Props {
  /** Current session label shown in the center input (project — terminal). */
  label: string
  onToggleSidebar: () => void
  onNewSession: () => void
  newSessionDisabled?: boolean
  /** Whether the Home terminal dock is open (drives the trigger's active state). */
  terminalOpen: boolean
  onToggleTerminal: () => void
  onOpenSettings: () => void
}

/**
 * Full-width top bar. Left: sidebar toggle. Center: a search-like input showing
 * the current session with a New action. Right: the Home-terminal trigger and
 * the GitHub profile.
 */
export function TopBar({
  label,
  onToggleSidebar,
  onNewSession,
  newSessionDisabled = false,
  terminalOpen,
  onToggleTerminal,
  onOpenSettings,
}: Props) {
  return (
    <header
      className={`app-titlebar relative flex items-center h-11 pr-3 gap-2 flex-shrink-0 ${
        isMac ? 'pl-20' : 'pl-1.5'
      } ${isWindows ? 'pr-[100px]' : ''}`}
    >
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        title="Toggle sidebar (⌘B)"
        className="flex items-center justify-center w-7 h-7 rounded-md text-foreground/55 hover:text-foreground hover:bg-foreground/10 transition-colors"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="9" y1="4" x2="9" y2="20" />
        </svg>
      </button>

      <div className="flex-1 flex justify-center min-w-0">
        <div className="flex items-center gap-2 h-7 w-full max-w-[480px] px-2.5 rounded-md bg-background/70">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-shrink-0 text-foreground/40">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            readOnly
            value={label}
            aria-label="Current session"
            className="flex-1 min-w-0 bg-transparent text-[12px] text-foreground/75 outline-none cursor-default truncate"
          />
          <button
            type="button"
            onClick={onNewSession}
            disabled={newSessionDisabled}
            aria-label="New session"
            title="New session (⌘T)"
            className="flex items-center gap-1 flex-shrink-0 h-5 pl-1 pr-1.5 rounded text-[11px] text-foreground/55 hover:text-foreground hover:bg-foreground/10 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={onToggleTerminal}
          aria-label="Toggle terminal"
          aria-pressed={terminalOpen}
          title="Terminal (⌘J)"
          className={[
            'flex items-center justify-center w-7 h-7 rounded-md transition-colors',
            terminalOpen
              ? 'text-foreground bg-foreground/10'
              : 'text-foreground/55 hover:text-foreground hover:bg-foreground/10',
          ].join(' ')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </button>

        <ProfileMenu onOpenSettings={onOpenSettings} />
      </div>
    </header>
  )
}
