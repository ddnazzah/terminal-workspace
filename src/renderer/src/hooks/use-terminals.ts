import { useCallback } from 'react'
import { createProjectTerminal, useWorkspace } from '@renderer/state/store'
import type { Project } from '@shared/types'

export function useTerminals(project: Project | null) {
  const removeTerminalLocal = useWorkspace((s) => s.removeTerminalLocal)
  const renameTerminalLocal = useWorkspace((s) => s.renameTerminalLocal)
  const setActiveTerminal = useWorkspace((s) => s.setActiveTerminal)
  const activeId = useWorkspace((s) =>
    project ? s.activeTerminalByProject[project.id] ?? null : null
  )

  const create = useCallback(async () => {
    if (!project) return null
    return createProjectTerminal(project.id)
  }, [project])

  const close = useCallback(
    async (terminalId: string) => {
      if (!project) return
      await window.api.terminals.kill(terminalId)
      window.api.terminals.removeRecord(project.id, terminalId)
      removeTerminalLocal(project.id, terminalId)
    },
    [project, removeTerminalLocal]
  )

  const rename = useCallback(
    async (terminalId: string, name: string, source: 'auto' | 'user' = 'user') => {
      if (!project) return
      renameTerminalLocal(project.id, terminalId, name, source)
      await window.api.terminals.rename(project.id, terminalId, name, source)
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
