import { useCallback, useMemo, useRef, useState } from 'react'
import {
  CARD_STATUSES,
  CARD_STATUS_LABELS,
  type Card,
  type CardStatus,
  type ProjectId,
} from '@shared/types'
import { useBoard } from '@renderer/hooks/use-board'
import { useWorkspace } from '@renderer/state/store'
import { CardDetail } from './card-detail'
import { CardItem } from './card-item'
import { BoardSettingsBar } from './board-settings'

interface Props {
  projectId: ProjectId
}

export function BoardTab({ projectId }: Props) {
  const { snapshot, refresh } = useBoard(projectId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dragged = useRef<Card | null>(null)
  const setActiveTerminal = useWorkspace((s) => s.setActiveTerminal)

  const byStatus = useMemo(() => {
    const map = new Map<CardStatus, Card[]>()
    for (const status of CARD_STATUSES) {
      map.set(
        status,
        snapshot.cards.filter((c) => c.status === status).sort((a, b) => a.order - b.order)
      )
    }
    return map
  }, [snapshot.cards])

  const selected = snapshot.cards.find((c) => c.id === selectedId) ?? null

  const addCard = useCallback(
    (status: CardStatus) => {
      void window.api.board
        .createCard({ projectId, title: 'New card', status })
        .then((card) => {
          refresh()
          if (card) setSelectedId(card.id)
        })
    },
    [projectId, refresh]
  )

  const drop = useCallback(
    (status: CardStatus) => {
      const card = dragged.current
      dragged.current = null
      if (!card || card.status === status) return
      void window.api.board.moveCard({ id: card.id, status }).then(refresh)
    },
    [refresh]
  )

  const openWorker = useCallback(
    (terminalId: string) => {
      setActiveTerminal(projectId, terminalId)
    },
    [projectId, setActiveTerminal]
  )

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <BoardSettingsBar
        projectId={projectId}
        settings={snapshot.settings}
        runningCount={byStatus.get('in-progress')?.length ?? 0}
        onChanged={refresh}
      />

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex gap-2 p-2 overflow-x-auto">
          {CARD_STATUSES.map((status) => {
            const cards = byStatus.get(status) ?? []
            return (
              <section
                key={status}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => drop(status)}
                className="flex flex-col min-w-[200px] w-[220px] flex-shrink-0 rounded-lg bg-surface/30 border border-accent/10"
              >
                <header className="flex items-center gap-1.5 px-2.5 h-8 flex-shrink-0">
                  <span className="text-[11px] font-medium text-foreground/70">
                    {CARD_STATUS_LABELS[status]}
                  </span>
                  <span className="text-[10px] text-foreground/35">{cards.length}</span>
                  <button
                    type="button"
                    onClick={() => addCard(status)}
                    aria-label={`Add card to ${CARD_STATUS_LABELS[status]}`}
                    className="ml-auto w-5 h-5 rounded text-foreground/40 hover:text-foreground hover:bg-foreground/10"
                  >
                    +
                  </button>
                </header>
                <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2 flex flex-col gap-1.5">
                  {cards.map((card) => (
                    <CardItem
                      key={card.id}
                      card={card}
                      isSelected={card.id === selectedId}
                      onSelect={(c) => setSelectedId(c.id)}
                      onDragStart={(c) => {
                        dragged.current = c
                      }}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        {selected && (
          <div className="w-[320px] flex-shrink-0">
            <CardDetail
              card={selected}
              onClose={() => setSelectedId(null)}
              onOpenWorker={openWorker}
              onChanged={refresh}
            />
          </div>
        )}
      </div>
    </div>
  )
}
