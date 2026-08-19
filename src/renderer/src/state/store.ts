import { create } from 'zustand'
import { decideExternalChange } from '@shared/external-change'
import { HOME_PROJECT_ID } from '@shared/types'
import type {
  AttentionReason,
  Project,
  ProjectId,
  TerminalId,
  TerminalRecord,
} from '@shared/types'
import {
  pendingCloseAfterRemoval,
  resolveCloseLabel,
  type PendingTerminalClose,
} from './pending-close'

/** Why a terminal is waiting on the user, and since when. */
export interface AttentionMeta {
  reason: AttentionReason | null
  detail: string | null
  changedAt: number
}
import { useSettings } from './settings'
import { modalSizeFor, clampModalSize } from '@renderer/lib/modal-size'

export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 480
export const SIDEBAR_DEFAULT_WIDTH = 256

export const RIGHT_SIDEBAR_MIN_WIDTH = 260
export const RIGHT_SIDEBAR_MAX_WIDTH = 640
export const RIGHT_SIDEBAR_DEFAULT_WIDTH = 340

const SIDEBAR_WIDTH_KEY = 'tw:sidebar-width'
const SIDEBAR_COLLAPSED_KEY = 'tw:sidebar-collapsed'
const RIGHT_SIDEBAR_WIDTH_KEY = 'tw:right-sidebar-width'
const RIGHT_SIDEBAR_COLLAPSED_KEY = 'tw:right-sidebar-collapsed'
const BOTTOM_PANEL_OPEN_KEY = 'tw:bottom-panel-open'
const BOTTOM_PANEL_HEIGHT_KEY = 'tw:bottom-panel-height'
const RIGHT_SIDEBAR_TAB_KEY = 'tw:right-sidebar-tab'
const FILE_MODAL_SIZE_KEY = 'tw:file-modal-size'
const EDITOR_VIEW_MODE_KEY = 'tw:editor-view-mode'
const DOCK_SPLIT_KEY = 'tw:dock-split-ratio'

export type EditorViewMode = 'docked' | 'modal' | 'fullscreen'

const readEditorViewMode = (): EditorViewMode => {
  const raw = localStorage.getItem(EDITOR_VIEW_MODE_KEY)
  return raw === 'modal' || raw === 'fullscreen' || raw === 'docked' ? raw : 'modal'
}

const readDockSplitRatio = (): number => {
  const n = Number.parseFloat(localStorage.getItem(DOCK_SPLIT_KEY) ?? '')
  return Number.isFinite(n) && n > 0.15 && n < 0.85 ? n : 0.6
}

const readInitialFileModalSize = (): { width: number; height: number } => {
  let saved: { width: number; height: number } | null = null
  try {
    const raw = localStorage.getItem(FILE_MODAL_SIZE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { width: number; height: number }
      if (parsed?.width && parsed?.height) saved = parsed
    }
  } catch {
    // ignore
  }

  // Proportional to the viewport rather than a fixed 900x600, so a larger
  // display gets a larger editor. A saved size is respected but clamped to
  // fit, and grown when it is a leftover from a much smaller screen.
  return modalSizeFor({ width: window.innerWidth, height: window.innerHeight }, saved)
}

export type RightSidebarTab = 'files' | 'git' | 'search'

export interface OpenedFile {
  projectId: string
  path: string
}

export type FileTabKey = string // `${projectId}::${path}`
export const tabKey = (f: OpenedFile): FileTabKey => `${f.projectId}::${f.path}`

export type FileLoadState =
  | { kind: 'loading' }
  | {
      kind: 'text'
      current: string
      saved: string
      /**
       * Set when the file changed on disk while this tab had unsaved edits.
       * The user's text is kept; they choose whether to discard it.
       */
      conflictWith?: string | null
    }
  | { kind: 'binary' }
  | { kind: 'error'; message: string }

const clampSidebarWidth = (w: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(w)))

const clampRightSidebarWidth = (w: number): number =>
  Math.min(RIGHT_SIDEBAR_MAX_WIDTH, Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.round(w)))

const readInitialSidebarWidth = (): number => {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    const n = raw ? Number.parseInt(raw, 10) : NaN
    return Number.isFinite(n) ? clampSidebarWidth(n) : SIDEBAR_DEFAULT_WIDTH
  } catch {
    return SIDEBAR_DEFAULT_WIDTH
  }
}

const readInitialSidebarCollapsed = (): boolean => {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

const readInitialRightSidebarWidth = (): number => {
  try {
    const raw = localStorage.getItem(RIGHT_SIDEBAR_WIDTH_KEY)
    const n = raw ? Number.parseInt(raw, 10) : NaN
    return Number.isFinite(n) ? clampRightSidebarWidth(n) : RIGHT_SIDEBAR_DEFAULT_WIDTH
  } catch {
    return RIGHT_SIDEBAR_DEFAULT_WIDTH
  }
}

const readInitialRightSidebarCollapsed = (): boolean => {
  try {
    // default to OPEN; explicit '1' means collapsed
    return localStorage.getItem(RIGHT_SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export const BOTTOM_PANEL_MIN_HEIGHT = 120
export const BOTTOM_PANEL_MAX_HEIGHT = 800
const BOTTOM_PANEL_DEFAULT_HEIGHT = 260

const clampBottomPanelHeight = (h: number): number =>
  Math.min(BOTTOM_PANEL_MAX_HEIGHT, Math.max(BOTTOM_PANEL_MIN_HEIGHT, Math.round(h)))

const readInitialBottomPanelHeight = (): number => {
  try {
    const raw = localStorage.getItem(BOTTOM_PANEL_HEIGHT_KEY)
    const n = raw ? Number.parseInt(raw, 10) : NaN
    return Number.isFinite(n) ? clampBottomPanelHeight(n) : BOTTOM_PANEL_DEFAULT_HEIGHT
  } catch {
    return BOTTOM_PANEL_DEFAULT_HEIGHT
  }
}

const readInitialBottomPanelOpen = (): boolean => {
  try {
    // default to CLOSED; explicit '1' means open
    return localStorage.getItem(BOTTOM_PANEL_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

const readInitialRightSidebarTab = (): RightSidebarTab => {
  try {
    const raw = localStorage.getItem(RIGHT_SIDEBAR_TAB_KEY)
    return raw === 'git' || raw === 'search' ? raw : 'files'
  } catch {
    return 'files'
  }
}

interface WorkspaceState {
  projects: Project[]
  selectedProjectId: ProjectId | null
  activeTerminalByProject: Record<ProjectId, TerminalId | null>
  expandedProjectIds: Record<ProjectId, boolean>
  unreadByTerminal: Record<TerminalId, number>
  titleByTerminal: Record<TerminalId, string>
  busyByTerminal: Record<TerminalId, boolean>
  /** Terminals whose agent finished a turn and is waiting on the user (red cue). */
  attentionByTerminal: Record<TerminalId, boolean>
  /**
   * Why each waiting terminal is waiting, and since when — only a first-party
   * agent hook can say (see main/agent). Absent for sessions detected from
   * window titles alone, so the indicator treats it as optional.
   */
  attentionMetaByTerminal: Record<TerminalId, AttentionMeta>
  /** Terminal awaiting close confirmation; null when no dialog is open. */
  pendingTerminalClose: PendingTerminalClose | null

  sidebarWidth: number
  sidebarCollapsed: boolean
  setSidebarWidth: (width: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void

  rightSidebarWidth: number
  rightSidebarCollapsed: boolean
  /**
   * A position the active editor should scroll to and place the cursor at.
   * Set by quick-open's `:line` mode; the editor clears it once applied, so a
   * repeat jump to the same line still fires.
   */
  pendingReveal: { line: number; column: number; fileKey?: string } | null
  rightSidebarTab: RightSidebarTab
  setRightSidebarWidth: (width: number) => void
  setRightSidebarCollapsed: (collapsed: boolean) => void
  toggleRightSidebar: () => void

  bottomPanelOpen: boolean
  bottomPanelHeight: number
  toggleBottomPanel: () => void
  setBottomPanelOpen: (open: boolean) => void
  setBottomPanelHeight: (height: number) => void
  revealPosition: (line: number, column?: number, fileKey?: string) => void
  clearPendingReveal: () => void
  setRightSidebarTab: (tab: RightSidebarTab) => void

  openFiles: OpenedFile[]
  /** Per-project active file path (null = no file open in that project). */
  activeFileByProject: Record<string, string | null>
  /** Load + edit state per tab. */
  fileStates: Record<FileTabKey, FileLoadState>

  fileModalOpen: boolean
  fileModalWidth: number
  fileModalHeight: number
  openFileModal: () => void
  closeFileModal: () => void
  setFileModalSize: (width: number, height: number) => void

  editorViewMode: EditorViewMode
  /** The non-fullscreen mode to fall back to when leaving fullscreen. */
  previousEditorViewMode: EditorViewMode
  setEditorViewMode: (m: EditorViewMode) => void
  /** Leave fullscreen, restoring the mode that was active before entering it. */
  exitFullscreen: () => void
  dockSplitRatio: number
  setDockSplitRatio: (r: number) => void
  reorderFile: (projectId: string, from: number, to: number) => void

  openFile: (file: OpenedFile) => void
  closeFile: (file: OpenedFile) => void
  setActiveFile: (projectId: string, path: string | null) => void
  setFileState: (file: OpenedFile, state: FileLoadState) => void
  /** Apply an on-disk change to an open tab: silent reload, or flag a conflict. */
  applyExternalChange: (file: OpenedFile, content: string | null) => void
  setFileContent: (file: OpenedFile, content: string) => void
  markFileSaved: (file: OpenedFile, content: string) => void

  setProjects: (
    projects: Project[],
    opts?: {
      selectedProjectId?: ProjectId | null
      activeTerminalByProject?: Record<ProjectId, TerminalId | null>
    }
  ) => void
  upsertProject: (project: Project) => void
  removeProject: (id: ProjectId) => void
  selectProject: (id: ProjectId | null) => void
  renameProject: (id: ProjectId, name: string) => void
  reorderProjects: (fromIndex: number, toIndex: number) => void

  addTerminal: (projectId: ProjectId, terminal: TerminalRecord) => void
  removeTerminalLocal: (projectId: ProjectId, terminalId: TerminalId) => void
  renameTerminalLocal: (
    projectId: ProjectId,
    terminalId: TerminalId,
    name: string
  ) => void
  setActiveTerminal: (projectId: ProjectId, terminalId: TerminalId | null) => void
  reorderTerminal: (projectId: ProjectId, fromIndex: number, toIndex: number) => void

  toggleProjectExpanded: (id: ProjectId) => void
  setProjectExpanded: (id: ProjectId, expanded: boolean) => void

  bumpUnread: (terminalId: TerminalId) => void
  clearUnread: (terminalId: TerminalId) => void

  setTerminalTitle: (terminalId: TerminalId, title: string) => void

  setTerminalBusy: (terminalId: TerminalId, busy: boolean) => void
  setTerminalAttention: (
    terminalId: TerminalId,
    attention: boolean,
    meta?: AttentionMeta
  ) => void
  clearAttention: (terminalId: TerminalId) => void

  /** Open the close-confirmation dialog for a terminal. */
  requestTerminalClose: (projectId: ProjectId, terminalId: TerminalId) => void
  clearPendingTerminalClose: () => void
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  projects: [],
  selectedProjectId: null,
  activeTerminalByProject: {},
  expandedProjectIds: {},
  unreadByTerminal: {},
  titleByTerminal: {},
  busyByTerminal: {},
  attentionByTerminal: {},
  attentionMetaByTerminal: {},
  pendingTerminalClose: null,

  sidebarWidth: readInitialSidebarWidth(),
  sidebarCollapsed: readInitialSidebarCollapsed(),

  rightSidebarWidth: readInitialRightSidebarWidth(),
  rightSidebarCollapsed: readInitialRightSidebarCollapsed(),
  pendingReveal: null,
  rightSidebarTab: readInitialRightSidebarTab(),

  bottomPanelOpen: readInitialBottomPanelOpen(),
  bottomPanelHeight: readInitialBottomPanelHeight(),

  setRightSidebarWidth: (width) => {
    const next = clampRightSidebarWidth(width)
    set({ rightSidebarWidth: next })
    try {
      localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(next))
    } catch {
      // ignore
    }
  },

  setRightSidebarCollapsed: (collapsed) => {
    set({ rightSidebarCollapsed: collapsed })
    try {
      localStorage.setItem(RIGHT_SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // ignore
    }
  },

  toggleRightSidebar: () =>
    set((state) => {
      const next = !state.rightSidebarCollapsed
      try {
        localStorage.setItem(RIGHT_SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return { rightSidebarCollapsed: next }
    }),

  revealPosition: (line, column = 1, fileKey) =>
    set({ pendingReveal: { line, column, ...(fileKey ? { fileKey } : {}) } }),
  clearPendingReveal: () => set({ pendingReveal: null }),
  setRightSidebarTab: (tab) => {
    set({ rightSidebarTab: tab })
    try {
      localStorage.setItem(RIGHT_SIDEBAR_TAB_KEY, tab)
    } catch {
      // ignore
    }
  },

  setBottomPanelOpen: (open) => {
    set({ bottomPanelOpen: open })
    try {
      localStorage.setItem(BOTTOM_PANEL_OPEN_KEY, open ? '1' : '0')
    } catch {
      // ignore
    }
  },

  toggleBottomPanel: () =>
    set((state) => {
      const next = !state.bottomPanelOpen
      try {
        localStorage.setItem(BOTTOM_PANEL_OPEN_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return { bottomPanelOpen: next }
    }),

  setBottomPanelHeight: (height) => {
    const next = clampBottomPanelHeight(height)
    set({ bottomPanelHeight: next })
    try {
      localStorage.setItem(BOTTOM_PANEL_HEIGHT_KEY, String(next))
    } catch {
      // ignore
    }
  },

  fileModalOpen: false,
  fileModalWidth: readInitialFileModalSize().width,
  fileModalHeight: readInitialFileModalSize().height,
  openFileModal: () => set({ fileModalOpen: true }),
  closeFileModal: () => set({ fileModalOpen: false }),
  setFileModalSize: (width, height) => {
    // clampModalSize, not modalSizeFor: an explicit drag must never be grown
    // back to the proportional default.
    const { width: w, height: h } = clampModalSize(
      { width: window.innerWidth, height: window.innerHeight },
      { width, height }
    )
    set({ fileModalWidth: w, fileModalHeight: h })
    try {
      localStorage.setItem(FILE_MODAL_SIZE_KEY, JSON.stringify({ width: w, height: h }))
    } catch {
      // ignore
    }
  },

  editorViewMode: readEditorViewMode(),
  previousEditorViewMode: readEditorViewMode() === 'fullscreen' ? 'modal' : readEditorViewMode(),
  setEditorViewMode: (m) => {
    localStorage.setItem(EDITOR_VIEW_MODE_KEY, m)
    set((state) => ({
      editorViewMode: m,
      // Remember where we came from so exitFullscreen can return there.
      previousEditorViewMode:
        m === 'fullscreen' && state.editorViewMode !== 'fullscreen'
          ? state.editorViewMode
          : state.previousEditorViewMode,
    }))
  },
  exitFullscreen: () => {
    set((state) => {
      if (state.editorViewMode !== 'fullscreen') return state
      const target = state.previousEditorViewMode === 'fullscreen' ? 'modal' : state.previousEditorViewMode
      localStorage.setItem(EDITOR_VIEW_MODE_KEY, target)
      return { editorViewMode: target }
    })
  },
  dockSplitRatio: readDockSplitRatio(),
  setDockSplitRatio: (r) => {
    const clamped = Math.min(0.85, Math.max(0.15, r))
    localStorage.setItem(DOCK_SPLIT_KEY, String(clamped))
    set({ dockSplitRatio: clamped })
  },
  reorderFile: (projectId, from, to) =>
    set((state) => {
      const proj = state.openFiles.filter((f) => f.projectId === projectId)
      const others = state.openFiles.filter((f) => f.projectId !== projectId)
      if (from < 0 || to < 0 || from >= proj.length || to >= proj.length) return {}
      const next = [...proj]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { openFiles: [...others, ...next] }
    }),

  openFiles: [],
  activeFileByProject: {},
  fileStates: {},

  openFile: (file) =>
    set((state) => {
      const key = tabKey(file)
      const alreadyOpen = state.openFiles.some(
        (f) => f.projectId === file.projectId && f.path === file.path
      )
      return {
        openFiles: alreadyOpen ? state.openFiles : [...state.openFiles, file],
        activeFileByProject: { ...state.activeFileByProject, [file.projectId]: file.path },
        fileStates: alreadyOpen
          ? state.fileStates
          : { ...state.fileStates, [key]: { kind: 'loading' } },
        fileModalOpen: true,
      }
    }),

  closeFile: (file) =>
    set((state) => {
      const key = tabKey(file)
      const remaining = state.openFiles.filter(
        (f) => !(f.projectId === file.projectId && f.path === file.path)
      )
      const wasActive = state.activeFileByProject[file.projectId] === file.path
      const nextActive: string | null = wasActive
        ? remaining
            .filter((f) => f.projectId === file.projectId)
            .at(-1)?.path ?? null
        : state.activeFileByProject[file.projectId] ?? null
      const { [key]: _omit, ...rest } = state.fileStates
      const remainingForProject = remaining.filter((f) => f.projectId === file.projectId)
      return {
        openFiles: remaining,
        activeFileByProject: { ...state.activeFileByProject, [file.projectId]: nextActive },
        fileStates: rest,
        fileModalOpen: remainingForProject.length === 0 ? false : state.fileModalOpen,
      }
    }),

  setActiveFile: (projectId, path) =>
    set((state) => ({
      activeFileByProject: { ...state.activeFileByProject, [projectId]: path },
    })),

  applyExternalChange: (file, content) =>
    set((state) => {
      const key = tabKey(file)
      const prev = state.fileStates[key]
      if (!prev || prev.kind !== 'text') return {}

      const action = decideExternalChange({
        onDisk: content,
        saved: prev.saved,
        current: prev.current,
      })
      if (action === 'ignore') return {}

      if (action === 'reload' && content !== null) {
        return {
          fileStates: {
            ...state.fileStates,
            [key]: { kind: 'text', current: content, saved: content },
          },
        }
      }

      // conflict or deleted — keep the user's text, record what disk holds.
      return {
        fileStates: {
          ...state.fileStates,
          [key]: { ...prev, conflictWith: content },
        },
      }
    }),
  setFileState: (file, fileState) =>
    set((state) => ({
      fileStates: { ...state.fileStates, [tabKey(file)]: fileState },
    })),

  setFileContent: (file, content) =>
    set((state) => {
      const key = tabKey(file)
      const prev = state.fileStates[key]
      if (!prev || prev.kind !== 'text') return state
      return {
        fileStates: { ...state.fileStates, [key]: { ...prev, current: content } },
      }
    }),

  markFileSaved: (file, content) =>
    set((state) => {
      const key = tabKey(file)
      const prev = state.fileStates[key]
      if (!prev || prev.kind !== 'text') return state
      return {
        fileStates: {
          ...state.fileStates,
          [key]: { kind: 'text', current: content, saved: content },
        },
      }
    }),

  setSidebarWidth: (width) => {
    const next = clampSidebarWidth(width)
    set({ sidebarWidth: next })
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next))
    } catch {
      // ignore — storage may be unavailable
    }
  },

  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed })
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // ignore
    }
  },

  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarCollapsed
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return { sidebarCollapsed: next }
    }),

  setProjects: (projects, opts) =>
    set((state) => {
      const activeNext: Record<ProjectId, TerminalId | null> = {
        ...state.activeTerminalByProject,
        ...(opts?.activeTerminalByProject ?? {}),
      }
      const expandedNext: Record<ProjectId, boolean> = { ...state.expandedProjectIds }
      for (const p of projects) {
        if (!(p.id in activeNext) || activeNext[p.id] === undefined) {
          activeNext[p.id] = p.terminals[0]?.id ?? null
        }
        const aid = activeNext[p.id]
        if (aid && !p.terminals.find((t) => t.id === aid)) {
          activeNext[p.id] = p.terminals[0]?.id ?? null
        }
      }
      const selectedId = opts?.selectedProjectId ?? state.selectedProjectId ?? projects[0]?.id ?? null
      if (selectedId && !(selectedId in expandedNext)) expandedNext[selectedId] = true
      return {
        projects,
        selectedProjectId: selectedId,
        activeTerminalByProject: activeNext,
        expandedProjectIds: expandedNext,
      }
    }),

  upsertProject: (project) =>
    set((state) => {
      const idx = state.projects.findIndex((p) => p.id === project.id)
      const next = [...state.projects]
      if (idx >= 0) next[idx] = project
      else next.push(project)
      return {
        projects: next,
        selectedProjectId: state.selectedProjectId ?? project.id,
        activeTerminalByProject: {
          ...state.activeTerminalByProject,
          [project.id]: state.activeTerminalByProject[project.id] ?? project.terminals[0]?.id ?? null,
        },
        expandedProjectIds: {
          ...state.expandedProjectIds,
          [project.id]: state.expandedProjectIds[project.id] ?? true,
        },
      }
    }),

  removeProject: (id) =>
    set((state) => {
      const projects = state.projects.filter((p) => p.id !== id)
      const { [id]: _omittedActive, ...activeRest } = state.activeTerminalByProject
      const { [id]: _omittedExpanded, ...expandedRest } = state.expandedProjectIds
      return {
        projects,
        selectedProjectId:
          state.selectedProjectId === id ? projects[0]?.id ?? null : state.selectedProjectId,
        activeTerminalByProject: activeRest,
        expandedProjectIds: expandedRest,
      }
    }),

  selectProject: (id) =>
    set((state) => ({
      selectedProjectId: id,
      expandedProjectIds: id
        ? { ...state.expandedProjectIds, [id]: true }
        : state.expandedProjectIds,
      // The file modal is a per-open-action overlay; switching projects dismisses
      // it so it only ever reappears when the user opens a file.
      fileModalOpen: false,
    })),

  renameProject: (id, name) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, name } : p)),
    })),

  // Reorder user projects by their position in the sidebar (default/Home
  // projects are pinned to the front and excluded from the indices). Persists
  // the new order to the main process.
  reorderProjects: (fromIndex, toIndex) =>
    set((state) => {
      const defaults = state.projects.filter((p) => p.isDefault)
      const users = state.projects.filter((p) => !p.isDefault)
      if (
        fromIndex < 0 ||
        fromIndex >= users.length ||
        toIndex < 0 ||
        toIndex >= users.length ||
        fromIndex === toIndex
      ) {
        return {}
      }
      const next = [...users]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      window.api?.projects.reorder(next.map((p) => p.id))
      return { projects: [...defaults, ...next] }
    }),

  addTerminal: (projectId, terminal) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, terminals: [...p.terminals, terminal] } : p
      ),
      activeTerminalByProject: {
        ...state.activeTerminalByProject,
        [projectId]: terminal.id,
      },
    }))
    window.api?.terminals.setActive(projectId, terminal.id)
  },

  removeTerminalLocal: (projectId, terminalId) => {
    let nextActive: TerminalId | null | undefined
    set((state) => {
      const project = state.projects.find((p) => p.id === projectId)
      const remaining = project ? project.terminals.filter((t) => t.id !== terminalId) : []
      const wasActive = state.activeTerminalByProject[projectId] === terminalId
      const { [terminalId]: _omittedUnread, ...unreadRest } = state.unreadByTerminal
      const { [terminalId]: _omittedTitle, ...titleRest } = state.titleByTerminal
      const { [terminalId]: _omittedBusy, ...busyRest } = state.busyByTerminal
      const { [terminalId]: _omittedAttn, ...attnRest } = state.attentionByTerminal
      const { [terminalId]: _omittedAttnMeta, ...attnMetaRest } = state.attentionMetaByTerminal
      nextActive = wasActive
        ? remaining[0]?.id ?? null
        : state.activeTerminalByProject[projectId]
      return {
        projects: state.projects.map((p) =>
          p.id === projectId ? { ...p, terminals: remaining } : p
        ),
        activeTerminalByProject: {
          ...state.activeTerminalByProject,
          [projectId]: nextActive ?? null,
        },
        unreadByTerminal: unreadRest,
        titleByTerminal: titleRest,
        busyByTerminal: busyRest,
        attentionByTerminal: attnRest,
        attentionMetaByTerminal: attnMetaRest,
        // The shell can exit on its own while the confirm dialog is open.
        pendingTerminalClose: pendingCloseAfterRemoval(state.pendingTerminalClose, {
          projectId,
          terminalId,
        }),
      }
    })
    if (nextActive !== undefined) {
      window.api?.terminals.setActive(projectId, nextActive)
    }
  },

  renameTerminalLocal: (projectId, terminalId, name, source = 'user') =>
    set((state) => {
      // A manual rename should show immediately, so it clears the live agent
      // title (which has display priority). Auto-renames come *from* that
      // title and must leave it alone.
      let titleByTerminal = state.titleByTerminal
      if (source === 'user') {
        const { [terminalId]: _omittedTitle, ...titleRest } = state.titleByTerminal
        titleByTerminal = titleRest
      }
      return {
        projects: state.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                terminals: p.terminals.map((t) =>
                  t.id === terminalId ? { ...t, name } : t
                ),
              }
            : p
        ),
        titleByTerminal,
      }
    }),

  // Reorder terminals within a single project. Session-only — terminals are
  // never persisted, so this just reorders the in-memory array.
  reorderTerminal: (projectId, fromIndex, toIndex) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p
        if (
          fromIndex < 0 ||
          fromIndex >= p.terminals.length ||
          toIndex < 0 ||
          toIndex >= p.terminals.length ||
          fromIndex === toIndex
        ) {
          return p
        }
        const next = [...p.terminals]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        return { ...p, terminals: next }
      }),
    })),

  setActiveTerminal: (projectId, terminalId) => {
    set((state) => ({
      activeTerminalByProject: { ...state.activeTerminalByProject, [projectId]: terminalId },
    }))
    window.api?.terminals.setActive(projectId, terminalId)
  },

  toggleProjectExpanded: (id) =>
    set((state) => ({
      expandedProjectIds: {
        ...state.expandedProjectIds,
        [id]: !state.expandedProjectIds[id],
      },
    })),

  setProjectExpanded: (id, expanded) =>
    set((state) => ({
      expandedProjectIds: { ...state.expandedProjectIds, [id]: expanded },
    })),

  bumpUnread: (terminalId) =>
    set((state) => ({
      unreadByTerminal: {
        ...state.unreadByTerminal,
        [terminalId]: (state.unreadByTerminal[terminalId] ?? 0) + 1,
      },
    })),

  clearUnread: (terminalId) =>
    set((state) => {
      if (!state.unreadByTerminal[terminalId]) return state
      const { [terminalId]: _omitted, ...rest } = state.unreadByTerminal
      return { unreadByTerminal: rest }
    }),

  setTerminalTitle: (terminalId, title) =>
    set((state) => {
      const trimmed = title.trim()
      const current = state.titleByTerminal[terminalId]
      if (!trimmed) {
        if (!current) return state
        const { [terminalId]: _omitted, ...rest } = state.titleByTerminal
        return { titleByTerminal: rest }
      }
      if (current === trimmed) return state
      return {
        titleByTerminal: { ...state.titleByTerminal, [terminalId]: trimmed },
      }
    }),

  setTerminalBusy: (terminalId, busy) =>
    set((state) => {
      const current = !!state.busyByTerminal[terminalId]
      if (current === busy) return state
      if (!busy) {
        const { [terminalId]: _omitted, ...rest } = state.busyByTerminal
        return { busyByTerminal: rest }
      }
      // A new turn starting clears any pending "needs input" cue.
      const { [terminalId]: _omittedAttn, ...attnRest } = state.attentionByTerminal
      const { [terminalId]: _omittedMeta, ...metaRest } = state.attentionMetaByTerminal
      return {
        busyByTerminal: { ...state.busyByTerminal, [terminalId]: true },
        attentionByTerminal: attnRest,
        attentionMetaByTerminal: metaRest,
      }
    }),

  setTerminalAttention: (terminalId, attention, meta) =>
    set((state) => {
      const current = !!state.attentionByTerminal[terminalId]
      const currentMeta = state.attentionMetaByTerminal[terminalId]
      // The reason can change while attention stays raised — a finished turn
      // followed by a permission prompt — so a same-flag update still matters.
      const metaUnchanged =
        currentMeta?.reason === meta?.reason && currentMeta?.changedAt === meta?.changedAt
      if (current === attention && metaUnchanged) return state
      if (!attention) {
        const { [terminalId]: _omitted, ...rest } = state.attentionByTerminal
        const { [terminalId]: _omittedMeta, ...metaRest } = state.attentionMetaByTerminal
        return { attentionByTerminal: rest, attentionMetaByTerminal: metaRest }
      }
      return {
        attentionByTerminal: { ...state.attentionByTerminal, [terminalId]: true },
        attentionMetaByTerminal: meta
          ? { ...state.attentionMetaByTerminal, [terminalId]: meta }
          : state.attentionMetaByTerminal,
      }
    }),

  clearAttention: (terminalId) =>
    set((state) => {
      if (!state.attentionByTerminal[terminalId]) return state
      const { [terminalId]: _omitted, ...rest } = state.attentionByTerminal
      const { [terminalId]: _omittedMeta, ...metaRest } = state.attentionMetaByTerminal
      return { attentionByTerminal: rest, attentionMetaByTerminal: metaRest }
    }),

  requestTerminalClose: (projectId, terminalId) =>
    set((state) => {
      const label = resolveCloseLabel(
        state.projects,
        state.titleByTerminal,
        projectId,
        terminalId
      )
      // Already gone (the shell exited between click and dispatch): nothing to
      // confirm, and prompting about a terminal that no longer exists is worse
      // than staying silent.
      if (label === null) return state
      return { pendingTerminalClose: { projectId, terminalId, label } }
    }),

  clearPendingTerminalClose: () => set({ pendingTerminalClose: null }),
}))

/**
 * Create a terminal for a project and register it locally. Funnels every
 * "new tab" path through one place so the configured startup command (Settings
 * → Terminal) is applied consistently — and only to brand-new tabs.
 *
 * The Home ("global") workspace is exempt: it is a plain scratch shell, so the
 * configured startup command never runs there.
 */
export async function createProjectTerminal(
  projectId: ProjectId,
  opts?: { cwd?: string; name?: string }
): Promise<TerminalRecord | null> {
  const startupCommand =
    projectId === HOME_PROJECT_ID
      ? undefined
      : useSettings.getState().terminal.startupCommand.trim() || undefined
  const record = await window.api.terminals.create({ projectId, startupCommand, ...opts })
  if (record) useWorkspace.getState().addTerminal(projectId, record)
  return record
}

/**
 * Kill a terminal and drop its record everywhere — the mirror of
 * {@link createProjectTerminal}, and the single funnel every close path runs
 * through once the user has confirmed. Safe to call for a terminal that has
 * already exited: `removeTerminalLocal` tolerates a missing terminal.
 */
export async function closeProjectTerminal(
  projectId: ProjectId,
  terminalId: TerminalId
): Promise<void> {
  await window.api.terminals.kill(terminalId)
  window.api.terminals.removeRecord(projectId, terminalId)
  useWorkspace.getState().removeTerminalLocal(projectId, terminalId)
}

// Dev-only: editing this module hot-swaps it, which makes `create()` build a new
// store instance while already-mounted components stay bound to the old one —
// so actions update one store and the UI reads another ("clicks do nothing").
// Force a full reload on store edits so there is only ever one live instance.
// `import.meta.hot` is undefined in production builds, so this strips out.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload()
  })
}
