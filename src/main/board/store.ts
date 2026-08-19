// Board + notes persistence. Thin, immutable operations over the app state
// cache; every mutation goes through `mutate` so it is debounced, saved
// atomically, and broadcast exactly like project/terminal changes.

import { randomUUID } from 'node:crypto'
import {
  CARD_LOG_LIMIT,
  DEFAULT_BOARD_SETTINGS,
  type BoardSettings,
  type BoardSnapshot,
  type Card,
  type CardRun,
  type CardStatus,
  type CreateCardInput,
  type MoveCardInput,
  type Note,
  type ProjectId,
  type TerminalId,
  type UpdateCardInput,
} from '@shared/types'
import { getState, mutate } from '../store/state'

function nowIso(): string {
  return new Date().toISOString()
}

function allCards(): Card[] {
  return getState().cards ?? []
}

function allNotes(): Note[] {
  return getState().notes ?? []
}

export function getBoardSettings(projectId: ProjectId): BoardSettings {
  return { ...DEFAULT_BOARD_SETTINGS, ...(getState().boardByProject?.[projectId] ?? {}) }
}

export function getSettingsByProject(): Record<ProjectId, BoardSettings> {
  const configured = getState().boardByProject ?? {}
  return Object.fromEntries(
    Object.keys(configured).map((id) => [id, getBoardSettings(id)])
  )
}

export function setBoardSettings(projectId: ProjectId, patch: Partial<BoardSettings>): void {
  const next = { ...getBoardSettings(projectId), ...patch }
  mutate((s) => {
    s.boardByProject = { ...(s.boardByProject ?? {}), [projectId]: next }
  })
}

export function getSnapshot(projectId: ProjectId): BoardSnapshot {
  return {
    cards: allCards().filter((c) => c.projectId === projectId),
    notes: allNotes().filter((n) => n.projectId === projectId),
    settings: getBoardSettings(projectId),
  }
}

/** Every card across all projects (the scheduler budgets per project itself). */
export function getAllCards(): Card[] {
  return allCards()
}

export function getCard(id: string): Card | undefined {
  return allCards().find((c) => c.id === id)
}

/** The card whose worker owns this terminal, if any. */
export function getCardByTerminal(terminalId: TerminalId): Card | undefined {
  return allCards().find((c) => c.run?.terminalId === terminalId)
}

function nextNumber(projectId: ProjectId): number {
  const used = allCards().filter((c) => c.projectId === projectId).map((c) => c.number)
  return used.length === 0 ? 1 : Math.max(...used) + 1
}

function nextOrder(projectId: ProjectId, status: CardStatus): number {
  const column = allCards().filter((c) => c.projectId === projectId && c.status === status)
  return column.length === 0 ? 0 : Math.max(...column.map((c) => c.order)) + 1
}

function replaceCard(id: string, update: (card: Card) => Card): void {
  mutate((s) => {
    s.cards = (s.cards ?? []).map((c) => (c.id === id ? update(c) : c))
  })
}

export function createCard(input: CreateCardInput): Card {
  const status = input.status ?? 'backlog'
  const card: Card = {
    id: randomUUID(),
    projectId: input.projectId,
    number: nextNumber(input.projectId),
    title: input.title.trim() || 'Untitled card',
    body: input.body ?? '',
    status,
    order: nextOrder(input.projectId, status),
    createdAt: nowIso(),
    log: [],
  }
  mutate((s) => {
    s.cards = [...(s.cards ?? []), card]
  })
  return card
}

export function updateCard(input: UpdateCardInput): void {
  replaceCard(input.id, (c) => ({
    ...c,
    ...(input.title !== undefined ? { title: input.title.trim() || c.title } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
  }))
}

/**
 * Move a card between columns, renumbering the destination so `order` stays a
 * dense 0..n-1 sequence — the queue's dispatch order is exactly this ordering.
 * Returning a card to backlog/ready clears its run so it can be dispatched again.
 */
export function moveCard(input: MoveCardInput): void {
  const card = getCard(input.id)
  if (!card) return

  const clearsRun = input.status === 'backlog' || input.status === 'ready'
  const moved: Card = {
    ...card,
    status: input.status,
    ...(clearsRun ? { run: undefined } : {}),
  }

  mutate((s) => {
    const others = (s.cards ?? []).filter((c) => c.id !== input.id)
    const column = others
      .filter((c) => c.projectId === card.projectId && c.status === input.status)
      .sort((a, b) => a.order - b.order)

    const index = input.index ?? column.length
    const reordered = [...column.slice(0, index), moved, ...column.slice(index)].map((c, i) => ({
      ...c,
      order: i,
    }))

    const reorderedById = new Map(reordered.map((c) => [c.id, c]))
    const movedFinal = reorderedById.get(moved.id) ?? moved
    s.cards = [...others.map((c) => reorderedById.get(c.id) ?? c), movedFinal]
  })
}

export function deleteCard(id: string): void {
  mutate((s) => {
    s.cards = (s.cards ?? []).filter((c) => c.id !== id)
  })
}

/** Append to a card's history, keeping only the most recent entries. */
export function logCard(id: string, text: string): void {
  replaceCard(id, (c) => ({
    ...c,
    log: [...c.log, { at: nowIso(), text }].slice(-CARD_LOG_LIMIT),
  }))
}

export function setCardRun(id: string, run: CardRun | undefined): void {
  replaceCard(id, (c) => ({ ...c, run }))
}

export function patchCardRun(id: string, patch: Partial<CardRun>): void {
  replaceCard(id, (c) => (c.run ? { ...c, run: { ...c.run, ...patch } } : c))
}

export function setCardStatus(id: string, status: CardStatus): void {
  const card = getCard(id)
  if (!card || card.status === status) return
  moveCard({ id, status })
}

// ---- Notes ----

export function createNote(projectId: ProjectId, title = 'Untitled note'): Note {
  const note: Note = {
    id: randomUUID(),
    projectId,
    title,
    body: '',
    updatedAt: nowIso(),
  }
  mutate((s) => {
    s.notes = [...(s.notes ?? []), note]
  })
  return note
}

export function updateNote(id: string, patch: { title?: string; body?: string }): void {
  mutate((s) => {
    s.notes = (s.notes ?? []).map((n) =>
      n.id === id
        ? {
            ...n,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.body !== undefined ? { body: patch.body } : {}),
            updatedAt: nowIso(),
          }
        : n
    )
  })
}

export function deleteNote(id: string): void {
  mutate((s) => {
    s.notes = (s.notes ?? []).filter((n) => n.id !== id)
  })
}

export function getNote(id: string): Note | undefined {
  return allNotes().find((n) => n.id === id)
}
