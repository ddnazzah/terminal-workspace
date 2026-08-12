// The board's effectful driver.
//
// Decisions live in planner.ts and completion.ts (pure, unit-tested); this file
// only performs them: allocate a worktree, write the card file, create the
// worker terminal, and move cards as activity arrives. Ticks are serialized on
// a single promise chain so two concurrent triggers can never fill one worker
// slot twice.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Card, SessionActivityPayload, TerminalExitPayload } from '@shared/types'
import { getProject } from '../store/state'
import { createTerminal } from '../ipc/terminal'
import type { PtyManager } from '../pty/manager'
import { COMPLETION_DEBOUNCE_MS, decideActivity } from './completion'
import { planTick } from './planner'
import { buildStartupCommand } from './prompt'
import {
  getAllCards,
  getBoardSettings,
  getCard,
  getCardByTerminal,
  getSettingsByProject,
  logCard,
  moveCard,
  patchCardRun,
  setCardRun,
} from './store'
import { allocateWorktree, excludeFromGitStatus } from './worktree'

/** Directory inside a worktree holding the dispatched card's markdown. */
const CARD_DIR = '.wterm'

/** Longest worker tab name before truncation. */
const TAB_NAME_MAX = 40

export class BoardScheduler {
  private queue: Promise<void> = Promise.resolve()
  private completionTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    private pty: PtyManager,
    private onChanged: () => void
  ) {}

  /** Subscribe to PTY lifecycle and reconcile leftovers. Returns unsubscribe. */
  start(): () => void {
    const off = this.pty.addSink({
      onActivity: (p) => this.handleActivity(p),
      onExit: (p) => this.handleExit(p),
    })
    this.reconcileOnBoot()
    return () => {
      off()
      for (const timer of this.completionTimers.values()) clearTimeout(timer)
      this.completionTimers.clear()
    }
  }

  /**
   * Cards left `in-progress` by a previous run have no live terminal — the PTY
   * died with the app. They go to Review flagged as interrupted rather than
   * being re-dispatched: their worktree may hold partial work that a fresh agent
   * would fight with.
   */
  private reconcileOnBoot(): void {
    const live = new Set(this.pty.liveIds())
    const stale = getAllCards().filter(
      (c) => c.status === 'in-progress' && (!c.run || !live.has(c.run.terminalId))
    )

    for (const card of stale) {
      logCard(card.id, 'interrupted — wTerm restarted while this card was running')
      if (card.run) patchCardRun(card.id, { endedAt: new Date().toISOString(), needsInput: false })
      moveCard({ id: card.id, status: 'review' })
    }
    if (stale.length > 0) this.onChanged()
    this.tick()
  }

  /** Run a scheduling pass. Safe to call on every mutation; usually a no-op. */
  tick(): void {
    this.queue = this.queue
      .then(() => this.runTick())
      .catch((err: unknown) => {
        console.error('[board] tick failed:', err)
      })
  }

  private async runTick(): Promise<void> {
    const actions = planTick({
      cards: getAllCards(),
      settingsByProject: getSettingsByProject(),
    })
    if (actions.length === 0) return

    for (const action of actions) {
      await this.dispatch(action.cardId)
    }
    this.onChanged()
  }

  /**
   * Take one card from Ready to In Progress. Every failure path returns the card
   * to Ready with the reason in its log — a card never disappears because a
   * dispatch went wrong.
   */
  private async dispatch(cardId: string): Promise<void> {
    const card = getCard(cardId)
    if (!card || card.status !== 'ready') return

    const project = getProject(card.projectId)
    if (!project) {
      logCard(card.id, 'dispatch failed: project no longer exists')
      return
    }

    // Claim the slot before the first await so a concurrent tick can't take it.
    moveCard({ id: card.id, status: 'in-progress' })

    const settings = getBoardSettings(card.projectId)
    const allocation = await allocateWorktree(
      project.path,
      project.name,
      card.number,
      settings.worktreeRoot
    )
    if (!allocation.ok) {
      this.failDispatch(card.id, `dispatch failed: ${allocation.error}`)
      return
    }

    const { cwd, worktreePath, branch, note } = allocation.allocation
    const cardFile = `${CARD_DIR}/card-${card.number}.md`

    try {
      await fs.mkdir(join(cwd, CARD_DIR), { recursive: true })
      await fs.writeFile(join(cwd, cardFile), renderCardFile(card), 'utf-8')
      await excludeFromGitStatus(cwd, `${CARD_DIR}/`)
    } catch (err: unknown) {
      this.failDispatch(card.id, `dispatch failed writing the card file: ${String(err)}`)
      return
    }

    const startupCommand = buildStartupCommand(settings.agentCommand, settings.promptTemplate, {
      number: card.number,
      title: card.title,
      cardFile,
      branch: branch ?? '(detached)',
    })

    const terminal = createTerminal(
      this.pty,
      {
        projectId: card.projectId,
        name: `#${card.number} ${card.title}`.slice(0, TAB_NAME_MAX),
        startupCommand,
      },
      cwd
    )
    if (!terminal) {
      this.failDispatch(card.id, 'dispatch failed: could not create the worker terminal')
      return
    }

    setCardRun(card.id, {
      terminalId: terminal.id,
      worktreePath: worktreePath ?? cwd,
      branch: branch ?? '',
      startedAt: new Date().toISOString(),
      started: false,
    })
    logCard(card.id, `dispatched — ${note}`)
  }

  private failDispatch(cardId: string, reason: string): void {
    logCard(cardId, reason)
    moveCard({ id: cardId, status: 'ready' })
    this.onChanged()
  }

  private handleActivity(p: SessionActivityPayload): void {
    const card = getCardByTerminal(p.id)
    if (!card || card.status !== 'in-progress') return

    switch (decideActivity(card.run, p.status).kind) {
      case 'mark-started':
        this.clearCompletionTimer(card.id)
        patchCardRun(card.id, { started: true, needsInput: false })
        this.onChanged()
        return

      case 'cancel-completion':
        this.clearCompletionTimer(card.id)
        if (card.run?.needsInput) {
          patchCardRun(card.id, { needsInput: false })
          this.onChanged()
        }
        return

      case 'hold':
        this.clearCompletionTimer(card.id)
        if (!card.run?.needsInput) {
          patchCardRun(card.id, { needsInput: true })
          logCard(card.id, 'waiting for you — the agent is asking for input')
          this.onChanged()
        }
        return

      case 'arm-completion':
        this.armCompletion(card.id)
        return

      default:
        return
    }
  }

  private armCompletion(cardId: string): void {
    this.clearCompletionTimer(cardId)
    this.completionTimers.set(
      cardId,
      setTimeout(() => {
        this.completionTimers.delete(cardId)
        this.complete(cardId, 'agent finished — ready for review')
      }, COMPLETION_DEBOUNCE_MS)
    )
  }

  private clearCompletionTimer(cardId: string): void {
    const timer = this.completionTimers.get(cardId)
    if (!timer) return
    clearTimeout(timer)
    this.completionTimers.delete(cardId)
  }

  private complete(cardId: string, reason: string): void {
    const card = getCard(cardId)
    if (!card || card.status !== 'in-progress') return
    patchCardRun(cardId, { endedAt: new Date().toISOString(), needsInput: false })
    logCard(cardId, reason)
    moveCard({ id: cardId, status: 'review' })
    this.onChanged()
    this.tick()
  }

  private handleExit(p: TerminalExitPayload): void {
    const card = getCardByTerminal(p.id)
    if (!card || card.status !== 'in-progress') return
    this.clearCompletionTimer(card.id)
    this.complete(card.id, `worker exited with code ${p.exitCode}`)
  }
}

function renderCardFile(card: Card): string {
  return `# #${card.number} ${card.title}\n\n${card.body}\n`
}

