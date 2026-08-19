import { useState } from 'react'
import type { BoardSettings, ProjectId } from '@shared/types'

interface Props {
  projectId: ProjectId
  settings: BoardSettings
  runningCount: number
  onChanged: () => void
}

/** Worker count is the automation switch, so it lives in the board's header. */
export function BoardSettingsBar({ projectId, settings, runningCount, onChanged }: Props) {
  const [open, setOpen] = useState(false)

  const patch = (next: Partial<BoardSettings>): void => {
    void window.api.board.setSettings(projectId, next).then(onChanged)
  }

  return (
    <div className="flex-shrink-0 border-b border-accent/14">
      <div className="flex items-center gap-3 h-9 px-3">
        <span className="text-[11px] text-foreground/50">Workers</span>
        <input
          type="number"
          min={0}
          max={8}
          value={settings.workerCount}
          onChange={(e) => patch({ workerCount: Math.max(0, Number(e.target.value) || 0) })}
          aria-label="Worker count"
          className="w-12 bg-background/60 rounded px-1.5 py-0.5 text-[12px] text-foreground outline-none border border-accent/14 focus:border-accent/50"
        />
        <span className="text-[11px] text-foreground/40">
          {settings.workerCount === 0
            ? 'automation off — cards stay put'
            : `${runningCount} running`}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-[11px] text-foreground/50 hover:text-foreground"
        >
          {open ? 'Hide settings' : 'Settings'}
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-foreground/35">
              Agent command
            </span>
            <input
              defaultValue={settings.agentCommand}
              onBlur={(e) => patch({ agentCommand: e.target.value })}
              className="bg-background/60 rounded px-2 py-1 text-[12px] font-mono text-foreground outline-none border border-accent/14 focus:border-accent/50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-foreground/35">
              Prompt template — {'{{number}} {{title}} {{cardFile}} {{branch}}'}
            </span>
            <textarea
              defaultValue={settings.promptTemplate}
              onBlur={(e) => patch({ promptTemplate: e.target.value })}
              rows={2}
              className="bg-background/60 rounded px-2 py-1 text-[12px] font-mono text-foreground/85 outline-none border border-accent/14 focus:border-accent/50 resize-y"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-foreground/35">
              Worktree root — blank means alongside the project
            </span>
            <input
              defaultValue={settings.worktreeRoot}
              onBlur={(e) => patch({ worktreeRoot: e.target.value })}
              placeholder="(project's parent folder)"
              className="bg-background/60 rounded px-2 py-1 text-[12px] font-mono text-foreground outline-none border border-accent/14 focus:border-accent/50"
            />
          </label>
        </div>
      )}
    </div>
  )
}
