# Profile Dropdown & Terminal Title Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub profile dropdown to the top bar that owns the full auth flow (moving it out of the source-control panel), and keep terminal names in sync with the agent's latest task title.

**Architecture:** Feature 1 introduces a shared Zustand GitHub-settings store consumed by the new `ProfileMenu` (top bar) and the git panel; `GET /user`'s `avatar_url` is captured in main and exposed through `GitHubSettings`. Feature 2 adds `nameSource: 'auto' | 'user'` to `TerminalRecord`, an `isAgent` flag to activity payloads, and a pure `resolveAutoRename` decision function wired into the existing renderer activity subscription so busy agent titles persist as the terminal name (manual renames win).

**Tech Stack:** Electron (main/preload/renderer), React 19, Zustand, Tailwind, Vitest (node environment — pure-logic tests only, no component tests). Package manager is **pnpm** (never npm).

**Spec:** `docs/superpowers/specs/2026-07-09-profile-dropdown-and-title-sync-design.md`

**Verification commands used throughout:**
- Tests: `pnpm test` (or a single file: `pnpm vitest run <path>`)
- Types: `pnpm typecheck`
- Manual run: `pnpm dev`

---

### Task 1: Capture `avatar_url` for the authenticated GitHub user

**Files:**
- Modify: `src/shared/types.ts:308-317` (GitHubSettings)
- Modify: `src/main/github/auth.ts:5-9, 186-197` (StoredAuth, fetchAuthenticatedLogin → fetchAuthenticatedUser)
- Modify: `src/main/ipc/github.ts:21, 36-44, 164-171, 201-218` (import, settings mapper, setToken, devicePoll)
- Test: `src/main/github/auth.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `src/main/github/auth.test.ts` (it already mocks `electron` and `node:fs` at the top — the new block reuses those mocks). Add `afterEach` to the existing vitest import line:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
```

Append at the end of the file:

```ts
describe('fetchAuthenticatedUser', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('returns login and avatar url from GET /user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          login: 'ddnazzah',
          avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        }),
      })
    )
    const { fetchAuthenticatedUser } = await import('./auth')

    const user = await fetchAuthenticatedUser('tok')

    expect(user).toEqual({
      login: 'ddnazzah',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
    })
  })

  it('returns null avatar when the response omits avatar_url', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ login: 'x' }) })
    )
    const { fetchAuthenticatedUser } = await import('./auth')

    expect(await fetchAuthenticatedUser('tok')).toEqual({ login: 'x', avatarUrl: null })
  })

  it('returns null when the token is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const { fetchAuthenticatedUser } = await import('./auth')

    expect(await fetchAuthenticatedUser('bad')).toBeNull()
  })

  it('returns null when the response has no login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    const { fetchAuthenticatedUser } = await import('./auth')

    expect(await fetchAuthenticatedUser('tok')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/main/github/auth.test.ts`
Expected: 4 FAILS with `fetchAuthenticatedUser is not a function` (existing `getClientId` tests still PASS).

- [ ] **Step 3: Implement**

In `src/shared/types.ts`, extend `GitHubSettings` (currently lines 308-317):

```ts
export interface GitHubSettings {
  /** OAuth App client id used for device flow; null = device flow disabled */
  clientId: string | null
  /** true when a credential is stored (PAT or device-flow token) */
  hasToken: boolean
  /** authenticated user login (or null if not authenticated / unknown) */
  login: string | null
  /** how the token was obtained */
  source: 'pat' | 'device' | null
  /** avatar of the authenticated user; null for pre-existing sessions that signed in before it was captured */
  avatarUrl: string | null
}
```

In `src/main/github/auth.ts`, extend `StoredAuth` (optional so previously persisted blobs still parse):

```ts
export interface StoredAuth {
  token: string
  login: string | null
  source: 'pat' | 'device'
  avatarUrl?: string | null
}
```

Replace `fetchAuthenticatedLogin` (lines 186-197) with:

```ts
export interface AuthenticatedUser {
  login: string
  avatarUrl: string | null
}

export async function fetchAuthenticatedUser(token: string): Promise<AuthenticatedUser | null> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) return null
  const body = (await res.json()) as { login?: string; avatar_url?: string | null }
  if (!body.login) return null
  return { login: body.login, avatarUrl: body.avatar_url ?? null }
}
```

In `src/main/ipc/github.ts`:

1. In the import block from `'../github/auth'` (lines 18-26), replace `fetchAuthenticatedLogin` with `fetchAuthenticatedUser`.
2. Update the `settings()` mapper (lines 36-44):

```ts
async function settings(): Promise<GitHubSettings> {
  const [clientId, auth] = await Promise.all([getClientId(), getAuth()])
  return {
    clientId,
    hasToken: !!auth,
    login: auth?.login ?? null,
    source: auth?.source ?? null,
    avatarUrl: auth?.avatarUrl ?? null,
  }
}
```

3. Update the `setToken` handler (lines 164-171):

```ts
  ipcMain.handle(IPC.github.setToken, async (_e, token: string) => {
    const trimmed = token.trim()
    if (!trimmed) throw new Error('empty token')
    const user = await fetchAuthenticatedUser(trimmed)
    if (!user) throw new Error('token rejected by github')
    await setAuth({ token: trimmed, login: user.login, source: 'pat', avatarUrl: user.avatarUrl })
    return settings()
  })
```

4. Update the authorized branch of the `devicePoll` handler (lines 207-212):

```ts
      if (result.status === 'authorized') {
        const user = await fetchAuthenticatedUser(result.token)
        await setAuth({
          token: result.token,
          login: user?.login ?? null,
          source: 'device',
          avatarUrl: user?.avatarUrl ?? null,
        })
        pendingDevice.delete(deviceCode)
        return { status: 'authorized', login: user?.login ?? 'github' }
      }
```

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `pnpm vitest run src/main/github/auth.test.ts` → Expected: all PASS.
Run: `pnpm typecheck` → Expected: clean. (If `top-bar.tsx`/`git-panel.tsx` don't error here, nothing else consumed the removed function — they only use `getSettings()`.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/github/auth.ts src/main/ipc/github.ts src/main/github/auth.test.ts
git commit -m "feat(github): capture authenticated user's avatar_url in settings"
```

---

### Task 2: Shared GitHub-settings store (renderer)

**Files:**
- Create: `src/renderer/src/state/github.ts`
- Modify: `src/renderer/src/app.tsx` (mount-time refresh)
- Test: `src/renderer/src/state/github.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/state/github.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubSettings } from '@shared/types'

const SETTINGS: GitHubSettings = {
  clientId: 'Ov23example',
  hasToken: true,
  login: 'ddnazzah',
  source: 'device',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
}

function stubApi(getSettings: () => Promise<GitHubSettings>): void {
  vi.stubGlobal('window', { api: { github: { getSettings } } })
}

describe('useGithub', () => {
  // The store module is stateful; re-import per test for isolation.
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('starts with null settings', async () => {
    stubApi(vi.fn().mockResolvedValue(SETTINGS))
    const { useGithub } = await import('./github')

    expect(useGithub.getState().settings).toBeNull()
  })

  it('stores settings after refresh', async () => {
    stubApi(vi.fn().mockResolvedValue(SETTINGS))
    const { useGithub } = await import('./github')

    await useGithub.getState().refresh()

    expect(useGithub.getState().settings).toEqual(SETTINGS)
  })

  it('keeps the previous settings when refresh fails', async () => {
    const getSettings = vi
      .fn()
      .mockResolvedValueOnce(SETTINGS)
      .mockRejectedValueOnce(new Error('ipc down'))
    stubApi(getSettings)
    const { useGithub } = await import('./github')

    await useGithub.getState().refresh()
    await useGithub.getState().refresh()

    expect(useGithub.getState().settings).toEqual(SETTINGS)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/renderer/src/state/github.test.ts`
Expected: FAIL — cannot resolve `./github`.

- [ ] **Step 3: Implement the store**

Create `src/renderer/src/state/github.ts`:

```ts
import { create } from 'zustand'
import type { GitHubSettings } from '@shared/types'

interface GitHubState {
  /** null until the first refresh resolves. */
  settings: GitHubSettings | null
  /**
   * Re-fetch auth settings from main. Every auth mutation (sign in, sign out,
   * PAT/client-id save) funnels through this so all consumers stay in sync.
   * Keeps the last known value on failure.
   */
  refresh: () => Promise<void>
}

export const useGithub = create<GitHubState>((set) => ({
  settings: null,
  refresh: async () => {
    try {
      const settings = await window.api.github.getSettings()
      set({ settings })
    } catch (err) {
      console.error('[github] failed to load settings:', err)
    }
  },
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/renderer/src/state/github.test.ts` → Expected: 3 PASS.

- [ ] **Step 5: Load settings once on app mount**

In `src/renderer/src/app.tsx`, add the import:

```ts
import { useGithub } from './state/github'
```

and add this effect inside `App()`, right after the `useWindowZoom()` call (line 44):

```ts
  // Load GitHub auth state once; ProfileMenu and GitPanel both read this store.
  useEffect(() => {
    void useGithub.getState().refresh()
  }, [])
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck` → Expected: clean.

```bash
git add src/renderer/src/state/github.ts src/renderer/src/state/github.test.ts src/renderer/src/app.tsx
git commit -m "feat(github): shared renderer store for GitHub auth settings"
```

---

### Task 3: ProfileMenu + relocated sign-in flow in the top bar

**Files:**
- Create: `src/renderer/src/components/profile-sign-in.tsx` (adapted from `right-sidebar/github-auth.tsx`)
- Create: `src/renderer/src/components/profile-menu.tsx`
- Modify: `src/renderer/src/components/top-bar.tsx` (replace the avatar button; drop the local login fetch)

No unit tests: vitest runs in a node environment with no DOM (`include: ['src/**/*.test.ts']`), so these components are covered by the manual verification step and typecheck. All logic with branching (rename decisions, settings mapping) lives in tested pure modules.

- [ ] **Step 1: Create the sign-in component**

Create `src/renderer/src/components/profile-sign-in.tsx`. This is the signed-out portion of `right-sidebar/github-auth.tsx` (its `mode` state machine, device-flow polling, PAT and client-id forms are carried over unchanged) with two adaptations: it reports auth changes by refreshing the shared store instead of an `onAuthChanged` prop, and container styling suits the popover.

```tsx
import { useEffect, useRef, useState } from 'react'
import type { DeviceFlowStart, GitHubSettings } from '@shared/types'
import { useGithub } from '@renderer/state/github'

interface Props {
  settings: GitHubSettings
}

/**
 * Signed-out GitHub auth flow (device flow, PAT, OAuth client-id config),
 * hosted inside the profile dropdown. On success the shared store refreshes,
 * which flips the dropdown to its signed-in state.
 */
export function ProfileSignIn({ settings }: Props) {
  const refresh = useGithub((s) => s.refresh)
  const [mode, setMode] = useState<'choose' | 'pat' | 'device' | 'configure-client'>('choose')
  const [patValue, setPatValue] = useState('')
  const [clientIdValue, setClientIdValue] = useState(settings.clientId ?? '')
  const [device, setDevice] = useState<DeviceFlowStart | null>(null)
  const [pollStatus, setPollStatus] = useState<string>('Waiting for browser confirmation…')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current)
    }
  }, [])

  const cancelDevice = () => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current)
    pollTimer.current = null
    setDevice(null)
    setPollStatus('Waiting for browser confirmation…')
    setMode('choose')
  }

  const startDevice = async () => {
    setError(null)
    setBusy(true)
    try {
      const start = await window.api.github.deviceStart()
      setDevice(start)
      setMode('device')
      setBusy(false)
      poll(start.deviceCode, start.interval * 1000)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const poll = (deviceCode: string, intervalMs: number): void => {
    pollTimer.current = window.setTimeout(async () => {
      try {
        const result = await window.api.github.devicePoll(deviceCode)
        if (result.status === 'authorized') {
          setPollStatus(`Signed in as ${result.login}`)
          await refresh()
          return
        }
        if (result.status === 'pending') {
          setPollStatus('Waiting for browser confirmation…')
          poll(deviceCode, intervalMs)
          return
        }
        if (result.status === 'slow-down') {
          setPollStatus('Slowing down…')
          poll(deviceCode, result.interval * 1000)
          return
        }
        if (result.status === 'error') {
          setError(result.description ?? result.error)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }, intervalMs)
  }

  const submitPat = async () => {
    setError(null)
    setBusy(true)
    try {
      await window.api.github.setToken(patValue)
      setBusy(false)
      setPatValue('')
      await refresh()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const submitClientId = async () => {
    setError(null)
    setBusy(true)
    try {
      await window.api.github.setClientId(clientIdValue.trim() || null)
      setBusy(false)
      await refresh()
      setMode('choose')
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="p-3 space-y-3">
      <div className="text-[12px] text-foreground/70">
        Sign in to GitHub to see PRs and CI runs.
      </div>

      {mode === 'choose' && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={!settings.clientId || busy}
            onClick={startDevice}
            className="w-full text-[13px] py-2 rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={
              settings.clientId ? 'Sign in via github.com' : 'Set an OAuth App client id first'
            }
          >
            Sign in with GitHub
          </button>
          {!settings.clientId && (
            <button
              type="button"
              onClick={() => setMode('configure-client')}
              className="w-full text-[11px] text-foreground/55 hover:text-foreground"
            >
              Configure OAuth App client id…
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode('pat')}
            className="w-full text-[11px] py-1.5 rounded-md border border-foreground/15 text-foreground/75 hover:bg-foreground/5"
          >
            Use Personal Access Token
          </button>
          {settings.clientId && (
            <button
              type="button"
              onClick={() => setMode('configure-client')}
              className="w-full text-[10px] text-foreground/35 hover:text-foreground/70"
            >
              Change OAuth App client id
            </button>
          )}
        </div>
      )}

      {mode === 'configure-client' && (
        <div className="space-y-2">
          <div className="text-[11px] text-foreground/55">
            Paste the <span className="text-foreground/80">Client ID</span> of a GitHub OAuth App
            you own (Settings → Developer settings → OAuth Apps). Enable Device Flow on the app.
          </div>
          <input
            value={clientIdValue}
            onChange={(e) => setClientIdValue(e.target.value)}
            placeholder="Iv1.xxxxxxxxxxxxxxxx"
            spellCheck={false}
            className="w-full bg-foreground/5 text-[12px] px-2 py-1.5 rounded-md outline-none focus:bg-foreground/10"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitClientId}
              disabled={busy}
              className="flex-1 text-[12px] py-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setMode('choose')}
              className="flex-1 text-[12px] py-1.5 rounded-md border border-foreground/15 text-foreground/75 hover:bg-foreground/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'pat' && (
        <div className="space-y-2">
          <div className="text-[11px] text-foreground/55">
            Create a PAT at github.com → Settings → Developer settings → Personal access tokens
            with <span className="text-foreground/80">repo</span> and{' '}
            <span className="text-foreground/80">workflow</span> scopes.
          </div>
          <input
            value={patValue}
            onChange={(e) => setPatValue(e.target.value)}
            placeholder="ghp_..."
            type="password"
            spellCheck={false}
            className="w-full bg-foreground/5 text-[12px] px-2 py-1.5 rounded-md outline-none focus:bg-foreground/10"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitPat}
              disabled={busy || !patValue.trim()}
              className="flex-1 text-[12px] py-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
            >
              {busy ? 'Verifying…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setMode('choose')}
              className="flex-1 text-[12px] py-1.5 rounded-md border border-foreground/15 text-foreground/75 hover:bg-foreground/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'device' && device && (
        <div className="space-y-2">
          <div className="text-[11px] text-foreground/55">
            Your browser opened to github.com with the code pre-filled — just click{' '}
            <span className="text-foreground/80">Authorize</span>.
          </div>
          <div className="text-center text-xl font-mono tracking-widest py-2 rounded-md bg-foreground/5 select-all">
            {device.userCode}
          </div>
          <div className="text-[10px] text-foreground/40 text-center -mt-1">
            Fallback code if the page doesn&apos;t show it
          </div>
          <div className="text-[11px] text-foreground/50">{pollStatus}</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                void window.api.system.openExternal(device.verificationUriComplete)
              }
              className="flex-1 text-[11px] py-1 rounded-md border border-foreground/15 text-foreground/75 hover:bg-foreground/5"
            >
              Re-open browser
            </button>
            <button
              type="button"
              onClick={cancelDevice}
              className="flex-1 text-[11px] py-1 rounded-md border border-foreground/15 text-foreground/65 hover:bg-foreground/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-[11px] text-red-400 bg-red-500/10 rounded-md px-2 py-1">
          {error}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create the ProfileMenu component**

Create `src/renderer/src/components/profile-menu.tsx`:

```tsx
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
```

- [ ] **Step 3: Swap it into the top bar**

In `src/renderer/src/components/top-bar.tsx`:

1. Replace the react import (line 1) — `useEffect`/`useState` are no longer used:

```tsx
import { isMac, isWindows } from '@renderer/lib/platform'
import { ProfileMenu } from './profile-menu'
```

2. Delete the `login` state and its fetch effect (lines 30-37).
3. Replace the entire profile `<button>` (lines 108-128) with:

```tsx
        <ProfileMenu onOpenSettings={onOpenSettings} />
```

(`onOpenSettings` stays in `Props` — it now feeds the dropdown's Settings item.)

- [ ] **Step 4: Verify**

Run: `pnpm typecheck` → Expected: clean.
Run: `pnpm test` → Expected: all PASS.
Run: `pnpm dev` and check: avatar shows top-right (real GitHub avatar after a fresh sign-in; login-based fallback for an existing session); clicking opens the dropdown, not Settings; Escape and outside-click close it; Settings item opens the modal; Open GitHub profile opens the browser; Sign out flips the dropdown to the sign-in flow; signing back in (device flow) flips it back.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/profile-menu.tsx src/renderer/src/components/profile-sign-in.tsx src/renderer/src/components/top-bar.tsx
git commit -m "feat(profile): GitHub profile dropdown in the top bar"
```

---

### Task 4: Remove GitHubAuth from the git panel

**Files:**
- Modify: `src/renderer/src/components/right-sidebar/git-panel.tsx`
- Delete: `src/renderer/src/components/right-sidebar/github-auth.tsx`

- [ ] **Step 1: Confirm github-auth.tsx has no other consumers**

Run: `grep -rn "github-auth\|GitHubAuth" src/`
Expected: matches only in `git-panel.tsx` and `github-auth.tsx` itself. (If anything else imports it, stop and reassess.)

- [ ] **Step 2: Rewire GitPanel to the shared store**

In `src/renderer/src/components/right-sidebar/git-panel.tsx`:

1. Replace the imports (lines 1-5) with:

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { GitInfo, Project } from '@shared/types'
import { useGithub } from '@renderer/state/github'
import { PrSection } from './pr-section'
import { RunsSection } from './runs-section'
```

2. In the component body, replace the local settings state (line 12) with the store read, and simplify the load effect (lines 21-34) to git info only:

```tsx
export function GitPanel({ project }: Props) {
  const settings = useGithub((s) => s.settings)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<string | null>(null)

  const reloadGit = useCallback(async () => {
    setGitInfo(await window.api.git.info(project.id))
  }, [project.id])

  useEffect(() => {
    let cancelled = false
    window.api.git.info(project.id).then((g) => {
      if (!cancelled) setGitInfo(g)
    })
    return () => {
      cancelled = true
    }
  }, [project.id])
```

3. Replace `<GitHubAuth settings={settings} onAuthChanged={setSettings} />` (line 68) with a signed-out hint:

```tsx
      {!settings.hasToken && (
        <div className="px-3 py-2 border-b border-accent/7 text-[12px] text-foreground/55">
          Sign in from the profile menu (top right) to see PRs and CI runs.
        </div>
      )}
```

Everything else (`if (!settings) return Loading…`, GitStatusBar, PrSection/RunsSection gating) stays as is.

- [ ] **Step 3: Delete the old component**

```bash
git rm src/renderer/src/components/right-sidebar/github-auth.tsx
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck` → Expected: clean.
Run: `pnpm dev` → git panel signed in: no auth row, PRs/runs load as before. After Sign out from the dropdown: panel shows the hint (no reload needed — it reads the shared store).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/right-sidebar/git-panel.tsx
git commit -m "refactor(git-panel): account UI moved to the profile dropdown"
```

---

### Task 5: `isAgent` flag on activity payloads

**Files:**
- Modify: `src/shared/types.ts:92-97` (SessionActivityPayload)
- Modify: `src/main/pty/manager.ts:199-209` (onActivityChange)

`SessionActivityPayload` is constructed in exactly one place (`manager.ts:201`); `ActivityMachine`'s `mode` derivation is already covered by `src/main/pty/activity/activity-machine.test.ts`.

- [ ] **Step 1: Extend the type**

In `src/shared/types.ts`, replace lines 91-97 with:

```ts
/** Emitted by main when a session's detected activity changes. */
export type SessionActivityPayload = {
  id: TerminalId
  status: ActivityStatus
  title: string | null
  exitCode: number | null
  /** True when the title comes from an agent (Claude Code etc.), not a plain shell. */
  isAgent: boolean
}
```

- [ ] **Step 2: Populate it in the manager**

In `src/main/pty/manager.ts`, update the payload construction (lines 201-206):

```ts
    const payload: SessionActivityPayload = {
      id,
      status: next.status,
      title: next.title,
      exitCode: next.lastExitCode,
      isAgent: next.mode === 'agent',
    }
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck` → Expected: clean (the payload type flows through preload/renderer without other required changes).
Run: `pnpm test` → Expected: all PASS.

```bash
git add src/shared/types.ts src/main/pty/manager.ts
git commit -m "feat(activity): flag agent-originated titles on activity payloads"
```

---

### Task 6: `nameSource` on TerminalRecord + shared rename semantics

**Files:**
- Create: `src/shared/rename.ts`
- Modify: `src/shared/types.ts:13-34` (TerminalRecord)
- Modify: `src/main/ipc/terminal.ts:43-58, 88-92, 129-134` (restore path, renameTerminal, IPC handler)
- Modify: `src/preload/index.ts:62-63` (rename signature)
- Modify: `src/renderer/src/state/store.ts:220, 629-640` (renameTerminalLocal)
- Modify: `src/renderer/src/hooks/use-terminals.ts:28-35` (rename)
- Modify: `src/renderer/src/components/sidebar/terminal-sidebar-item.tsx:41-46` (empty-rename escape hatch)
- Test: `src/shared/rename.test.ts`

- [ ] **Step 1: Add `nameSource` to the record type**

In `src/shared/types.ts`, inside `TerminalRecord` (after `shell: string`, line 16), add:

```ts
  /**
   * Who owns the current name. 'user' = set by an explicit manual rename and
   * protected from auto-naming. 'auto' (or unset, for records persisted before
   * this field existed) = eligible to be overwritten by the agent's task title.
   */
  nameSource?: 'auto' | 'user'
```

- [ ] **Step 2: Write the failing tests**

Create `src/shared/rename.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyRename } from './rename'
import type { TerminalRecord } from './types'

const record = (overrides: Partial<TerminalRecord> = {}): TerminalRecord => ({
  id: 't1',
  name: 'Terminal 1',
  shell: '/bin/zsh',
  ...overrides,
})

describe('applyRename', () => {
  it('user rename sets the name and marks it user-owned', () => {
    const next = applyRename(record(), 'My tab', 'user')

    expect(next.name).toBe('My tab')
    expect(next.nameSource).toBe('user')
  })

  it('auto rename sets the name and keeps it auto-owned', () => {
    const next = applyRename(record(), 'Fixing the login bug', 'auto')

    expect(next.name).toBe('Fixing the login bug')
    expect(next.nameSource).toBe('auto')
  })

  it('trims surrounding whitespace', () => {
    expect(applyRename(record(), '  padded  ', 'user').name).toBe('padded')
  })

  it('empty user rename keeps the name but resets ownership to auto', () => {
    const next = applyRename(record({ name: 'Kept', nameSource: 'user' }), '', 'user')

    expect(next.name).toBe('Kept')
    expect(next.nameSource).toBe('auto')
  })

  it('empty auto rename is a no-op', () => {
    const original = record({ name: 'Kept', nameSource: 'auto' })

    expect(applyRename(original, '   ', 'auto')).toBe(original)
  })

  it('does not mutate the input record', () => {
    const original = record()
    applyRename(original, 'Changed', 'user')

    expect(original.name).toBe('Terminal 1')
    expect(original.nameSource).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/shared/rename.test.ts`
Expected: FAIL — cannot resolve `./rename`.

- [ ] **Step 4: Implement the shared helper**

Create `src/shared/rename.ts`:

```ts
import type { TerminalRecord } from './types'

export type NameSource = 'auto' | 'user'

/**
 * Resolve a rename against a terminal record. Shared by the main-process store
 * and the renderer's local mirror so both sides apply identical semantics:
 *
 * - Non-empty name: adopt it and record who set it.
 * - Empty name from the user: keep the current name but reset ownership to
 *   'auto' — the escape hatch that re-enables auto-naming after a manual rename.
 * - Empty name from auto: no-op (auto-naming never blanks a name).
 *
 * Returns the input record unchanged (same reference) when nothing applies.
 */
export function applyRename(
  record: TerminalRecord,
  name: string,
  source: NameSource
): TerminalRecord {
  const trimmed = name.trim()
  if (!trimmed) {
    return source === 'user' ? { ...record, nameSource: 'auto' } : record
  }
  return { ...record, name: trimmed, nameSource: source }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/shared/rename.test.ts` → Expected: 6 PASS.

- [ ] **Step 6: Thread the source through main**

In `src/main/ipc/terminal.ts`:

1. Add the import:

```ts
import { applyRename, type NameSource } from '@shared/rename'
```

2. Replace `renameTerminal` (lines 88-92):

```ts
export function renameTerminal(
  projectId: ProjectId,
  id: TerminalId,
  name: string,
  source: NameSource = 'user'
): void {
  const project = getProject(projectId)
  const t = project?.terminals.find((x) => x.id === id)
  if (!project || !t) return
  const next = applyRename(t, name, source)
  if (next !== t) upsertTerminal(project.id, next)
}
```

3. Update the IPC handler (lines 129-134):

```ts
  ipcMain.handle(
    IPC.terminals.rename,
    (_e, projectId: string, id: string, name: string, source?: NameSource): void => {
      renameTerminal(projectId, id, name, source ?? 'user')
    }
  )
```

4. Preserve ownership on the restore path — in `createTerminal`'s resume branch (lines 45-50), add `nameSource` to the rebuilt record:

```ts
    const record: TerminalRecord = {
      id: opts.id,
      name: existing?.name ?? opts.name ?? `Terminal ${project.terminals.length + 1}`,
      shell: existing?.shell ?? shell,
      claudeSessionId: opts.resumeSessionId,
      ...(existing?.nameSource ? { nameSource: existing.nameSource } : {}),
    }
```

- [ ] **Step 7: Thread the source through preload**

In `src/preload/index.ts`, update the terminals `rename` entry (lines 62-63):

```ts
    rename: (
      projectId: string,
      id: string,
      name: string,
      source: 'auto' | 'user' = 'user'
    ): Promise<void> => ipcRenderer.invoke(IPC.terminals.rename, projectId, id, name, source),
```

- [ ] **Step 8: Thread the source through the renderer store and hook**

In `src/renderer/src/state/store.ts`:

1. Add the import:

```ts
import { applyRename, type NameSource } from '@shared/rename'
```

2. Update the interface declaration (line 220):

```ts
  renameTerminalLocal: (
    projectId: ProjectId,
    terminalId: TerminalId,
    name: string,
    source?: NameSource
  ) => void
```

3. Replace the implementation (lines 629-640):

```ts
  renameTerminalLocal: (projectId, terminalId, name, source = 'user') =>
    set((state) => {
      // A manual rename should show immediately, so it clears the live agent
      // title (which has display priority). Auto-renames come *from* that
      // title and must leave it alone.
      let titleByTerminal = state.titleByTerminal
      if (source === 'user') {
        const { [terminalId]: _omittedTitle, ...titleRest } = state.titleByTerminal
        titleByTerminal = titleRest
      }
      return {
        projects: state.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                terminals: p.terminals.map((t) =>
                  t.id === terminalId ? applyRename(t, name, source) : t
                ),
              }
            : p
        ),
        titleByTerminal,
      }
    }),
```

In `src/renderer/src/hooks/use-terminals.ts`, replace `rename` (lines 28-35):

```ts
  const rename = useCallback(
    async (terminalId: string, name: string, source: 'auto' | 'user' = 'user') => {
      if (!project) return
      renameTerminalLocal(project.id, terminalId, name, source)
      await window.api.terminals.rename(project.id, terminalId, name, source)
    },
    [project, renameTerminalLocal]
  )
```

- [ ] **Step 9: Empty-rename escape hatch in the sidebar item**

In `src/renderer/src/components/sidebar/terminal-sidebar-item.tsx`, replace `commit` (lines 41-46):

```ts
  const commit = (): void => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== terminal.name) {
      onRename(trimmed)
      return
    }
    // Clearing a manually-set name re-enables auto-naming (name is kept until
    // the agent's next task title replaces it).
    if (!trimmed && terminal.nameSource === 'user') onRename('')
    setDraft(terminal.name)
  }
```

(`onRename` still has signature `(name: string) => void`; its providers call `useTerminals.rename`, which defaults to `source: 'user'` — an empty user rename resets ownership via `applyRename` without blanking the name.)

- [ ] **Step 10: Verify and commit**

Run: `pnpm test` → Expected: all PASS.
Run: `pnpm typecheck` → Expected: clean.

```bash
git add src/shared/rename.ts src/shared/rename.test.ts src/shared/types.ts src/main/ipc/terminal.ts src/preload/index.ts src/renderer/src/state/store.ts src/renderer/src/hooks/use-terminals.ts src/renderer/src/components/sidebar/terminal-sidebar-item.tsx
git commit -m "feat(terminals): track rename ownership with nameSource"
```

---

### Task 7: Auto-snapshot agent task titles into terminal names

**Files:**
- Create: `src/renderer/src/lib/auto-rename.ts`
- Modify: `src/renderer/src/app.tsx:92-112` (activity subscription)
- Test: `src/renderer/src/lib/auto-rename.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/lib/auto-rename.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SessionActivityPayload, TerminalRecord } from '@shared/types'
import { resolveAutoRename } from './auto-rename'

const payload = (overrides: Partial<SessionActivityPayload> = {}): SessionActivityPayload => ({
  id: 't1',
  status: 'busy',
  title: '✳ Fixing the login bug',
  exitCode: null,
  isAgent: true,
  ...overrides,
})

const terminal = (overrides: Partial<TerminalRecord> = {}): TerminalRecord => ({
  id: 't1',
  name: 'Terminal 1',
  shell: '/bin/zsh',
  ...overrides,
})

describe('resolveAutoRename', () => {
  it('returns the stripped task title for a busy agent', () => {
    expect(resolveAutoRename(payload(), terminal())).toBe('Fixing the login bug')
  })

  it('ignores plain shell titles', () => {
    expect(
      resolveAutoRename(payload({ isAgent: false, title: 'zsh — ~/Workspace' }), terminal())
    ).toBeNull()
  })

  it('ignores idle/attention agent titles (branding, not a task)', () => {
    expect(
      resolveAutoRename(payload({ status: 'attention', title: '✳ Claude Code' }), terminal())
    ).toBeNull()
    expect(
      resolveAutoRename(payload({ status: 'idle', title: '✳ Claude Code' }), terminal())
    ).toBeNull()
  })

  it('never touches a user-renamed terminal', () => {
    expect(resolveAutoRename(payload(), terminal({ nameSource: 'user' }))).toBeNull()
  })

  it('renames a terminal whose nameSource was reset to auto', () => {
    expect(resolveAutoRename(payload(), terminal({ nameSource: 'auto' }))).toBe(
      'Fixing the login bug'
    )
  })

  it('skips when the title matches the current name (dedupe)', () => {
    expect(
      resolveAutoRename(payload(), terminal({ name: 'Fixing the login bug' }))
    ).toBeNull()
  })

  it('skips null or spinner-only titles', () => {
    expect(resolveAutoRename(payload({ title: null }), terminal())).toBeNull()
    expect(resolveAutoRename(payload({ title: '✳ ·' }), terminal())).toBeNull()
  })

  it('skips when the terminal record is missing', () => {
    expect(resolveAutoRename(payload(), undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/renderer/src/lib/auto-rename.test.ts`
Expected: FAIL — cannot resolve `./auto-rename`.

- [ ] **Step 3: Implement the decision function**

Create `src/renderer/src/lib/auto-rename.ts`:

```ts
import type { SessionActivityPayload, TerminalRecord } from '@shared/types'
import { stripSpinner } from './terminal-title'

/**
 * Decide whether an activity payload should update the terminal's persistent
 * name. Returns the new name, or null to leave it alone.
 *
 * Only a *busy* agent title qualifies: busy titles carry the current task,
 * while idle/attention agent titles revert to product branding ("Claude Code")
 * and plain shell titles (cwd, program name) are not tasks at all. A terminal
 * the user renamed by hand ('user' nameSource) is never touched.
 */
export function resolveAutoRename(
  payload: SessionActivityPayload,
  terminal: TerminalRecord | undefined
): string | null {
  if (!terminal || terminal.nameSource === 'user') return null
  if (!payload.isAgent || payload.status !== 'busy' || !payload.title) return null
  const name = stripSpinner(payload.title).trim()
  if (!name || name === terminal.name) return null
  return name
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/renderer/src/lib/auto-rename.test.ts` → Expected: all PASS.

- [ ] **Step 5: Wire it into the activity subscription**

In `src/renderer/src/app.tsx`:

1. Add the import:

```ts
import { resolveAutoRename } from './lib/auto-rename'
```

2. In the `onActivity` effect (lines 95-112), add the snapshot after `setTerminalTitle`. The full updated effect:

```ts
  useEffect(() => {
    return window.api.terminals.onActivity((p) => {
      const s = useWorkspace.getState()
      // setTerminalBusy(true) also clears attention, so set busy first.
      s.setTerminalBusy(p.id, p.status === 'busy')
      s.setTerminalAttention(p.id, p.status === 'attention')
      s.setTerminalTitle(p.id, p.title ? stripSpinner(p.title) : '')

      // Keep the persistent name in sync with the agent's latest task so the
      // tab doesn't fall back to a stale name once the agent goes idle.
      const project = s.projects.find((proj) => proj.terminals.some((t) => t.id === p.id))
      const terminal = project?.terminals.find((t) => t.id === p.id)
      const nextName = terminal ? resolveAutoRename(p, terminal) : null
      if (project && terminal && nextName) {
        s.renameTerminalLocal(project.id, terminal.id, nextName, 'auto')
        window.api.terminals.rename(project.id, terminal.id, nextName, 'auto').catch((err) => {
          console.error('[terminals] auto-rename failed:', err)
        })
      }

      const prev = lastActivityStatusRef.current[p.id]
      lastActivityStatusRef.current[p.id] = p.status
      const selId = s.selectedProjectId
      const visibleId = selId ? s.activeTerminalByProject[selId] ?? null : null
      const visible = document.hasFocus() && p.id === visibleId
      if (visible) return
      const worthMarking = p.status === 'attention' || (prev === 'busy' && p.status === 'idle')
      if (worthMarking) s.bumpUnread(p.id)
    })
  }, [])
```

(The dedupe inside `resolveAutoRename` — new name must differ from `terminal.name` — keeps rename IPC calls to actual task changes, not every spinner frame.)

- [ ] **Step 6: Verify and commit**

Run: `pnpm test` → Expected: all PASS.
Run: `pnpm typecheck` → Expected: clean.

```bash
git add src/renderer/src/lib/auto-rename.ts src/renderer/src/lib/auto-rename.test.ts src/renderer/src/app.tsx
git commit -m "feat(terminals): terminal names follow the agent's latest task title"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full automated pass**

Run: `pnpm test` → Expected: all PASS.
Run: `pnpm typecheck` → Expected: clean (all three tsconfigs).

- [ ] **Step 2: Manual pass with `pnpm dev`**

Profile dropdown:
1. Signed in from a previous session → avatar renders top-right; dropdown shows login + OAuth/PAT tag, profile link, Settings, Sign out.
2. Sign out → button becomes the person icon; dropdown shows the sign-in flow; git panel shows the "Sign in from the profile menu" hint without reloading.
3. Sign in with GitHub (device flow) → browser opens, after authorizing the dropdown flips to signed-in and shows the **real** avatar (`avatarUrl` now persisted); git panel PRs/runs load.
4. Settings button in the right activity bar still opens the Settings modal.

Title sync:
1. Start Claude Code in a tab, give it a task → sidebar shows the live task title while busy; when the agent goes idle, the tab **keeps** the last task title (no fallback to "Terminal N").
2. Ask the agent to do a different task → the persisted name follows it.
3. Restart wTerm → the restored tab still carries the last task name.
4. Double-click-rename a tab to "mine" → subsequent agent tasks no longer change the persisted name (live title still shows while busy).
5. Double-click-rename that tab to empty → name stays "mine" until the agent's next task, which renames it again (auto-naming re-enabled).
6. A plain shell tab (no agent) never gets auto-renamed by cwd/program titles.

- [ ] **Step 3: Wrap up the branch**

Use the superpowers:finishing-a-development-branch skill to decide merge/PR handling.
