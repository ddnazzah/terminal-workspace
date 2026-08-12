import { useEffect, useState } from 'react'
import { CARD_STATUS_LABELS, type Card } from '@shared/types'

interface Props {
  card: Card
  onClose: () => void
  onOpenWorker: (terminalId: string) => void
  onChanged: () => void
}

/** Editing + run history for one card. Saves on blur, not on every keystroke. */
export function CardDetail({ card, onClose, onOpenWorker, onChanged }: Props) {
  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  const [pruneError, setPruneError] = useState<string | null>(null)

  // Re-seed the form when a different card is selected, or when the scheduler
  // rewrites this one underneath us.
  useEffect(() => {
    setTitle(card.title)
    setBody(card.body)
    setPruneError(null)
  }, [card.id, card.title, card.body])

  const save = (): void => {
    if (title === card.title && body === card.body) return
    void window.api.board.updateCard({ id: card.id, title, body }).then(onChanged)
  }

  const prune = (force: boolean): void => {
    void window.api.board.pruneWorktree(card.id, force).then((res) => {
      setPruneError(res.ok ? null : res.error ?? 'failed')
      onChanged()
    })
  }

  return (
    <div className="flex flex-col h-full min-h-0 border-l border-accent/14 bg-surface/40">
      <div className="flex items-center gap-2 h-9 px-3 border-b border-accent/14 flex-shrink-0">
        <span className="text-[10px] font-mono text-foreground/40">#{card.number}</span>
        <span className="text-[11px] text-foreground/50">{CARD_STATUS_LABELS[card.status]}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close card"
          className="ml-auto w-6 h-6 rounded text-foreground/50 hover:text-foreground hover:bg-foreground/10"
        >
          ×
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={save}
          aria-label="Card title"
          className="w-full bg-background/60 rounded px-2 py-1.5 text-[13px] text-foreground outline-none border border-accent/14 focus:border-accent/50"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={save}
          rows={10}
          placeholder="What should the agent do? This becomes its prompt."
          aria-label="Card body"
          className="w-full bg-background/60 rounded px-2 py-1.5 text-[12px] font-mono text-foreground/85 outline-none border border-accent/14 focus:border-accent/50 resize-y"
        />

        {card.run && (
          <div className="text-[11px] text-foreground/60 flex flex-col gap-1">
            <div className="font-mono truncate">{card.run.branch || '(no branch)'}</div>
            <div className="font-mono text-foreground/40 truncate">{card.run.worktreePath}</div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => onOpenWorker(card.run!.terminalId)}
                className="px-2 py-1 rounded bg-foreground/10 hover:bg-foreground/15 text-[11px]"
              >
                Open worker
              </button>
              <button
                type="button"
                onClick={() => prune(false)}
                className="px-2 py-1 rounded bg-foreground/10 hover:bg-foreground/15 text-[11px]"
              >
                Remove worktree
              </button>
            </div>
            {pruneError && (
              <div className="text-[11px] text-red-400">
                {pruneError}
                {pruneError.includes('uncommitted') && (
                  <button
                    type="button"
                    onClick={() => prune(true)}
                    className="ml-2 underline hover:text-red-300"
                  >
                    remove anyway
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {card.log.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-[10px] uppercase tracking-wide text-foreground/35">History</div>
            {[...card.log].reverse().map((entry) => (
              <div key={`${entry.at}-${entry.text}`} className="text-[11px] text-foreground/55">
                <span className="font-mono text-foreground/30">
                  {new Date(entry.at).toLocaleTimeString()}
                </span>{' '}
                {entry.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
