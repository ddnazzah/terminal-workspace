import { useEffect, useRef, useState } from 'react'
import type { DeviceFlowStart, GitHubSettings } from '@shared/types'
import { useGithub } from '@renderer/state/github'

interface Props {
  settings: GitHubSettings
}

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
  // Bumped on cancel/unmount so an in-flight devicePoll can't apply state or
  // reschedule after the loop it belongs to was abandoned.
  const pollGeneration = useRef(0)

  useEffect(() => {
    return () => {
      pollGeneration.current += 1
      if (pollTimer.current) window.clearTimeout(pollTimer.current)
    }
  }, [])

  const cancelDevice = () => {
    pollGeneration.current += 1
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
    const gen = pollGeneration.current
    pollTimer.current = window.setTimeout(async () => {
      if (pollGeneration.current !== gen) return
      try {
        const result = await window.api.github.devicePoll(deviceCode)
        if (pollGeneration.current !== gen) return
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
        if (pollGeneration.current !== gen) return
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
