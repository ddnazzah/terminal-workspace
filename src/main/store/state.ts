import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  HOME_PROJECT_ID,
  STATE_VERSION,
  type AppState,
  type Project,
  type ProjectId,
  type TerminalRecord,
} from '@shared/types'
import { migrateState } from './migrate'

const SAVE_DEBOUNCE_MS = 500

/**
 * Ensure the synthesized "Home" workspace sits at the front of the project list.
 * Home holds project-less terminals, always exists, starts in the OS home dir,
 * and is stripped before persisting (see {@link writeFile}) so it never drifts,
 * duplicates, or leaks into state.json.
 */
function ensureHome(projects: Project[]): Project[] {
  if (projects.some((p) => p.id === HOME_PROJECT_ID)) return projects
  const home: Project = {
    id: HOME_PROJECT_ID,
    name: 'Home',
    path: app.getPath('home'),
    color: '#5ccfe6',
    terminals: [],
    isDefault: true,
  }
  return [home, ...projects]
}

let cache: AppState = {
  version: STATE_VERSION,
  selectedProjectId: null,
  projects: [],
  activeTerminalByProject: {},
  cards: [],
  notes: [],
  boardByProject: {},
}
let writeTimer: NodeJS.Timeout | null = null
let pendingWrite: Promise<void> | null = null

function statePath(): string {
  return join(app.getPath('userData'), 'state.json')
}

export async function loadState(): Promise<AppState> {
  try {
    const raw = await fs.readFile(statePath(), 'utf-8')
    // Every persisted tab is restorable: Claude sessions and captured agents
    // resume, and plain shells come back as plain shells — the workspace keeps
    // its shape (see renderer restore planning in lib/restore-plan.ts). Version
    // normalisation, including reading a file written by a newer build without
    // dropping the workspace, lives in migrate.ts.
    const migrated = migrateState(JSON.parse(raw))
    if (migrated) cache = migrated
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[state] failed to load:', err)
    }
  }
  cache.projects = ensureHome(cache.projects)
  return cache
}

export function getState(): AppState {
  return cache
}

/**
 * Listeners fired after every state mutation. The mobile bridge subscribes to
 * push the new full state to connected phone clients, so desktop-originated
 * changes (a terminal created at the desktop) reach the phone too. Kept separate
 * from the renderer's `state:changed` channel, which only carries
 * bridge-originated changes to avoid clobbering the desktop's optimistic updates.
 */
const changeListeners = new Set<() => void>()

export function onStateChange(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function notifyStateChange(): void {
  for (const listener of changeListeners) {
    try {
      listener()
    } catch (err) {
      console.error('[state] change listener failed:', err)
    }
  }
}

export function getProject(id: ProjectId): Project | undefined {
  return cache.projects.find((p) => p.id === id)
}

/** Find which project a terminal belongs to (for routing notifications/focus). */
export function getProjectIdForTerminal(terminalId: string): ProjectId | undefined {
  return cache.projects.find((p) => p.terminals.some((t) => t.id === terminalId))?.id
}

export function setState(next: AppState): void {
  cache = next
  scheduleSave()
  notifyStateChange()
}

export function mutate(fn: (draft: AppState) => void): AppState {
  fn(cache)
  scheduleSave()
  notifyStateChange()
  return cache
}

function scheduleSave(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    pendingWrite = writeFile()
  }, SAVE_DEBOUNCE_MS)
}

async function writeFile(): Promise<void> {
  const target = statePath()
  const tmp = `${target}.tmp`
  // Persist every project tab — Claude sessions and agents resume, plain shells
  // come back as plain shells, so the workspace keeps its shape across
  // restarts. The Home workspace is synthesized fresh each launch, never persisted.
  const projects = cache.projects.filter((p) => !p.isDefault)
  const survivingIds = new Set(projects.flatMap((p) => p.terminals.map((t) => t.id)))
  const activeTerminalByProject = Object.fromEntries(
    Object.entries(cache.activeTerminalByProject ?? {}).filter(
      ([, id]) => id != null && survivingIds.has(id)
    )
  )
  const persisted: AppState = { ...cache, projects, activeTerminalByProject }
  const json = JSON.stringify(persisted, null, 2)
  await fs.mkdir(join(target, '..'), { recursive: true }).catch(() => {})
  await fs.writeFile(tmp, json, 'utf-8')
  await fs.rename(tmp, target)
}

export async function saveStateNow(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (pendingWrite) await pendingWrite.catch(() => {})
  await writeFile()
}

export function upsertTerminal(projectId: ProjectId, terminal: TerminalRecord): void {
  mutate((s) => {
    const project = s.projects.find((p) => p.id === projectId)
    if (!project) return
    const existing = project.terminals.find((t) => t.id === terminal.id)
    if (existing) Object.assign(existing, terminal)
    else project.terminals.push(terminal)
  })
}

export function removeTerminal(projectId: ProjectId, terminalId: string): void {
  mutate((s) => {
    const project = s.projects.find((p) => p.id === projectId)
    if (!project) return
    project.terminals = project.terminals.filter((t) => t.id !== terminalId)
  })
}
