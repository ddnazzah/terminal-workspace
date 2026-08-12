import type { Card } from '@shared/types'

interface Props {
  card: Card
  isSelected: boolean
  onSelect: (card: Card) => void
  onDragStart: (card: Card) => void
}

/** One card in a column. Compact by design — detail lives in the side panel. */
export function CardItem({ card, isSelected, onSelect, onDragStart }: Props) {
  const needsInput = card.run?.needsInput === true
  const running = card.status === 'in-progress'

  return (
    <button
      type="button"
      draggable
      onDragStart={() => onDragStart(card)}
      onClick={() => onSelect(card)}
      className={[
        'w-full text-left px-2.5 py-2 rounded-md border transition-colors',
        'bg-surface/60 hover:bg-surface',
        isSelected ? 'border-accent/60' : 'border-accent/14',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-mono text-foreground/40">#{card.number}</span>
        {running && !needsInput && (
          <span className="text-[10px] px-1 rounded bg-sky-400/15 text-sky-300">running</span>
        )}
        {needsInput && (
          <span className="text-[10px] px-1 rounded bg-amber-400/20 text-amber-300">needs you</span>
        )}
      </div>
      <div className="text-[12px] text-foreground/85 leading-snug line-clamp-3">{card.title}</div>
      {card.run?.branch && (
        <div className="mt-1 text-[10px] font-mono text-foreground/35 truncate">
          {card.run.branch}
        </div>
      )}
    </button>
  )
}
