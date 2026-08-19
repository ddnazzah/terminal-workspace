import { useCallback } from 'react'
import { createProjectTerminal, useWorkspace } from '@renderer/state/store'
import type { Project } from '@shared/types'

export function useTerminals(project: Project | null) {
  const requestTerminalClose = useWorkspace((s) => s.requestTerminalClose)
  const renameTerminalLocal = useWorkspace((s) => s.renameTerminalLocal)
  const setActiveTerminal = useWorkspace((s) => s.setActiveTerminal)
  const activeId = useWorkspace((s) =>
    project ? s.activeTerminalByProject[project.id] ?? null : null
  )

  const create = useCallback(async () => {
    if (!project) return null
    return createProjectTerminal(project.id)
  }, [project])

  // Asks for confirmation rather than closing outright; the actual kill runs
  // through closeProjectTerminal once the user confirms (see app.tsx).
  const close = useCallback(
    (terminalId: string) => {
      if (!project) return
      requestTerminalClose(project.id, terminalId)
    },
    [project, requestTerminalClose]
  )

  const rename = useCallback(
    async (terminalId: string, name: string) => {
      if (!project) return
      renameTerminalLocal(project.id, terminalId, name)
      await window.api.terminals.rename(project.id, terminalId, name)
    },
    [project, renameTerminalLocal]
  )

  const setActive = useCallback(
    (terminalId: string | null) => {
      if (!project) return
      setActiveTerminal(project.id, terminalId)
    },
    [project, setActiveTerminal]
  )

  return {
    terminals: project?.terminals ?? [],
    activeId,
    create,
    close,
    rename,
    setActive,
  }
}
