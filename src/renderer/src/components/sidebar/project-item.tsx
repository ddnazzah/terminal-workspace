import { useState } from 'react'
import { Button, Dropdown, Label } from '@heroui/react'
import type { Project } from '@shared/types'
import { useWorkspace } from '@renderer/state/store'
import { useTerminals } from '@renderer/hooks/use-terminals'
import { isMac, isWindows } from '@renderer/lib/platform'
import { TerminalSidebarItem } from './terminal-sidebar-item'
import { strongestState } from '../activity-dot'
import { useNow } from '@renderer/hooks/use-now'
import {
  indicatorColor,
  indicatorLabel,
  indicatorState,
  isPulsing,
} from '@renderer/lib/terminal-indicator'

/** The collapsed row only needs to notice staleness, so it ticks lazily. */
const PROJECT_AGE_TICK_MS = 30_000

// Per-platform names for the native terminal / file-manager apps.
const TERMINAL_APP = isMac ? 'iTerm' : isWindows ? 'Terminal' : 'terminal'
const FILE_MANAGER_APP = isMac ? 'Finder' : isWindows ? 'Explorer' : 'file manager'

interface Props {
  project: Project
  selected: boolean
  index: number
  onSelect: () => void
  onRename: (name: string) => void
  onRemove: () => void
  onOpenInITerm: () => void
  onOpenInFinder: () => void
  onReorderProject: (from: number, to: number) => void
}

const ACTIONS = {
  newTerminal: 'new-terminal',
  rename: 'rename',
  finder: 'finder',
  iterm: 'iterm',
  remove: 'remove',
} as const

type ActionKey = (typeof ACTIONS)[keyof typeof ACTIONS]

export function ProjectItem({
  project,
  selected,
  index,
  onSelect,
  onRename,
  onRemove,
  onOpenInITerm,
  onOpenInFinder,
  onReorderProject,
}: Props) {
  const expanded = useWorkspace((s) => !!s.expandedProjectIds[project.id])
  const toggleExpanded = useWorkspace((s) => s.toggleProjectExpanded)
  const setExpanded = useWorkspace((s) => s.setProjectExpanded)
  const unreadByTerminal = useWorkspace((s) => s.unreadByTerminal)
  const titleByTerminal = useWorkspace((s) => s.titleByTerminal)
  const busyByTerminal = useWorkspace((s) => s.busyByTerminal)
  const attentionByTerminal = useWorkspace((s) => s.attentionByTerminal)
  const attentionMetaByTerminal = useWorkspace((s) => s.attentionMetaByTerminal)
  const reorderTerminal = useWorkspace((s) => s.reorderTerminal)
  const [projDragOver, setProjDragOver] = useState(false)

  const { activeId, create, close, rename: renameTerminal, setActive } = useTerminals(project)

  // Collapsed, the project row stands in for every terminal inside it, so it
  // shows whichever of them is asking loudest.
  const now = useNow(PROJECT_AGE_TICK_MS)
  const rollup = strongestState(
    project.terminals.map((t) =>
      indicatorState({
        busy: !!busyByTerminal[t.id],
        attention: !!attentionByTerminal[t.id],
        unread: (unreadByTerminal[t.id] ?? 0) > 0,
        reason: attentionMetaByTerminal[t.id]?.reason ?? null,
        changedAt: attentionMetaByTerminal[t.id]?.changedAt ?? 0,
        now,
      })
    )
  )

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.name)

  const commitRename = (): void => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== project.name) onRename(trimmed)
    else setDraft(project.name)
  }

  const handleHeaderClick = (): void => {
    if (selected) {
      toggleExpanded(project.id)
    } else {
      onSelect()
      setExpanded(project.id, true)
    }
  }

  const handleNewTerminal = async (): Promise<void> => {
    onSelect()
    setExpanded(project.id, true)
    await create()
  }

  const handleAction = (key: React.Key): void => {
    switch (key as ActionKey) {
      case 'new-terminal':
        void handleNewTerminal()
        return
      case 'rename':
        setEditing(true)
        return
      case 'finder':
        onOpenInFinder()
        return
      case 'iterm':
        onOpenInITerm()
        return
      case 'remove':
        onRemove()
        return
    }
  }

  return (
    <div className="flex flex-col">
      <div
        draggable={!editing}
        onClick={handleHeaderClick}
        onDoubleClick={() => setEditing(true)}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'project', index }))
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('text/plain')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setProjDragOver(true)
        }}
        onDragLeave={() => setProjDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setProjDragOver(false)
          try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'))
            if (data?.kind === 'project' && typeof data.index === 'number') {
              onReorderProject(data.index, index)
            }
          } catch {
            // ignore malformed payloads
          }
        }}
        className={[
          'group/proj relative flex items-center gap-1 px-1 py-1 rounded-md cursor-pointer transition-colors',
          selected
            ? 'text-foreground/90'
            : 'text-foreground/65 hover:text-foreground/90',
          projDragOver ? 'shadow-[inset_0_2px_0_0_var(--accent)]' : '',
        ].join(' ')}
        title={project.path}
      >
        <span
          className={[
            'inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] text-foreground/35 transition-transform',
            expanded ? 'rotate-90' : '',
          ].join(' ')}
          aria-hidden
        >
          ▶
        </span>
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') {
                  setDraft(project.name)
                  setEditing(false)
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-transparent outline-none text-[13px] border-b border-foreground/30 focus:border-foreground"
            />
          ) : (
            <div className="text-[13px] font-medium truncate">{project.name}</div>
          )}
        </div>

        {!expanded && rollup !== 'idle' && rollup !== 'working' && (
          <span
            aria-label={`A terminal in this project: ${indicatorLabel(rollup, null)}`}
            title={indicatorLabel(rollup, null)}
            className={[
              'inline-block w-1.5 h-1.5 rounded-full flex-shrink-0',
              indicatorColor(rollup),
              isPulsing(rollup) ? `activity-dot--${rollup}` : '',
              rollup === 'stale' ? 'activity-dot--stale' : '',
            ].join(' ')}
          />
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void handleNewTerminal()
          }}
          aria-label="New terminal in this project"
          title="New terminal"
          className="opacity-0 group-hover/proj:opacity-100 transition-opacity text-foreground/55 hover:text-foreground hover:bg-foreground/10 rounded-md h-6 w-6 inline-flex items-center justify-center text-base leading-none"
        >
          +
        </button>

        <Dropdown>
          <Dropdown.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="Project actions"
              className="opacity-0 group-hover/proj:opacity-100 transition-opacity h-6 w-6 min-w-6 text-foreground/55"
              onPress={() => {}}
            >
              ⋯
            </Button>
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu onAction={handleAction}>
              <Dropdown.Item id={ACTIONS.newTerminal} textValue="New terminal">
                <Label>New terminal</Label>
              </Dropdown.Item>
              <Dropdown.Item id={ACTIONS.rename} textValue="Rename">
                <Label>Rename</Label>
              </Dropdown.Item>
              <Dropdown.Item id={ACTIONS.finder} textValue={`Open in ${FILE_MANAGER_APP}`}>
                <Label>Open in {FILE_MANAGER_APP}</Label>
              </Dropdown.Item>
              <Dropdown.Item id={ACTIONS.iterm} textValue={`Open in ${TERMINAL_APP}`}>
                <Label>Open in {TERMINAL_APP}</Label>
              </Dropdown.Item>
              <Dropdown.Item id={ACTIONS.remove} textValue="Remove" variant="danger">
                <Label>Remove</Label>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>

      {expanded && (
        <div className="ml-3 mt-0.5 mb-1 pl-2 flex flex-col gap-0.5">
          {project.terminals.map((t, i) => (
            <TerminalSidebarItem
              key={t.id}
              terminal={t}
              index={i}
              projectId={project.id}
              active={selected && t.id === activeId}
              unread={(unreadByTerminal[t.id] ?? 0) > 0}
              busy={!!busyByTerminal[t.id]}
              attention={!!attentionByTerminal[t.id]}
              attentionMeta={attentionMetaByTerminal[t.id]}
              autoTitle={titleByTerminal[t.id]}
              onSelect={() => {
                if (!selected) onSelect()
                setActive(t.id)
              }}
              onClose={() => void close(t.id)}
              onRename={(name) => void renameTerminal(t.id, name)}
              onReorder={(from, to) => reorderTerminal(project.id, from, to)}
            />
          ))}
          <button
            type="button"
            onClick={() => void handleNewTerminal()}
            className="flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-md text-[11px] text-foreground/45 hover:text-foreground/85 hover:bg-foreground/5 transition-colors"
          >
            <span className="w-1 h-3 inline-block" aria-hidden />
            + New terminal
          </button>
        </div>
      )}
    </div>
  )
}
