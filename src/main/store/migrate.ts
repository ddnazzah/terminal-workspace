// Forward-only state migration.
//
// The contract that matters: a state file this build doesn't fully understand
// must still yield its projects. An older wTerm reading a newer state.json
// should lose *board features*, never the user's workspace — so an unknown
// version is normalised forward rather than rejected.

import { STATE_VERSION, type AppState, type Project } from '@shared/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((p) => ({
    ...(p as unknown as Project),
    terminals: Array.isArray(p.terminals) ? (p.terminals as Project['terminals']) : [],
  }))
}

/**
 * Normalise a parsed state.json into the current schema, or null when the input
 * isn't a usable state object at all (caller then starts fresh).
 */
export function migrateState(raw: unknown): AppState | null {
  if (!isRecord(raw)) return null
  if (typeof raw.version !== 'number') return null
  if (!Array.isArray(raw.projects)) return null

  const projects = normalizeProjects(raw.projects)

  // Active-tab selections referencing terminals that didn't survive would leave
  // a project pointing at a pane that never renders.
  const survivingIds = new Set(projects.flatMap((p) => p.terminals.map((t) => t.id)))
  const activeTerminalByProject = Object.fromEntries(
    Object.entries(isRecord(raw.activeTerminalByProject) ? raw.activeTerminalByProject : {}).filter(
      ([, id]) => typeof id === 'string' && survivingIds.has(id)
    )
  ) as AppState['activeTerminalByProject']

  return {
    ...(raw as unknown as AppState),
    version: STATE_VERSION,
    selectedProjectId: typeof raw.selectedProjectId === 'string' ? raw.selectedProjectId : null,
    projects,
    activeTerminalByProject,
    cards: Array.isArray(raw.cards) ? (raw.cards as AppState['cards']) : [],
    notes: Array.isArray(raw.notes) ? (raw.notes as AppState['notes']) : [],
    boardByProject: isRecord(raw.boardByProject)
      ? (raw.boardByProject as AppState['boardByProject'])
      : {},
  }
}
