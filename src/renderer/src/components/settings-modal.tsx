import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useSettings, DEFAULTS } from '@renderer/state/settings'
import { useUpdates } from '@renderer/state/updates'
import { kbd } from '@renderer/lib/platform'
import type { BridgePairing, BridgeStatus } from '@shared/types'
import { AgentSignalsPane } from './settings/agent-signals-pane'

interface Props {
  open: boolean
  onClose: () => void
}

type CategoryId =
  | 'appearance'
  | 'terminal'
  | 'editor'
  | 'formatting'
  | 'mobile'
  | 'agents'
  | 'updates'
  | 'about'

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'editor', label: 'Editor' },
  { id: 'formatting', label: 'Formatting' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'agents', label: 'Agents' },
  { id: 'updates', label: 'Updates' },
  { id: 'about', label: 'About' },
]

export function SettingsModal({ open, onClose }: Props) {
  const [active, setActive] = useState<CategoryId>('appearance')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />
      <div
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-3xl h-[72vh] max-h-[680px] overflow-hidden rounded-2xl border border-foreground/15 bg-background shadow-2xl"
      >
        {/* Left category rail */}
        <nav className="flex w-44 flex-shrink-0 flex-col gap-0.5 border-r border-accent/14 bg-foreground/[0.025] p-3">
          <h2 className="px-2 pb-2 text-lg font-semibold tracking-tight text-foreground">Settings</h2>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActive(c.id)}
              className={[
                'rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors',
                active === c.id
                  ? 'bg-accent/15 text-foreground font-medium'
                  : 'text-foreground/65 hover:bg-foreground/5 hover:text-foreground',
              ].join(' ')}
            >
              {c.label}
            </button>
          ))}
        </nav>

        {/* Right content pane */}
        <div className="relative flex-1 min-w-0 flex flex-col">
          <header className="flex items-center justify-between px-7 py-4 border-b border-accent/14 flex-shrink-0">
            <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
              {CATEGORIES.find((c) => c.id === active)?.label}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="flex items-center justify-center w-8 h-8 rounded-md text-foreground/55 hover:text-foreground hover:bg-foreground/10"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-7 py-6">
            {active === 'appearance' && <AppearancePane />}
            {active === 'terminal' && <TerminalPane />}
            {active === 'editor' && <EditorPane />}
            {active === 'formatting' && <FormattingPane />}
            {active === 'mobile' && <MobilePane />}
            {active === 'agents' && <AgentSignalsPane />}
            {active === 'updates' && <UpdatesPane />}
            {active === 'about' && <AboutPane />}
          </div>
        </div>
      </div>
    </div>
  )
}

function AppearancePane() {
  const settings = useSettings((s) => s.editor)
  const update = useSettings((s) => s.updateEditor)
  return (
    <Pane>
      <NumberField
        label="Font size"
        value={settings.fontSize}
        min={9}
        max={28}
        step={1}
        unit="px"
        onChange={(v) => update({ fontSize: v })}
      />
      <Hint>Applies to the in-app code editor. Use {kbd('=')} / {kbd('-')} to zoom the whole window.</Hint>
      <Divider />
      <TextField
        label="Font family"
        value={settings.fontFamily}
        placeholder={DEFAULTS.fontFamily}
        onChange={(v) => update({ fontFamily: v || DEFAULTS.fontFamily })}
      />
    </Pane>
  )
}

function rulesToText(rules: { match: string; resume: string }[]): string {
  return rules.map((r) => `${r.match} = ${r.resume}`).join('\n')
}
function parseRules(text: string): { match: string; resume: string }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=')
      if (i === -1) return null
      return { match: l.slice(0, i).trim(), resume: l.slice(i + 1).trim() }
    })
    .filter((r): r is { match: string; resume: string } => !!r && !!r.match && !!r.resume)
}

function TerminalPane() {
  const startupCommand = useSettings((s) => s.terminal.startupCommand)
  const update = useSettings((s) => s.updateTerminal)
  const agentRestore = useSettings((s) => s.agentRestore)
  const updateAgentRestore = useSettings((s) => s.updateAgentRestore)
  const [rulesText, setRulesText] = useState(() => rulesToText(agentRestore.rules))
  return (
    <Pane>
      <FieldRowHeader
        label="Startup command"
        actionLabel={startupCommand ? 'Clear' : undefined}
        onAction={startupCommand ? () => update({ startupCommand: '' }) : undefined}
      />
      <TextAreaField
        value={startupCommand}
        placeholder="e.g. claude --dangerously-skip-permissions"
        onChange={(v) => update({ startupCommand: v })}
      />
      <Hint>
        Runs automatically in every new terminal tab once the shell is ready. Leave empty to disable
        (the default). Multiple lines run as separate commands.
      </Hint>

      <Divider />

      <BoolField
        label="Restore agent sessions on restart"
        value={agentRestore.enabled}
        onChange={(v) => updateAgentRestore({ enabled: v })}
      />
      <Hint>
        When you quit, wTerm remembers the agent running in each terminal and re-runs it in the same
        folder on the next launch (so it resumes, and your phone sees it too). Map a command to how
        it resumes — one <code className="text-foreground/75">name = resume command</code> per line.
        Only listed agents are restored.
      </Hint>
      <TextAreaField
        value={rulesText}
        placeholder={'claude = claude --continue\naider = aider'}
        onChange={(v) => {
          setRulesText(v)
          updateAgentRestore({ rules: parseRules(v) })
        }}
      />
    </Pane>
  )
}

function EditorPane() {
  const settings = useSettings((s) => s.editor)
  const update = useSettings((s) => s.updateEditor)
  const reset = useSettings((s) => s.resetEditor)
  return (
    <Pane>
      <div className="flex justify-end -mt-1">
        <button type="button" onClick={reset} className="text-[11px] text-foreground/50 hover:text-foreground">
          Reset to defaults
        </button>
      </div>
      <NumberField label="Tab size" value={settings.tabSize} min={1} max={8} step={1} onChange={(v) => update({ tabSize: v })} />
      <BoolField label="Insert spaces" value={settings.insertSpaces} onChange={(v) => update({ insertSpaces: v })} />
      <BoolField label="Word wrap" value={settings.wordWrap} onChange={(v) => update({ wordWrap: v })} />
      <BoolField label="Line numbers" value={settings.lineNumbers} onChange={(v) => update({ lineNumbers: v })} />
      <BoolField label="Minimap" value={settings.minimap} onChange={(v) => update({ minimap: v })} />
    </Pane>
  )
}

function FormattingPane() {
  const formatOnSave = useSettings((s) => s.editor.formatOnSave)
  const update = useSettings((s) => s.updateEditor)
  return (
    <Pane>
      <BoolField label="Format on save" value={formatOnSave} onChange={(v: boolean) => update({ formatOnSave: v })} />
      <Hint>
        Uses Prettier for JavaScript, TypeScript, JSON, CSS, HTML, Markdown, and YAML. Use{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/80 text-[11px]">{kbd('F', { shift: true })}</kbd>{' '}
        to format the active file on demand.
      </Hint>
    </Pane>
  )
}

function MobilePane() {
  const [pairing, setPairing] = useState<BridgePairing | null>(null)
  const [status, setStatus] = useState<BridgeStatus | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const keepAwake = useSettings((s) => s.mobile.keepAwake)
  const updateMobile = useSettings((s) => s.updateMobile)

  useEffect(() => {
    let alive = true
    void window.api.bridge.getPairing().then((p) => alive && setPairing(p))
    void window.api.bridge.getStatus().then((s) => alive && setStatus(s))
    const off = window.api.bridge.onStatus((s) => alive && setStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  // Main starts each launch with keep-awake off; push the persisted preference
  // so the blocker policy matches the toggle after a restart.
  useEffect(() => {
    void window.api.bridge.setKeepAwake(keepAwake)
  }, [keepAwake])

  const setKeepAwake = (v: boolean): void => {
    updateMobile({ keepAwake: v })
  }

  // Render the QR from the pair URL (origin + code) whenever it changes.
  useEffect(() => {
    if (!pairing?.pairUrl) {
      setQr(null)
      return
    }
    void QRCode.toDataURL(pairing.pairUrl, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(null))
  }, [pairing?.pairUrl])

  const regenerate = async (): Promise<void> => {
    setPairing(await window.api.bridge.regeneratePairing())
  }

  const origin = status?.tailscaleOrigin ?? null

  return (
    <Pane>
      <FieldRowHeader
        label="Notifications"
        actionLabel="Send test"
        onAction={() =>
          void window.api.system.notify({
            title: 'wTerm',
            body: 'Notifications are working',
            projectId: '',
            terminalId: '',
          })
        }
      />
      <Hint>
        wTerm alerts you when a backgrounded session needs input, finishes a long command, or a
        command fails. Nothing appeared after the test? Enable wTerm in System Settings ▸
        Notifications.
      </Hint>

      <Divider />

      <Hint>
        Continue working in your terminals from your phone. Pair once, then open the wTerm web app
        on your phone over your private Tailscale network.
      </Hint>
      <Divider />

      {/* Connection status */}
      <div className="flex items-center gap-3">
        <label className="text-[13px] text-foreground/80 flex-1">Bridge</label>
        <span className="flex items-center gap-2 text-[12px] text-foreground/60">
          <span
            className={[
              'inline-block h-2 w-2 rounded-full',
              status?.listening ? 'bg-emerald-400' : 'bg-foreground/30',
            ].join(' ')}
          />
          {status?.listening ? `listening · ${status.clients} phone${status.clients === 1 ? '' : 's'}` : 'off'}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-[13px] text-foreground/80 flex-1">Phone address</label>
        <span className="text-[12px] text-foreground/60 font-mono truncate max-w-[60%]">
          {origin ?? 'Tailscale not detected'}
        </span>
      </div>

      <Divider />

      {/* Pairing */}
      <div className="flex gap-6 items-start">
        <div className="flex flex-col gap-3 flex-1 min-w-0">
          <label className="text-[13px] text-foreground/80">Pairing code</label>
          <div className="font-mono text-3xl tracking-[0.3em] tabular-nums text-foreground">
            {pairing?.code ?? '······'}
          </div>
          <p className="text-[12px] leading-relaxed text-foreground/55">
            On your phone, open{' '}
            <span className="font-mono text-foreground/80">{origin ?? 'your Tailscale address'}</span>{' '}
            and enter this code, or scan the QR.
          </p>
          <button
            type="button"
            onClick={() => void regenerate()}
            className="self-start rounded-md bg-foreground/5 px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-foreground/10"
          >
            Regenerate code
          </button>
        </div>
        {qr && (
          <img
            src={qr}
            alt="Pairing QR code"
            width={120}
            height={120}
            className="rounded-lg border border-foreground/15 bg-white p-1"
          />
        )}
      </div>

      <Divider />

      <BoolField label="Keep this Mac awake while a phone is connected" value={keepAwake} onChange={setKeepAwake} />
      <Hint>
        Holds the system awake (the display can still sleep) only while a phone is actually
        connected, so your terminals stay reachable when you step out. No effect when nothing is
        connected.
      </Hint>

      {!origin && (
        <>
          <Divider />
          <div className="space-y-2">
            <label className="text-[13px] text-foreground/80">Set up Tailscale</label>
            <p className="text-[12px] leading-relaxed text-foreground/55">
              Install Tailscale on this computer and your phone, then expose the bridge over HTTPS by
              running this once in a terminal:
            </p>
            <code className="block rounded-md bg-foreground/5 px-3 py-2 text-[12px] font-mono text-foreground/80">
              tailscale serve --bg {status?.port ?? 8788}
            </code>
            <p className="text-[12px] leading-relaxed text-foreground/55">
              HTTPS is required for the phone app's notifications and install-to-home-screen.
            </p>
          </div>
        </>
      )}
    </Pane>
  )
}

function UpdatesPane() {
  const [version, setVersion] = useState<string | null>(null)
  const status = useUpdates((s) => s.status)
  const check = useUpdates((s) => s.check)
  const install = useUpdates((s) => s.install)

  useEffect(() => {
    let alive = true
    void window.api.system.getVersion().then((v) => {
      if (alive) setVersion(v)
    })
    return () => {
      alive = false
    }
  }, [])

  const busy = status.state === 'checking' || status.state === 'available' || status.state === 'downloading'

  return (
    <Pane>
      <div className="flex items-center gap-3">
        <label className="text-[13px] text-foreground/80 flex-1">Current version</label>
        <span className="text-[13px] text-foreground/60 tabular-nums">{version ? `v${version}` : '—'}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-foreground/55">{updateStatusLabel(status)}</span>
        {status.state === 'downloaded' ? (
          <button
            type="button"
            onClick={install}
            className="rounded-md bg-accent/90 px-3 py-1.5 text-[12px] font-medium text-background hover:bg-accent"
          >
            Restart to update
          </button>
        ) : (
          <button
            type="button"
            onClick={check}
            disabled={busy}
            className="rounded-md bg-foreground/5 px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-foreground/10 disabled:opacity-50 disabled:hover:bg-foreground/5"
          >
            {status.state === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </div>
    </Pane>
  )
}

function AboutPane() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.system.getVersion().then((v) => {
      if (alive) setVersion(v)
    })
    return () => {
      alive = false
    }
  }, [])
  return (
    <Pane>
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-foreground/80 flex-1">wTerm</span>
        <span className="text-[13px] text-foreground/60 tabular-nums">{version ? `v${version}` : ''}</span>
      </div>
      <Hint>Multi-project, multi-terminal workspace IDE.</Hint>
    </Pane>
  )
}

function updateStatusLabel(status: ReturnType<typeof useUpdates.getState>['status']): string {
  switch (status.state) {
    case 'idle':
      return 'Automatically checks for updates on launch.'
    case 'unsupported':
      return 'Updates apply to the installed app only.'
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Downloading v${status.version}…`
    case 'not-available':
      return "You're on the latest version."
    case 'downloading':
      return `Downloading v${status.version}… ${status.percent}%`
    case 'downloaded':
      return `v${status.version} downloaded — restart to apply.`
    case 'error':
      return `Update check failed: ${status.message}`
  }
}

// ---- primitives ----

function Pane({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">{children}</div>
}

function Divider() {
  return <div className="border-t border-accent/10" />
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-foreground/55">{children}</p>
}

function FieldRowHeader({
  label,
  actionLabel,
  onAction,
}: {
  label: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-[13px] text-foreground/80">{label}</label>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="text-[11px] text-foreground/50 hover:text-foreground">
          {actionLabel}
        </button>
      )}
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-[13px] text-foreground/80 flex-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
        }}
        className="w-24 bg-foreground/5 text-[13px] px-2.5 py-1.5 rounded-md outline-none focus:bg-foreground/10 text-right tabular-nums"
      />
      {unit && <span className="text-[12px] text-foreground/45 w-6">{unit}</span>}
    </div>
  )
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[13px] text-foreground/80">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="bg-foreground/5 text-[13px] px-2.5 py-1.5 rounded-md outline-none focus:bg-foreground/10 font-mono"
      />
    </div>
  )
}

function TextAreaField({
  value,
  placeholder,
  onChange,
}: {
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      rows={3}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y min-h-[72px] bg-foreground/5 text-[13px] px-2.5 py-2 rounded-md outline-none focus:bg-foreground/10 font-mono leading-relaxed"
    />
  )
}

function BoolField({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="text-[13px] text-foreground/80">{label}</span>
      <span
        role="switch"
        aria-checked={value}
        tabIndex={0}
        onClick={() => onChange(!value)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            onChange(!value)
          }
        }}
        className={[
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
          value ? 'bg-foreground/80' : 'bg-foreground/15',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-background transition-transform',
            value ? 'translate-x-4' : 'translate-x-0',
          ].join(' ')}
        />
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
    </label>
  )
}
