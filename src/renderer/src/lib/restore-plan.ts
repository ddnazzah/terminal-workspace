// Pure restore planning: persisted projects + settings in, one terminals.create
// call per persisted tab out. Every tab gets exactly one create — a tab that
// can't resume its agent comes back as a plain shell in its folder, never as a
// dead pane with no PTY behind it.

import type { CreateTerminalOptions, Project, TerminalRecord } from '@shared/types'
import {
  buildAgentResumeCommand,
  buildResumeCommand,
  isClaudeLaunch,
} from '@shared/claude-session'

export interface AgentRestoreRule {
  /** matched against the basename of the captured command's first token */
  match: string
  /** the command whose flags (after its program token) resume that agent */
  resume: string
}

export interface RestorePlanSettings {
  /** The user's configured startup command (Settings → Terminal), trimmed. */
  startupCommand?: string
  agentRestoreEnabled: boolean
  rules: AgentRestoreRule[]
}

/** The restore rule matching a captured command's program basename, if any. */
function ruleFor(command: string, rules: AgentRestoreRule[]): AgentRestoreRule | null {
  const first = command.trim().split(/\s+/)[0] ?? ''
  const base = first.split(/[/\\]/).pop() ?? first
  return rules.find((r) => r.match === base) ?? null
}

/** Project-relative cwd for a captured absolute agent cwd, or undefined (root). */
function relativeCwd(projectPath: string, cwd: string): string | undefined {
  const root = projectPath.replace(/[/\\]+$/, '')
  if (!cwd || cwd === root) return undefined
  if (cwd.startsWith(root + '/') || cwd.startsWith(root + '\\')) {
    return cwd.slice(root.length + 1) || undefined
  }
  return undefined // ran outside the project root → fall back to the root
}

function planTerminal(
  project: Project,
  terminal: TerminalRecord,
  settings: RestorePlanSettings
): CreateTerminalOptions {
  const base: CreateTerminalOptions = {
    projectId: project.id,
    id: terminal.id,
    name: terminal.name,
    cwd: terminal.agent ? relativeCwd(project.path, terminal.agent.cwd) : undefined,
    startupCommand: undefined,
  }

  // wTerm-owned session: resume by exact id. The captured command (when it
  // launched Claude) carries the flags the tab actually ran with; the
  // configured startup command is only a fallback.
  if (terminal.claudeSessionId) {
    const captured = terminal.agent?.command
    const flagsSource = isClaudeLaunch(captured) ? captured : settings.startupCommand
    return {
      ...base,
      resumeSessionId: terminal.claudeSessionId,
      startupCommand: buildResumeCommand(flagsSource, terminal.claudeSessionId),
    }
  }

  // Captured agent: rules gate revival; a sniffed session id upgrades the
  // folder-fuzzy resume to an exact one.
  if (terminal.agent && settings.agentRestoreEnabled) {
    const rule = ruleFor(terminal.agent.command, settings.rules)
    if (rule) {
      const sessionId = isClaudeLaunch(terminal.agent.command)
        ? terminal.agent.sessionId
        : undefined
      return {
        ...base,
        startupCommand: buildAgentResumeCommand(terminal.agent.command, rule.resume, sessionId),
      }
    }
  }

  // Plain shell (or unrevivable agent): recreate the shell in its folder.
  return base
}

/** One create call per persisted tab, in tab order, across all projects. */
export function planRestore(
  projects: Project[],
  settings: RestorePlanSettings
): CreateTerminalOptions[] {
  return projects.flatMap((project) =>
    project.terminals.map((terminal) => planTerminal(project, terminal, settings))
  )
}
