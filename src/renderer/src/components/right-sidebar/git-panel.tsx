import { useCallback, useEffect, useState } from 'react'
import type { GitInfo, Project } from '@shared/types'
import { useGithub } from '@renderer/state/github'
import { PrSection } from './pr-section'
import { RunsSection } from './runs-section'

interface Props {
  project: Project
}

export function GitPanel({ project }: Props) {
  const settings = useGithub((s) => s.settings)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<string | null>(null)

  const reloadGit = useCallback(async () => {
    setGitInfo(await window.api.git.info(project.id))
  }, [project.id])

  useEffect(() => {
    let cancelled = false
    window.api.git.info(project.id).then((g) => {
      if (!cancelled) setGitInfo(g)
    })
    return () => {
      cancelled = true
    }
  }, [project.id])

  const push = useCallback(async () => {
    if (!gitInfo?.branch) return
    setPushing(true)
    setPushResult(null)
    try {
      const res = await window.api.git.push(project.id, gitInfo.branch)
      setPushResult(res.output.split('\n').slice(-2).join(' '))
      await reloadGit()
    } finally {
      setPushing(false)
    }
  }, [project.id, gitInfo?.branch, reloadGit])

  if (!settings) {
    return (
      <div className="px-3 py-4 text-[11px] text-foreground/40">Loading…</div>
    )
  }

  if (gitInfo && !gitInfo.isRepo) {
    return (
      <div className="px-3 py-4 text-[12px] text-foreground/60 space-y-2">
        <div>This folder isn’t a git repository.</div>
        <div className="text-[11px] text-foreground/40">
          Run <code className="text-foreground/70">git init</code> in a terminal, then refresh.
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      {!settings.hasToken && (
        <div className="px-3 py-2 border-b border-accent/7 text-[12px] text-foreground/55">
          Sign in from the profile menu (top right) to see PRs and CI runs.
        </div>
      )}
      {gitInfo && (
        <GitStatusBar
          gitInfo={gitInfo}
          pushing={pushing}
          pushResult={pushResult}
          onPush={push}
          onRefresh={reloadGit}
        />
      )}
      {settings.hasToken && gitInfo?.githubRepo ? (
        <>
          <PrSection
            project={project}
            gitInfo={gitInfo}
            pushing={pushing}
            onRequestPush={push}
          />
          <RunsSection project={project} gitInfo={gitInfo} />
        </>
      ) : settings.hasToken && !gitInfo?.githubRepo ? (
        <div className="px-3 py-4 text-[12px] text-foreground/55">
          This repo has no GitHub remote on <code>origin</code>, so PRs and runs aren’t available.
        </div>
      ) : null}
    </div>
  )
}

function GitStatusBar({
  gitInfo,
  pushing,
  pushResult,
  onPush,
  onRefresh,
}: {
  gitInfo: GitInfo
  pushing: boolean
  pushResult: string | null
  onPush: () => Promise<void>
  onRefresh: () => Promise<void>
}) {
  return (
    <div className="px-3 py-2 border-b border-accent/7 text-[11px] text-foreground/65 space-y-1">
      <div className="flex items-center gap-2">
        <span aria-hidden>⎇</span>
        <span className="font-mono text-foreground/85 truncate">
          {gitInfo.branch ?? '(detached)'}
        </span>
        {gitInfo.dirty && (
          <span className="text-amber-300" title="Uncommitted changes">●</span>
        )}
        {gitInfo.hasUpstream && (gitInfo.ahead > 0 || gitInfo.behind > 0) && (
          <span className="text-foreground/50">
            {gitInfo.ahead > 0 && `↑${gitInfo.ahead}`}
            {gitInfo.behind > 0 && `↓${gitInfo.behind}`}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void onRefresh()}
          title="Refresh git status"
          className="text-foreground/50 hover:text-foreground"
        >
          ↻
        </button>
        {gitInfo.branch && (!gitInfo.hasUpstream || gitInfo.ahead > 0) && (
          <button
            type="button"
            onClick={() => void onPush()}
            disabled={pushing}
            className="text-[11px] px-2 py-0.5 rounded bg-foreground/10 hover:bg-foreground/20 disabled:opacity-40"
          >
            {pushing ? 'Pushing…' : gitInfo.hasUpstream ? 'Push' : 'Push -u'}
          </button>
        )}
      </div>
      {gitInfo.githubRepo && (
        <div className="text-foreground/45 truncate">
          {gitInfo.githubRepo.owner}/{gitInfo.githubRepo.repo}
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
