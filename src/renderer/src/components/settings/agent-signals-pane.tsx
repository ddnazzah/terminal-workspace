import { useCallback, useEffect, useState } from 'react'
import { Button } from '@heroui/react'
import type { AgentHooksStatus } from '@shared/types'

/**
 * The switch behind wTerm's agent signals.
 *
 * Off, wTerm guesses what an agent is doing by reading its window title — which
 * is a spinner glyph and nothing more. On, Claude Code reports its own state:
 * turn started, blocked on permission, turn finished. That is the difference
 * between "something is happening" and knowing which session is waiting on you
 * and why.
 *
 * The copy is deliberate about the tradeoff, because turning this on edits a
 * file the user owns.
 */
export function AgentSignalsPane() {
  const [status, setStatus] = useState<AgentHooksStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.api.agent.getHooksStatus())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read agent hook status')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (action: () => Promise<AgentHooksStatus>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await action())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update Claude Code settings')
    } finally {
      setBusy(false)
    }
  }

  const installed = status?.installed ?? false

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-foreground/80">Claude Code signals</div>
          <div className="text-[12px] text-foreground/55">
            {installed ? 'Installed — agents report their own state' : 'Not installed'}
          </div>
        </div>
        <Button
          size="sm"
          isDisabled={busy || !status?.listening}
          onPress={() =>
            void run(
              installed ? window.api.agent.uninstallHooks : window.api.agent.installHooks
            )
          }
        >
          {installed ? 'Remove' : 'Install'}
        </Button>
      </div>

      <p className="text-[12px] leading-relaxed text-foreground/55">
        Adds four hooks to your Claude Code settings that tell wTerm when a turn starts, when
        an agent is waiting on your approval, and when it finishes. Without them wTerm reads
        the window title instead, which cannot tell a permission prompt from a finished turn.
      </p>
      <p className="text-[12px] leading-relaxed text-foreground/55">
        wTerm only ever adds or removes its own entries — your existing hooks are left alone,
        and the original file is copied to <code>settings.json.wterm-backup</code> before the
        first change. Removing it here puts everything back.
      </p>

      {status?.settingsPath ? (
        <p className="text-[12px] leading-relaxed text-foreground/45 break-all">
          {status.settingsPath}
        </p>
      ) : null}

      {status && !status.listening ? (
        <p className="text-[12px] leading-relaxed text-orange-400">
          The local listener didn&apos;t start, so hooks would have nowhere to report. Restart
          wTerm and try again.
        </p>
      ) : null}

      {(error ?? status?.error) ? (
        <p className="text-[12px] leading-relaxed text-red-400">{error ?? status?.error}</p>
      ) : null}
    </div>
  )
}
