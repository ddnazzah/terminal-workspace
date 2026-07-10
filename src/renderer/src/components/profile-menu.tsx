import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useGithub } from '@renderer/state/github'
import { ProfileSignIn } from './profile-sign-in'

interface Props {
  onOpenSettings: () => void
}

/**
 * Top-bar avatar button + profile dropdown. Owns the whole GitHub auth
 * lifecycle: signed out it hosts the sign-in flow, signed in it shows the
 * account, profile link, settings shortcut, and sign out.
 */
export function ProfileMenu({ onOpenSettings }: Props) {
  const settings = useGithub((s) => s.settings)
  const refresh = useGithub((s) => s.refresh)
  const [open, setOpen] = useState(false)
  // Index into avatar candidates; bumped past a source when its <img> errors.
  const [avatarAttempt, setAvatarAttempt] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const login = settings?.login ?? null
  // Fallback chain: stored avatarUrl → github.com/{login}.png → person icon.
  const avatarCandidates = [
    settings?.avatarUrl ?? null,
    login ? `https://github.com/${login}.png?size=44` : null,
  ].filter((src): src is string => !!src)
  const avatarSrc = avatarCandidates[avatarAttempt] ?? null
  const showAvatar = !!avatarSrc

  useEffect(() => setAvatarAttempt(0), [settings?.avatarUrl, login])

  const openProfile = (): void => {
    if (login) void window.api.system.openExternal(`https://github.com/${login}`)
    setOpen(false)
  }

  const openSettings = (): void => {
    onOpenSettings()
    setOpen(false)
  }

  const signOut = async (): Promise<void> => {
    try {
      await window.api.github.signOut()
    } catch (err) {
      console.error('[github] sign out failed:', err)
    }
    await refresh()
    setOpen(false)
  }

  const personIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  )

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={login ? `GitHub account: ${login}` : 'GitHub account'}
        aria-expanded={open}
        aria-haspopup="menu"
        title={login ? `GitHub: ${login}` : 'GitHub account'}
        className={[
          'flex items-center justify-center w-7 h-7 rounded-full overflow-hidden transition-colors',
          open
            ? 'text-foreground bg-foreground/10'
            : 'text-foreground/55 hover:text-foreground hover:bg-foreground/10',
        ].join(' ')}
      >
        {showAvatar ? (
          <img
            src={avatarSrc}
            alt={login ?? 'GitHub avatar'}
            className="w-[22px] h-[22px] rounded-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setAvatarAttempt((n) => n + 1)}
          />
        ) : (
          personIcon
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-64 rounded-lg border border-accent/10 bg-background shadow-xl z-50 overflow-hidden"
        >
          {!settings && (
            <div className="px-3 py-4 text-[11px] text-foreground/40">Loading…</div>
          )}

          {settings && !settings.hasToken && <ProfileSignIn settings={settings} />}

          {settings && settings.hasToken && (
            <>
              <div className="px-3 py-2.5 flex items-center gap-2.5 border-b border-accent/7">
                <span className="flex items-center justify-center w-8 h-8 rounded-full overflow-hidden bg-foreground/5 flex-shrink-0 text-foreground/55">
                  {showAvatar ? (
                    <img
                      src={avatarSrc ?? undefined}
                      alt={login ?? 'GitHub avatar'}
                      className="w-8 h-8 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarAttempt((n) => n + 1)}
                    />
                  ) : (
                    personIcon
                  )}
                </span>
                <div className="min-w-0">
                  <div className="text-[12px] text-foreground/90 truncate">
                    {settings.login ?? 'authenticated'}
                  </div>
                  <div className="text-[10px] text-foreground/45">
                    GitHub · {settings.source === 'device' ? 'OAuth' : 'PAT'}
                  </div>
                </div>
              </div>

              <div className="py-1">
                <MenuItem onClick={openProfile} disabled={!login}>
                  Open GitHub profile
                </MenuItem>
                <MenuItem onClick={openSettings} hint="⌘,">
                  Settings
                </MenuItem>
              </div>

              <div className="py-1 border-t border-accent/7">
                <MenuItem onClick={() => void signOut()} danger>
                  Sign out
                </MenuItem>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  onClick,
  children,
  hint,
  danger = false,
  disabled = false,
}: {
  onClick: () => void
  children: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={[
        'w-full flex items-center justify-between px-3 py-1.5 text-[12px] text-left transition-colors disabled:opacity-40',
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-foreground/80 hover:text-foreground hover:bg-foreground/5',
      ].join(' ')}
    >
      <span>{children}</span>
      {hint && <span className="text-[10px] text-foreground/35">{hint}</span>}
    </button>
  )
}
