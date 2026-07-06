import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTheme } from '@renderer/lib/theme'

// POSIX single-quote shell escape — works for paths with spaces, ampersands,
// parentheses, etc. Embedded single quotes are bridged with `'\''`.
const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

// Clipboard shortcuts differ by platform: macOS uses ⌘C/⌘V, while terminals on
// Windows/Linux use Ctrl+Shift+C/V (plain Ctrl+C/V are SIGINT / literal-next).
const isMac = /Mac/i.test(navigator.userAgent)

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
}

const extForBlob = (b: { type: string; name?: string }): string => {
  const m = MIME_TO_EXT[b.type]
  if (m) return m
  const name = b.name
  if (name) {
    const dot = name.lastIndexOf('.')
    if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).toLowerCase()
  }
  return 'bin'
}

interface Props {
  terminalId: string
  active: boolean
  // 'attention' = the agent's turn finished and it wants your input (fires a
  // desktop notification). 'bell' = a raw terminal BEL — a generic unread cue
  // only, since editors/shells ring it during ordinary typing.
  onBell?: (kind: 'bell' | 'attention') => void
}

// Busy / attention / title detection now lives in the main process
// (src/main/pty/activity), which parses every session’s raw stream and pushes
// SessionActivity over `terminals:activity`. This component only renders the
// terminal; it no longer watches the window title or OSC 9;4 progress.

// xterm.js takes a JS object (not CSS), so we resolve the theme-aware tokens
// from `:root` at runtime. The other ANSI slots are theme-agnostic.
const readVar = (name: string, fallback: string): string => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const buildXtermTheme = () => ({
  background: readVar('--background', '#0b0b0f'),
  foreground: readVar('--foreground', '#e5e7eb'),
  cursor: readVar('--terminal-cursor', '#a78bfa'),
  cursorAccent: readVar('--background', '#0b0b0f'),
  selectionBackground: readVar('--terminal-selection', 'rgba(167,139,250,0.35)'),
  black: readVar('--ansi-black', '#1f2937'),
  red: readVar('--ansi-red', '#ef4444'),
  green: readVar('--ansi-green', '#10b981'),
  yellow: readVar('--ansi-yellow', '#f59e0b'),
  blue: readVar('--ansi-blue', '#3b82f6'),
  magenta: readVar('--ansi-magenta', '#ec4899'),
  cyan: readVar('--ansi-cyan', '#06b6d4'),
  white: readVar('--ansi-white', '#e5e7eb'),
  brightBlack: readVar('--ansi-bright-black', '#374151'),
  brightRed: readVar('--ansi-bright-red', '#f87171'),
  brightGreen: readVar('--ansi-bright-green', '#34d399'),
  brightYellow: readVar('--ansi-bright-yellow', '#fbbf24'),
  brightBlue: readVar('--ansi-bright-blue', '#60a5fa'),
  brightMagenta: readVar('--ansi-bright-magenta', '#f472b6'),
  brightCyan: readVar('--ansi-bright-cyan', '#22d3ee'),
  brightWhite: readVar('--ansi-bright-white', '#f9fafb'),
})

export function TerminalPane({ terminalId, active, onBell }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const initRef = useRef(false)
  const bellRef = useRef<typeof onBell>(onBell)
  bellRef.current = onBell

  useEffect(() => {
    if (!hostRef.current || initRef.current) return
    initRef.current = true

    const term = new Terminal({
      fontFamily:
        '"MesloLGS NF", "MesloLGS Nerd Font", "JetBrainsMono Nerd Font", "Hack Nerd Font", "Symbols Nerd Font", "Fira Code", Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowTransparency: true,
      allowProposedApi: true,
      scrollback: 10_000,
      theme: buildXtermTheme(),
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    // Cmd/Ctrl-click to open in the default browser; plain click is ignored so
    // it doesn't steal selection/scrollback interactions.
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        const mod = event.metaKey || event.ctrlKey
        if (!mod) return
        void window.api.system.openExternal(uri)
      })
    )

    // xterm tracks its own selection (overlay layer) but never copies it to the
    // OS clipboard on its own. Wire copy/paste explicitly. On macOS ⌘V is left
    // to xterm's textarea (native paste already works); elsewhere Ctrl+Shift+V
    // isn't handled by xterm, so we paste it ourselves.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const key = e.key.toLowerCase()
      const copyCombo = isMac ? e.metaKey && !e.shiftKey : e.ctrlKey && e.shiftKey
      if (key === 'c' && copyCombo && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        return false
      }
      if (key === 'v' && !isMac && e.ctrlKey && e.shiftKey) {
        void navigator.clipboard.readText().then((text) => {
          if (text) term.paste(text)
        })
        return false
      }
      return true
    })

    term.open(hostRef.current)
    termRef.current = term
    fitRef.current = fit

    // Glyphs are cached in a texture atlas at open() time; if the Nerd Font
    // wasn't loaded yet, the prompt's powerline/icon characters get baked into
    // the atlas as tofu. Explicitly load the font, then clearTextureAtlas() to
    // REBUILD the cache with the real glyphs (refresh() alone only repaints from
    // the stale atlas), refit (cell metrics may have changed), and repaint.
    void Promise.all([
      document.fonts.load('13px "MesloLGS NF"'),
      document.fonts.load('bold 13px "MesloLGS NF"'),
    ])
      .catch(() => undefined)
      .then(() => {
        if (termRef.current !== term) return
        try {
          term.clearTextureAtlas()
          fit.fit()
          term.refresh(0, term.rows - 1)
        } catch {
          // ignore — teardown race
        }
      })

    const fitNow = (): void => {
      try {
        fit.fit()
        const { cols, rows } = term
        void window.api.terminals.resize(terminalId, cols, rows)
      } catch {
        // ignore — happens during teardown
      }
    }
    fitNow()

    const onResize = (): void => fitNow()
    window.addEventListener('resize', onResize)

    const ro = new ResizeObserver(() => fitNow())
    ro.observe(hostRef.current)

    // Replay any output the PTY already produced before we mounted (initial
    // shell prompt, etc.) BEFORE attaching the live listener. attach() also
    // clears pending un-flushed chunks on the main side so they don't arrive
    // twice once the listener is up.
    let detached = false
    let offData: (() => void) | null = null
    void window.api.terminals.attach(terminalId).then((snapshot) => {
      if (detached) return
      if (snapshot) term.write(snapshot)
      offData = window.api.terminals.onData(({ id, data }) => {
        if (id === terminalId) term.write(data)
      })
    })

    const writeDisposable = term.onData((data) => {
      void window.api.terminals.write(terminalId, data)
    })

    const bellDisposable = term.onBell(() => {
      // A raw BEL fires on all sorts of keystrokes (empty backspace, hitting an
      // input boundary) while the program is idle, so it must NOT pop a "wants
      // your input" notification — it only marks the tab unread. The real
      // attention signal is the title working→idle edge below.
      bellRef.current?.('bell')
    })

    // OSC 52 — clipboard write. Lets terminal programs (e.g. vim/nvim with
    // clipboard=unnamed, especially over ssh) set the system clipboard. xterm
    // doesn't honor OSC 52 by default, so bridge it to the system clipboard here.
    // Format: `52 ; <selection> ; <base64>` (selection is c/p/etc; '?' = query).
    const osc52Disposable = term.parser.registerOscHandler(52, (data) => {
      const semi = data.indexOf(';')
      if (semi === -1) return false
      const payload = data.slice(semi + 1)
      if (payload === '?') return false // clipboard read query — not supported
      try {
        const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
        void navigator.clipboard.writeText(new TextDecoder().decode(bytes))
      } catch {
        // malformed base64 — ignore
      }
      return true
    })

    // OSC 697;Cmd;<b64 command>;<b64 cwd> — emitted by wTerm's shell integration
    // on every preexec. Tells main which agent command is running in this tab (and
    // where), so a tab running `claude`/`aider`/etc. can be re-launched after a
    // restart. The matching OSC 133;D (command finished) clears it.
    const decodeB64 = (b64: string): string =>
      new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    const osc697Disposable = term.parser.registerOscHandler(697, (data) => {
      if (!data.startsWith('Cmd;')) return false
      const parts = data.split(';')
      try {
        const command = decodeB64(parts[1] ?? '')
        const cwd = decodeB64(parts[2] ?? '')
        if (command.trim()) {
          void window.api.terminals.setRunningCommand(terminalId, { command, cwd })
        }
      } catch {
        // malformed base64 — ignore
      }
      return true
    })
    const osc133Disposable = term.parser.registerOscHandler(133, (data) => {
      // `D` (command finished) means the tab is back at the prompt — no agent.
      if (data[0] === 'D') {
        void window.api.terminals.setRunningCommand(terminalId, null)
      }
      return false // leave the marker for any other consumer
    })

    return () => {
      detached = true
      offData?.()
      writeDisposable.dispose()
      bellDisposable.dispose()
      osc52Disposable.dispose()
      osc697Disposable.dispose()
      osc133Disposable.dispose()
      ro.disconnect()
      window.removeEventListener('resize', onResize)
      term.dispose()
      termRef.current = null
      fitRef.current = null
      initRef.current = false
    }
  }, [terminalId])

  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        termRef.current?.focus()
        const term = termRef.current
        if (term) void window.api.terminals.resize(terminalId, term.cols, term.rows)
      } catch {
        // ignore
      }
    })
  }, [active, terminalId])

  const { theme } = useTheme()
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = buildXtermTheme()
  }, [theme])

  const [dragOver, setDragOver] = useState(false)
  const dragDepthRef = useRef(0)

  const insertPaths = useCallback((paths: string[]): void => {
    if (paths.length === 0) return
    const term = termRef.current
    if (!term) return
    const insert = paths.map(shellQuote).join(' ') + ' '
    // Use paste() so the data is wrapped in bracketed-paste sequences when the
    // running program enabled them. Claude Code (and other TUIs) rely on the
    // \e[200~/\e[201~ markers to recognize a path drop as an image attachment
    // rather than as typed input.
    term.paste(insert)
    term.focus()
  }, [])

  const savePastedFile = useCallback(
    async (file: File): Promise<string | null> => {
      const buf = new Uint8Array(await file.arrayBuffer())
      return window.api.fs.saveTempPaste(buf, extForBlob(file))
    },
    []
  )

  const onDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    dragDepthRef.current += 1
    setDragOver(true)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragOver(false)
  }, [])

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return
      e.preventDefault()
      dragDepthRef.current = 0
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return
      const paths: string[] = []
      for (const file of files) {
        // For files dragged from the OS this resolves to the real absolute
        // path. In-memory drops (e.g. drag-from-browser) return '' — fall back
        // to writing the bytes into our temp directory so the path is real.
        const native = window.api.fs.pathForFile(file)
        if (native) {
          paths.push(native)
        } else {
          const saved = await savePastedFile(file)
          if (saved) paths.push(saved)
        }
      }
      insertPaths(paths)
    },
    [insertPaths, savePastedFile]
  )

  const onPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>) => {
      const data = e.clipboardData
      // Collect image/file items. Plain text and rich-text pastes are left
      // alone so xterm's clipboard handling continues to work normally.
      const fileItems: File[] = []
      for (const item of Array.from(data.items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile()
          if (f) fileItems.push(f)
        }
      }
      if (fileItems.length === 0) return
      e.preventDefault()
      const paths: string[] = []
      for (const file of fileItems) {
        const native = window.api.fs.pathForFile(file)
        if (native) {
          paths.push(native)
        } else {
          const saved = await savePastedFile(file)
          if (saved) paths.push(saved)
        }
      }
      insertPaths(paths)
    },
    [insertPaths, savePastedFile]
  )

  return (
    <div
      className="absolute inset-0"
      style={{ visibility: active ? 'visible' : 'hidden' }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        void onDrop(e)
      }}
      onPaste={(e) => {
        void onPaste(e)
      }}
    >
      <div className="terminal-host h-full w-full" ref={hostRef} />
      {dragOver && (
        <div
          className="pointer-events-none absolute inset-2 rounded-lg border-2 border-dashed border-accent/70 bg-accent/10 flex items-center justify-center"
          aria-hidden
        >
          <div className="text-sm text-foreground/80 bg-background/80 px-3 py-1.5 rounded-md border border-accent/30">
            Drop to insert file path
          </div>
        </div>
      )}
    </div>
  )
}
