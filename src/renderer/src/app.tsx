import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProjectList } from './components/sidebar/project-list'
import { RightSidebar } from './components/right-sidebar/right-sidebar'
import { RightActivityBar } from './components/right-activity-bar'
import { TerminalPane } from './components/workspace/terminal-pane'
import { EmptyState } from './components/workspace/empty-state'
import { SettingsModal } from './components/settings-modal'
import { UpdateBanner } from './components/update-banner'
import { TopBar } from './components/top-bar'
import { StatusBar } from './components/status-bar'
import { DockedEditor } from './components/workspace/docked-editor'
import { EditorOverlay } from './components/workspace/editor-surface'
import { BottomPanel } from './components/workspace/bottom-panel'
import { useProjects } from './hooks/use-projects'
import { useWindowZoom } from './lib/zoom'
import { createProjectTerminal, useWorkspace } from '@renderer/state/store'
import { useGithub } from './state/github'
import { stripSpinner } from './lib/terminal-title'
import { resolveAutoRename } from './lib/auto-rename'
import { HOME_PROJECT_ID, type ActivityStatus, type Project, type TerminalRecord } from '@shared/types'

export default function App() {
  const { projects, selectedProject, addProject } = useProjects()
  const removeTerminalLocal = useWorkspace((s) => s.removeTerminalLocal)
  const activeTerminalByProject = useWorkspace((s) => s.activeTerminalByProject)
  const selectProject = useWorkspace((s) => s.selectProject)
  const setActiveTerminal = useWorkspace((s) => s.setActiveTerminal)
  const setProjectExpanded = useWorkspace((s) => s.setProjectExpanded)
  const bumpUnread = useWorkspace((s) => s.bumpUnread)
  const clearUnread = useWorkspace((s) => s.clearUnread)
  const clearAttention = useWorkspace((s) => s.clearAttention)
  const attentionByTerminal = useWorkspace((s) => s.attentionByTerminal)
  const titleByTerminal = useWorkspace((s) => s.titleByTerminal)
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed)
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar)
  const rightSidebarCollapsed = useWorkspace((s) => s.rightSidebarCollapsed)
  const toggleRightSidebar = useWorkspace((s) => s.toggleRightSidebar)
  const bottomPanelOpen = useWorkspace((s) => s.bottomPanelOpen)
  const setBottomPanelOpen = useWorkspace((s) => s.setBottomPanelOpen)
  const openFiles = useWorkspace((s) => s.openFiles)
  const editorViewMode = useWorkspace((s) => s.editorViewMode)
  const closeFile = useWorkspace((s) => s.closeFile)
  const activeFileByProject = useWorkspace((s) => s.activeFileByProject)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useWindowZoom()

  // Load GitHub auth state once; ProfileMenu and GitPanel both read this store.
  useEffect(() => {
    void useGithub.getState().refresh()
  }, [])

  // Toggle the Home terminal dock. Opening with no Home terminals starts one by
  // default so you always land in a live shell.
  const toggleHomeTerminal = useCallback(() => {
    const open = !useWorkspace.getState().bottomPanelOpen
    setBottomPanelOpen(open)
    if (open) {
      const homeProject = useWorkspace.getState().projects.find((p) => p.id === HOME_PROJECT_ID)
      if (homeProject && homeProject.terminals.length === 0) {
        void createProjectTerminal(HOME_PROJECT_ID)
      }
    }
  }, [setBottomPanelOpen])

  const pendingFocusRef = useRef<{ projectId: string; terminalId: string } | null>(null)

  const activeTerminalId = selectedProject
    ? activeTerminalByProject[selectedProject.id] ?? null
    : null

  const activeTerminal = useMemo(
    () => selectedProject?.terminals.find((t) => t.id === activeTerminalId) ?? null,
    [selectedProject, activeTerminalId]
  )

  const allTerminals = useMemo(
    () => projects.flatMap((p) => p.terminals.map((t) => ({ ...t, project: p }))),
    [projects]
  )

  // Home (project-less) terminals render in the bottom dock, not the center.
  const home = useMemo(
    () => projects.find((p) => p.id === HOME_PROJECT_ID) ?? null,
    [projects]
  )
  const centerTerminals = useMemo(
    () => allTerminals.filter((t) => t.project.id !== HOME_PROJECT_ID),
    [allTerminals]
  )

  useEffect(() => {
    const offExit = window.api.terminals.onExit(({ id }) => {
      void id
    })
    return offExit
  }, [])

  // Apply main-process activity detection to the sidebar indicators, and mark a
  // backgrounded session unread when it needs input or finishes a command.
  const lastActivityStatusRef = useRef<Record<string, ActivityStatus>>({})
  useEffect(() => {
    return window.api.terminals.onActivity((p) => {
      const s = useWorkspace.getState()
      // setTerminalBusy(true) also clears attention, so set busy first.
      s.setTerminalBusy(p.id, p.status === 'busy')
      s.setTerminalAttention(p.id, p.status === 'attention')
      s.setTerminalTitle(p.id, p.title ? stripSpinner(p.title) : '')

      // Keep the persistent name in sync with the agent's latest task so the
      // tab doesn't fall back to a stale name once the agent goes idle.
      const project = s.projects.find((proj) => proj.terminals.some((t) => t.id === p.id))
      const terminal = project?.terminals.find((t) => t.id === p.id)
      const nextName = terminal ? resolveAutoRename(p, terminal) : null
      if (project && terminal && nextName) {
        s.renameTerminalLocal(project.id, terminal.id, nextName, 'auto')
        window.api.terminals.rename(project.id, terminal.id, nextName, 'auto').catch((err) => {
          console.error('[terminals] auto-rename failed:', err)
        })
      }

      const prev = lastActivityStatusRef.current[p.id]
      lastActivityStatusRef.current[p.id] = p.status
      const selId = s.selectedProjectId
      const visibleId = selId ? s.activeTerminalByProject[selId] ?? null : null
      const visible = document.hasFocus() && p.id === visibleId
      if (visible) return
      const worthMarking = p.status === 'attention' || (prev === 'busy' && p.status === 'idle')
      if (worthMarking) s.bumpUnread(p.id)
    })
  }, [])

  // Report the on-screen session (and window focus) to main so it can suppress
  // notifications for the terminal the user is already looking at.
  useEffect(() => {
    const report = (): void => {
      window.api.terminals.setFocused({ id: activeTerminalId, windowFocused: document.hasFocus() })
    }
    report()
    window.addEventListener('focus', report)
    window.addEventListener('blur', report)
    return () => {
      window.removeEventListener('focus', report)
      window.removeEventListener('blur', report)
    }
  }, [activeTerminalId])

  useEffect(() => {
    const offFocus = window.api.system.onFocusTerminal(({ projectId, terminalId }) => {
      selectProject(projectId)
      setProjectExpanded(projectId, true)
      setActiveTerminal(projectId, terminalId)
      clearUnread(terminalId)
      clearAttention(terminalId)
    })
    return offFocus
  }, [selectProject, setActiveTerminal, setProjectExpanded, clearUnread, clearAttention])

  useEffect(() => {
    if (!activeTerminalId) return
    const tryClear = (): void => {
      if (document.hasFocus()) {
        clearUnread(activeTerminalId)
        clearAttention(activeTerminalId)
      }
    }
    // Re-runs when the active terminal raises attention while focused, so the red
    // cue never lingers on the terminal you're already looking at.
    tryClear()
    window.addEventListener('focus', tryClear)
    return () => window.removeEventListener('focus', tryClear)
  }, [activeTerminalId, clearUnread, clearAttention, attentionByTerminal])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return

      if (e.key === ',') {
        e.preventDefault()
        setSettingsOpen((v) => !v)
        return
      }

      if ((e.key === 'b' || e.key === 'B') && e.shiftKey) {
        e.preventDefault()
        toggleRightSidebar()
        return
      }

      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        toggleSidebar()
        return
      }

      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault()
        toggleHomeTerminal()
        return
      }

      if (!selectedProject) return

      // ⌘W closes the focused file tab; otherwise it falls through to closing the terminal.
      if (e.key === 'w' && document.activeElement?.closest('[data-editor-surface]')) {
        const active = activeFileByProject[selectedProject.id]
        const file = openFiles.find(
          (f) => f.projectId === selectedProject.id && f.path === active
        )
        if (file) {
          e.preventDefault()
          closeFile(file)
          return
        }
      }

      if (e.key === 't') {
        e.preventDefault()
        void createProjectTerminal(selectedProject.id)
      } else if (e.key === 'w' && activeTerminalId) {
        e.preventDefault()
        void window.api.terminals.kill(activeTerminalId)
        window.api.terminals.removeRecord(selectedProject.id, activeTerminalId)
        removeTerminalLocal(selectedProject.id, activeTerminalId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    selectedProject,
    removeTerminalLocal,
    activeTerminalId,
    toggleSidebar,
    toggleRightSidebar,
    toggleHomeTerminal,
    openFiles,
    closeFile,
    activeFileByProject,
  ])

  const handleBell = useCallback(
    (project: Project, terminal: TerminalRecord, kind: 'bell' | 'attention') => {
      const isVisible =
        project.id === selectedProject?.id && terminal.id === activeTerminalId
      const focused = document.hasFocus()

      // The user is already looking at this terminal — nothing to surface.
      if (isVisible && focused) return

      bumpUnread(terminal.id)
      pendingFocusRef.current = { projectId: project.id, terminalId: terminal.id }

      // Only a finished turn ("attention") warrants a desktop notification. A
      // raw bell just marks the tab unread above, so a beep while you type
      // doesn't pop "wants your input".
      if (kind === 'attention') {
        void window.api.system.notify({
          title: project.name,
          body: `${terminal.name} wants your input`,
          projectId: project.id,
          terminalId: terminal.id,
        })
      }
    },
    [selectedProject, activeTerminalId, bumpUnread]
  )

  useEffect(() => {
    const onWindowFocus = (): void => {
      const pending = pendingFocusRef.current
      if (!pending) return
      pendingFocusRef.current = null
      selectProject(pending.projectId)
      setProjectExpanded(pending.projectId, true)
      setActiveTerminal(pending.projectId, pending.terminalId)
      clearUnread(pending.terminalId)
      clearAttention(pending.terminalId)
    }
    window.addEventListener('focus', onWindowFocus)
    return () => window.removeEventListener('focus', onWindowFocus)
  }, [selectProject, setProjectExpanded, setActiveTerminal, clearUnread, clearAttention])

  const showEmptyNoProject = !selectedProject
  const showEmptyNoTerminals = !!selectedProject && selectedProject.terminals.length === 0
  const selectedHasOpenFiles =
    !!selectedProject && openFiles.some((f) => f.projectId === selectedProject.id)

  const closeAllFiles = useCallback(() => {
    if (!selectedProject) return
    for (const f of openFiles.filter((f) => f.projectId === selectedProject.id)) closeFile(f)
  }, [openFiles, selectedProject, closeFile])

  const sessionLabel = selectedProject
    ? `${selectedProject.name}${activeTerminal ? ` — ${titleByTerminal[activeTerminal.id] || activeTerminal.name}` : ''}`
    : 'wTerm'

  const terminalArea = (
    <div className="@container relative flex-1 min-w-0 overflow-hidden">
      {centerTerminals.map((t) => (
        <TerminalPane
          key={t.id}
          terminalId={t.id}
          active={t.project.id === selectedProject?.id && t.id === activeTerminalId}
          onBell={(kind) => handleBell(t.project, t, kind)}
        />
      ))}
      {showEmptyNoProject && (
        <EmptyState hasSelection={false} onAddProject={() => void addProject()} />
      )}
      {showEmptyNoTerminals && (
        <EmptyState
          hasSelection
          onCreateTerminal={() => {
            if (!selectedProject) return
            void createProjectTerminal(selectedProject.id)
          }}
        />
      )}
    </div>
  )

  return (
    <div className="flex flex-col h-screen w-screen bg-surface text-foreground">
      <TopBar
        label={sessionLabel}
        onToggleSidebar={toggleSidebar}
        onNewSession={() => {
          if (selectedProject) void createProjectTerminal(selectedProject.id)
        }}
        newSessionDisabled={!selectedProject}
        terminalOpen={bottomPanelOpen}
        onToggleTerminal={toggleHomeTerminal}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex flex-1 min-h-0 gap-1.5 py-1.5">
        {!sidebarCollapsed && <ProjectList />}
        <div className="flex flex-col flex-1 min-w-0 gap-1.5">
          <div className="flex flex-1 min-h-0 gap-1.5">
            <main className="flex-1 flex flex-col min-w-0">
              <div className="flex flex-col h-full rounded-lg bg-background overflow-hidden">
                {selectedProject && selectedHasOpenFiles && editorViewMode === 'docked' ? (
                  <DockedEditor projectId={selectedProject.id} onClose={closeAllFiles}>
                    {terminalArea}
                  </DockedEditor>
                ) : (
                  terminalArea
                )}
              </div>
            </main>
            {selectedProject && !rightSidebarCollapsed && <RightSidebar project={selectedProject} />}
          </div>
          {home && <BottomPanel home={home} onBell={handleBell} />}
        </div>
        <RightActivityBar
          onOpenSettings={() => setSettingsOpen(true)}
          panelDisabled={!selectedProject}
        />
      </div>
      <StatusBar project={selectedProject} />
      {selectedProject && selectedHasOpenFiles && editorViewMode !== 'docked' && (
        <EditorOverlay projectId={selectedProject.id} />
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <UpdateBanner />
    </div>
  )
}
