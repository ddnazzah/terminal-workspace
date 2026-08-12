import { ipcMain } from 'electron'
import {
  DEFAULT_BOARD_SETTINGS,
  IPC,
  type BoardSettings,
  type BoardSnapshot,
  type Card,
  type CreateCardInput,
  type MoveCardInput,
  type Note,
  type ProjectId,
  type UpdateCardInput,
} from '@shared/types'
import { getProject } from '../store/state'
import type { BoardScheduler } from '../board/scheduler'
import {
  createCard,
  createNote,
  deleteCard,
  deleteNote,
  getCard,
  getNote,
  getSnapshot,
  moveCard,
  setBoardSettings,
  updateCard,
  updateNote,
} from '../board/store'
import { isWorktreeDirty, pruneWorktree } from '../board/worktree'
import { titleFromNote } from '../board/note-title'

/** Empty snapshot for an unknown project — handlers never throw at the boundary. */
const EMPTY: BoardSnapshot = { cards: [], notes: [], settings: DEFAULT_BOARD_SETTINGS }

/**
 * @param notifyChanged pushes `board:changed` to the renderer. Passed as a
 * callback rather than a BrowserWindow so a window recreated on `activate`
 * (macOS) is picked up instead of a stale reference captured at registration.
 */
export function registerBoardIpc(scheduler: BoardScheduler, notifyChanged: () => void): void {
  const changed = notifyChanged
  /** Persist, tell the renderer, then let the scheduler react. */
  const mutated = (): void => {
    changed()
    scheduler.tick()
  }

  ipcMain.handle(IPC.board.snapshot, (_e, projectId: ProjectId): BoardSnapshot => {
    if (!getProject(projectId)) return EMPTY
    return getSnapshot(projectId)
  })

  ipcMain.handle(IPC.board.createCard, (_e, input: CreateCardInput): Card | null => {
    if (!getProject(input.projectId)) return null
    const card = createCard(input)
    mutated()
    return card
  })

  ipcMain.handle(IPC.board.updateCard, (_e, input: UpdateCardInput): void => {
    if (!getCard(input.id)) return
    updateCard(input)
    changed()
  })

  ipcMain.handle(IPC.board.moveCard, (_e, input: MoveCardInput): void => {
    if (!getCard(input.id)) return
    moveCard(input)
    mutated()
  })

  /**
   * Deleting a card leaves its worktree and worker tab alone — they may hold
   * work. Pruning is the explicit "Done" action below.
   */
  ipcMain.handle(IPC.board.deleteCard, (_e, id: string): void => {
    if (!getCard(id)) return
    deleteCard(id)
    mutated()
  })

  ipcMain.handle(IPC.board.dispatchNow, (_e, id: string): void => {
    const card = getCard(id)
    if (!card) return
    moveCard({ id, status: 'ready', index: 0 })
    mutated()
  })

  ipcMain.handle(IPC.board.setSettings, (_e, projectId: ProjectId, patch: Partial<BoardSettings>): void => {
    if (!getProject(projectId)) return
    setBoardSettings(projectId, patch)
    mutated()
  })

  // ---- Notes ----

  ipcMain.handle(IPC.board.createNote, (_e, projectId: ProjectId, title?: string): Note | null => {
    if (!getProject(projectId)) return null
    const note = createNote(projectId, title?.trim() || undefined)
    changed()
    return note
  })

  ipcMain.handle(
    IPC.board.updateNote,
    (_e, id: string, patch: { title?: string; body?: string }): void => {
      if (!getNote(id)) return
      updateNote(id, patch)
      changed()
    }
  )

  ipcMain.handle(IPC.board.deleteNote, (_e, id: string): void => {
    if (!getNote(id)) return
    deleteNote(id)
    changed()
  })

  /** Promotion copies: the note stays put so the inbox keeps its history. */
  ipcMain.handle(IPC.board.promoteNote, (_e, id: string, body?: string): Card | null => {
    const note = getNote(id)
    if (!note) return null
    const source = body?.trim() ? { title: note.title, body } : note
    const card = createCard({
      projectId: note.projectId,
      title: titleFromNote(source),
      body: source.body,
      status: 'backlog',
    })
    mutated()
    return card
  })

  /** Prune a finished card's worktree, refusing while it still has changes. */
  ipcMain.handle(
    IPC.board.pruneWorktree,
    async (_e, id: string, force = false): Promise<{ ok: boolean; error?: string }> => {
      const card = getCard(id)
      if (!card?.run?.worktreePath) return { ok: false, error: 'card has no worktree' }
      const project = getProject(card.projectId)
      if (!project) return { ok: false, error: 'project not found' }

      if (!force && (await isWorktreeDirty(card.run.worktreePath))) {
        return { ok: false, error: 'worktree has uncommitted changes' }
      }
      const result = await pruneWorktree(project.path, card.run.worktreePath)
      if (result.ok) changed()
      return result
    }
  )
}
