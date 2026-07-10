import type { GitInfo, RepoRef } from '@shared/types'
import type { RepoChange } from '@renderer/lib/repo-status'
import { ChangesList } from './changes-list'

interface RepoSectionProps {
  repo: RepoRef
  info: GitInfo | undefined
  changes: RepoChange[]
  /** more than one repo in the project — show name header + activation */
  isMulti: boolean
  isActive: boolean
  isCollapsed: boolean
  pushing: boolean
  pushResult: string | null
  onHeaderClick: () => void
  onPush: () => void
  onRefresh: () => void
}

export function RepoSection({
  repo,
  info,
  changes,
  isMulti,
  isActive,
  isCollapsed,
  pushing,
  pushResult,
  onHeaderClick,
  onPush,
  onRefresh,
}: RepoSectionProps) {
  return (
    <section
      className={`border-b border-accent/7 ${isMulti && isActive ? 'bg-foreground/[0.03]' : ''}`}
    >
      {isMulti && (
        <button
          type="button"
          onClick={onHeaderClick}
          title={isActive ? repo.name : `${repo.name} — click to activate`}
          aria-expanded={!isCollapsed}
          className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left hover:bg-foreground/5"
        >
          <span aria-hidden className="text-[10px] text-foreground/40">
            {isCollapsed ? '▸' : '▾'}
          </span>
          <span
            className={`text-[11px] uppercase tracking-wider font-medium truncate ${
              isActive ? 'text-foreground/80' : 'text-foreground/45'
            }`}
          >
            {repo.name}
          </span>
          {info?.dirty && (
            <span aria-hidden className="text-amber-300" title="Uncommitted changes">
              ●
            </span>
          )}
          <span className="flex-1" />
          <span className="text-[11px] text-foreground/40 tabular-nums">
            {changes.length > 0 ? changes.length : ''}
          </span>
        </button>
      )}
      {!isCollapsed && (
        <>
          {info ? (
            info.isRepo ? (
              <RepoStatusRow
                info={info}
                pushing={pushing}
                pushResult={pushResult}
                onPush={onPush}
                onRefresh={onRefresh}
              />
            ) : (
              <div className="px-3 py-2 text-[11px] text-red-400/80">
                git is unavailable for this repo.
              </div>
            )
          ) : (
            <div className="px-3 py-2 text-[11px] text-foreground/40">Loading…</div>
          )}
          <ChangesList changes={changes} />
        </>
      )}
    </section>
  )
}

function RepoStatusRow({
  info,
  pushing,
  pushResult,
  onPush,
  onRefresh,
}: {
  info: GitInfo
  pushing: boolean
  pushResult: string | null
  onPush: () => void
  onRefresh: () => void
}) {
  return (
    <div className="px-3 py-2 text-[11px] text-foreground/65 space-y-1">
      <div className="flex items-center gap-2">
        <span aria-hidden>⎇</span>
        <span className="font-mono text-foreground/85 truncate">
          {info.branch ?? '(detached)'}
        </span>
        {info.dirty && (
          <span className="text-amber-300" title="Uncommitted changes">●</span>
        )}
        {info.hasUpstream && (info.ahead > 0 || info.behind > 0) && (
          <span className="text-foreground/50">
            {info.ahead > 0 && `↑${info.ahead}`}
            {info.behind > 0 && `↓${info.behind}`}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh git status"
          className="text-foreground/50 hover:text-foreground"
        >
          ↻
        </button>
        {info.branch && (!info.hasUpstream || info.ahead > 0) && (
          <button
            type="button"
            onClick={onPush}
            disabled={pushing}
            className="text-[11px] px-2 py-0.5 rounded bg-foreground/10 hover:bg-foreground/20 disabled:opacity-40"
          >
            {pushing ? 'Pushing…' : info.hasUpstream ? 'Push' : 'Push -u'}
          </button>
        )}
      </div>
      {info.githubRepo && (
        <div className="text-foreground/45 truncate">
          {info.githubRepo.owner}/{info.githubRepo.repo}
        </div>
      )}
      {pushResult && (
        <div className="text-[10px] text-foreground/50 truncate" title={pushResult}>
          {pushResult}
        </div>
      )}
    </div>
  )
}
