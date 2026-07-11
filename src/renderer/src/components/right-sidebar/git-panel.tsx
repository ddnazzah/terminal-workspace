import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitFileStatusMap, GitInfo, Project, RepoRef } from '@shared/types'
import { sliceStatusForRepo } from '@renderer/lib/repo-status'
import { useGithub } from '@renderer/state/github'
import { PrSection } from './pr-section'
import { RepoSection } from './repo-section'
import { RunsSection } from './runs-section'

interface Props {
  project: Project
}

export function GitPanel({ project }: Props) {
  const settings = useGithub((s) => s.settings)
  const [repos, setRepos] = useState<RepoRef[] | null>(null)
  const [infos, setInfos] = useState<Record<string, GitInfo>>({})
  const [statusMap, setStatusMap] = useState<GitFileStatusMap>({})
  const [activeRel, setActiveRel] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [pushingRel, setPushingRel] = useState<string | null>(null)
  const [pushResult, setPushResult] = useState<{ rel: string; msg: string } | null>(null)

  const epochRef = useRef(0)

  const reloadAll = useCallback(async () => {
    const epoch = epochRef.current
    const list = await window.api.git.repos(project.id)
    const [infoList, status] = await Promise.all([
      Promise.all(list.map((r) => window.api.git.info(project.id, r.rel))),
      window.api.git.fileStatus(project.id),
    ])
    if (epoch !== epochRef.current) return
    setRepos(list)
    setInfos(Object.fromEntries(list.map((r, i) => [r.rel, infoList[i]!])))
    setStatusMap(status)
    setActiveRel((cur) => (list.some((r) => r.rel === cur) ? cur : (list[0]?.rel ?? '')))
  }, [project.id])

  useEffect(() => {
    epochRef.current += 1
    setRepos(null)
    setInfos({})
    setStatusMap({})
    setCollapsed({})
    setPushResult(null)
    void reloadAll()
  }, [project.id, reloadAll])

  const push = useCallback(
    async (rel: string): Promise<void> => {
      const info = infos[rel]
      if (!info?.branch) return
      setPushingRel(rel)
      setPushResult(null)
      try {
        const res = await window.api.git.push(project.id, info.branch, rel)
        setPushResult({ rel, msg: res.output.split('\n').slice(-2).join(' ') })
        await reloadAll()
      } finally {
        setPushingRel(null)
      }
    },
    [project.id, infos, reloadAll]
  )

  const activePush = useCallback((): Promise<void> => push(activeRel), [push, activeRel])

  const handleHeaderClick = useCallback(
    (rel: string) => {
      setCollapsed((c) => ({ ...c, [rel]: rel === activeRel ? !c[rel] : false }))
      setActiveRel(rel)
    },
    [activeRel]
  )

  if (!settings || repos === null) {
    return <div className="px-3 py-4 text-[11px] text-foreground/40">Loading…</div>
  }

  if (repos.length === 0) {
    return (
      <div className="px-3 py-4 text-[12px] text-foreground/60 space-y-2">
        <div>This folder isn’t a git repository.</div>
        <div className="text-[11px] text-foreground/40">
          Run <code className="text-foreground/70">git init</code> in a terminal, then refresh.
        </div>
      </div>
    )
  }

  const isMulti = repos.length > 1
  const activeInfo: GitInfo | null = infos[activeRel] ?? null

  return (
    <div className="h-full overflow-y-auto">
      {!settings.hasToken && (
        <div className="px-3 py-2 border-b border-accent/7 text-[12px] text-foreground/55">
          Sign in from the profile menu (top right) to see PRs and CI runs.
        </div>
      )}
      {repos.map((repo) => (
        <RepoSection
          key={repo.rel}
          repo={repo}
          info={infos[repo.rel]}
          changes={sliceStatusForRepo(statusMap, repos, repo.rel)}
          isMulti={isMulti}
          isActive={repo.rel === activeRel}
          isCollapsed={!!collapsed[repo.rel]}
          pushing={pushingRel === repo.rel}
          pushResult={pushResult?.rel === repo.rel ? pushResult.msg : null}
          onHeaderClick={() => handleHeaderClick(repo.rel)}
          onPush={() => void push(repo.rel)}
          onRefresh={() => void reloadAll()}
        />
      ))}
      {settings.hasToken && activeInfo?.githubRepo ? (
        <>
          <PrSection
            key={`prs:${project.id}:${activeRel}`}
            project={project}
            repoRel={activeRel}
            gitInfo={activeInfo}
            pushing={pushingRel === activeRel}
            onRequestPush={activePush}
          />
          <RunsSection
            key={`runs:${project.id}:${activeRel}`}
            project={project}
            repoRel={activeRel}
            gitInfo={activeInfo}
          />
        </>
      ) : settings.hasToken && activeInfo && !activeInfo.githubRepo ? (
        <div className="px-3 py-4 text-[12px] text-foreground/55">
          {isMulti ? (
            <>
              <span className="font-medium">{repos.find((r) => r.rel === activeRel)?.name}</span>{' '}
              has no GitHub remote on <code>origin</code>, so PRs and runs aren’t available.
            </>
          ) : (
            <>
              This repo has no GitHub remote on <code>origin</code>, so PRs and runs aren’t
              available.
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
