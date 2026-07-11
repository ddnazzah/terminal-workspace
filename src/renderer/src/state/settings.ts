import { create } from 'zustand'

export interface EditorSettings {
  fontSize: number
  fontFamily: string
  tabSize: number
  insertSpaces: boolean
  wordWrap: boolean
  lineNumbers: boolean
  minimap: boolean
  /** Run prettier on save when supported. */
  formatOnSave: boolean
}

export const DEFAULTS: EditorSettings = {
  fontSize: 13,
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  tabSize: 2,
  insertSpaces: true,
  wordWrap: false,
  lineNumbers: true,
  minimap: true,
  formatOnSave: false,
}

export interface TerminalSettings {
  /**
   * Command (or multi-line script) run automatically in every new terminal tab.
   * Empty string = nothing runs (the default).
   */
  startupCommand: string
}

export const TERMINAL_DEFAULTS: TerminalSettings = {
  startupCommand: '',
}

export interface MobileSettings {
  /**
   * Keep the Mac awake while a phone is connected to the mobile bridge, so the
   * session stays reachable when you step out. The blocker is only held while at
   * least one phone is actually connected (it doesn't drain battery otherwise).
   */
  keepAwake: boolean
}

export const MOBILE_DEFAULTS: MobileSettings = {
  keepAwake: false,
}

export type { AgentRestoreRule } from '@renderer/lib/restore-plan'
import type { AgentRestoreRule } from '@renderer/lib/restore-plan'

export interface AgentRestoreSettings {
  /** Re-open agent terminals (claude, aider, ...) on restart, resumed. */
  enabled: boolean
  rules: AgentRestoreRule[]
}

export const AGENT_RESTORE_DEFAULTS: AgentRestoreSettings = {
  enabled: true,
  rules: [
    { match: 'claude', resume: 'claude --continue' },
    { match: 'cursor-agent', resume: 'cursor-agent --resume' },
    { match: 'aider', resume: 'aider' },
    { match: 'codex', resume: 'codex --continue' },
  ],
}

const STORAGE_KEY = 'tw:editor-settings'
const TERMINAL_STORAGE_KEY = 'tw:terminal-settings'
const MOBILE_STORAGE_KEY = 'tw:mobile-settings'
const AGENT_RESTORE_STORAGE_KEY = 'tw:agent-restore-settings'

function readStored(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<EditorSettings>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return DEFAULTS
  }
}

function persist(s: EditorSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // ignore
  }
}

function readStoredTerminal(): TerminalSettings {
  try {
    const raw = localStorage.getItem(TERMINAL_STORAGE_KEY)
    if (!raw) return TERMINAL_DEFAULTS
    const parsed = JSON.parse(raw) as Partial<TerminalSettings>
    return { ...TERMINAL_DEFAULTS, ...parsed }
  } catch {
    return TERMINAL_DEFAULTS
  }
}

function persistTerminal(s: TerminalSettings): void {
  try {
    localStorage.setItem(TERMINAL_STORAGE_KEY, JSON.stringify(s))
  } catch {
    // ignore
  }
}

function readStoredMobile(): MobileSettings {
  try {
    const raw = localStorage.getItem(MOBILE_STORAGE_KEY)
    if (!raw) return MOBILE_DEFAULTS
    const parsed = JSON.parse(raw) as Partial<MobileSettings>
    return { ...MOBILE_DEFAULTS, ...parsed }
  } catch {
    return MOBILE_DEFAULTS
  }
}

function persistMobile(s: MobileSettings): void {
  try {
    localStorage.setItem(MOBILE_STORAGE_KEY, JSON.stringify(s))
  } catch {
    // ignore
  }
}

function readStoredAgentRestore(): AgentRestoreSettings {
  try {
    const raw = localStorage.getItem(AGENT_RESTORE_STORAGE_KEY)
    if (!raw) return AGENT_RESTORE_DEFAULTS
    const parsed = JSON.parse(raw) as Partial<AgentRestoreSettings>
    return {
      enabled: parsed.enabled ?? AGENT_RESTORE_DEFAULTS.enabled,
      rules: Array.isArray(parsed.rules) ? parsed.rules : AGENT_RESTORE_DEFAULTS.rules,
    }
  } catch {
    return AGENT_RESTORE_DEFAULTS
  }
}

function persistAgentRestore(s: AgentRestoreSettings): void {
  try {
    localStorage.setItem(AGENT_RESTORE_STORAGE_KEY, JSON.stringify(s))
  } catch {
    // ignore
  }
}

interface SettingsState {
  editor: EditorSettings
  terminal: TerminalSettings
  mobile: MobileSettings
  agentRestore: AgentRestoreSettings
  updateEditor: (patch: Partial<EditorSettings>) => void
  resetEditor: () => void
  updateTerminal: (patch: Partial<TerminalSettings>) => void
  updateMobile: (patch: Partial<MobileSettings>) => void
  updateAgentRestore: (patch: Partial<AgentRestoreSettings>) => void
}

export const useSettings = create<SettingsState>((set) => ({
  editor: readStored(),
  terminal: readStoredTerminal(),
  mobile: readStoredMobile(),
  agentRestore: readStoredAgentRestore(),
  updateEditor: (patch) =>
    set((state) => {
      const next = { ...state.editor, ...patch }
      persist(next)
      return { editor: next }
    }),
  resetEditor: () =>
    set(() => {
      persist(DEFAULTS)
      return { editor: { ...DEFAULTS } }
    }),
  updateTerminal: (patch) =>
    set((state) => {
      const next = { ...state.terminal, ...patch }
      persistTerminal(next)
      return { terminal: next }
    }),
  updateMobile: (patch) =>
    set((state) => {
      const next = { ...state.mobile, ...patch }
      persistMobile(next)
      return { mobile: next }
    }),
  updateAgentRestore: (patch) =>
    set((state) => {
      const next = { ...state.agentRestore, ...patch }
      persistAgentRestore(next)
      return { agentRestore: next }
    }),
}))
