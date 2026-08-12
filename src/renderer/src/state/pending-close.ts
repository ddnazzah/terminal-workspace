import type { Project, ProjectId, TerminalId } from '@shared/types'

/**
 * A terminal awaiting close confirmation. The label is resolved and frozen when
 * the close is requested, so a title update mid-dialog can't rename the thing
 * the user is being asked about.
 */
export interface PendingTerminalClose {
  projectId: ProjectId
  terminalId: TerminalId
  label: string
}

/**
 * The name to show for a terminal in the close prompt: the agent-supplied title
 * when there is one, otherwise the tab's own name. Null when the terminal is
 * gone — there is nothing to confirm.
 */
export function resolveCloseLabel(
  projects: Project[],
  titleByTerminal: Record<TerminalId, string>,
  projectId: ProjectId,
  terminalId: TerminalId
): string | null {
  const terminal = projects
    .find((p) => p.id === projectId)
    ?.terminals.find((t) => t.id === terminalId)
  if (!terminal) return null
  return titleByTerminal[terminalId] || terminal.name
}

/**
 * Resolve the pending close after a terminal disappears. A shell can exit on
 * its own while the dialog is open, which would leave the dialog pointing at a
 * terminal that no longer exists; drop it in that case, keep it otherwise.
 */
export function pendingCloseAfterRemoval(
  pending: PendingTerminalClose | null,
  removed: { projectId: ProjectId; terminalId: TerminalId }
): PendingTerminalClose | null {
  if (!pending) return null
  const isSameTerminal =
    pending.projectId === removed.projectId && pending.terminalId === removed.terminalId
  return isSameTerminal ? null : pending
}
