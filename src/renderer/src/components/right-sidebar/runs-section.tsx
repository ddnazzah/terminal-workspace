import { useCallback, useEffect, useState } from 'react'
import type {
  GitInfo,
  Project,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowSummary,
} from '@shared/types'
import { CollapsibleSection } from './collapsible-section'

interface Props {
  project: Project
  repoRel: string
  gitInfo: GitInfo | null
}

export function RunsSection({ project, repoRel, gitInfo }: Props) {
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterMine, setFilterMine] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [dispatching, setDispatching] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.api.github.listRuns(
        project.id,
        filterMine && gitInfo?.branch ? { branch: gitInfo.branch } : undefined,
        repoRel
      )
      setRuns(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [project.id, filterMine, gitInfo?.branch, repoRel])

  useEffect(() => {
    void reload()
  }, [reload])

  if (open !== null) {
    return (
      <RunDetailView
        project={project}
        repoRel={repoRel}
        runId={open}
        onBack={() => {
          setOpen(null)
          void reload()
        }}
      />
    )
  }

  if (dispatching) {
    return (
      <DispatchWorkflowForm
        project={project}
        repoRel={repoRel}
        gitInfo={gitInfo}
        onClose={() => setDispatching(false)}
        onDispatched={() => {
          setDispatching(false)
          void reload()
        }}
      />
    )
  }

  return (
    <CollapsibleSection
      title="CI / Workflow Runs"
      count={loading ? undefined : runs.length}
      actions={
        <>
          {gitInfo?.branch && (
            <label className="flex items-center gap-1 text-[10px] text-foreground/60">
              <input
                type="checkbox"
                checked={filterMine}
                onChange={(e) => setFilterMine(e.target.checked)}
              />
              this branch
            </label>
          )}
          <button
            type="button"
            onClick={() => setDispatching(true)}
            title="Trigger a workflow"
            className="text-[11px] px-2 py-0.5 rounded-md bg-foreground/10 hover:bg-foreground/20 text-foreground/85"
          >
            ▶ Run
          </button>
          <button
            type="button"
            onClick={() => void reload()}
            title="Refresh"
            className="text-[11px] text-foreground/55 hover:text-foreground"
          >
            ↻
          </button>
        </>
      }
    >
      {loading && <div className="text-[11px] text-foreground/40 px-3 py-2">Loading…</div>}
      {error && <div className="text-[11px] text-red-400 px-3 py-2">{error}</div>}
      {!loading && runs.length === 0 && !error && (
        <div className="text-[11px] text-foreground/40 px-3 py-2">No runs yet.</div>
      )}
      <ul className="pb-2">
        {runs.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setOpen(r.id)}
              className="flex flex-col gap-0.5 w-full px-3 py-1.5 hover:bg-foreground/5 text-left"
            >
              <div className="flex items-center gap-1.5">
                <RunDot status={r.status} conclusion={r.conclusion} />
                <span className="text-[12px] text-foreground/85 truncate flex-1">
                  {r.name ?? 'Workflow'}
                </span>
                <span className="text-[11px] text-foreground/40 tabular-nums">
                  #{r.runNumber}
                </span>
              </div>
              <div className="text-[10px] text-foreground/45 truncate pl-3.5">
                {r.event} · {r.branch ?? '—'} · {r.actor}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  )
}

function RunDot({ status, conclusion }: { status: string; conclusion: string | null }) {
  let cls = 'bg-foreground/30'
  if (status === 'in_progress' || status === 'queued' || status === 'waiting' || status === 'pending')
    cls = 'bg-amber-400 animate-pulse'
  else if (conclusion === 'success') cls = 'bg-emerald-400'
  else if (conclusion === 'failure' || conclusion === 'timed_out') cls = 'bg-red-400'
  else if (conclusion === 'cancelled') cls = 'bg-foreground/40'
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} flex-shrink-0`} />
}

// ----- Run detail -----

function RunDetailView({
  project,
  repoRel,
  runId,
  onBack,
}: {
  project: Project
  repoRel: string
  runId: number
  onBack: () => void
}) {
  const [run, setRun] = useState<WorkflowRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRun(await window.api.github.getRun(project.id, runId, repoRel))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [project.id, runId, repoRel])

  useEffect(() => {
    void load()
  }, [load])

  // auto-refresh while in progress
  useEffect(() => {
    if (!run) return
    if (run.status !== 'in_progress' && run.status !== 'queued' && run.status !== 'pending') return
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [run, load])

  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border-b border-accent/7 max-h-full flex flex-col">
      <div className="px-3 py-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-foreground/50 hover:text-foreground"
        >
          ← Back
        </button>
        <h3 className="text-[11px] uppercase tracking-wider text-foreground/45 font-medium flex-1 text-center">
          Run {run ? `#${run.runNumber}` : ''}
        </h3>
        {run && (
          <a
            href={run.url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-foreground/50 hover:text-foreground"
          >
            Open ↗
          </a>
        )}
      </div>
      <div className="px-3 pb-3 space-y-2 overflow-y-auto">
        {loading && <div className="text-[11px] text-foreground/40">Loading…</div>}
        {error && (
          <div className="text-[11px] text-red-400 bg-red-500/10 px-2 py-1 rounded">
            {error}
          </div>
        )}
        {run && (
          <>
            <div className="text-[13px] font-medium text-foreground/90">
              {run.name ?? 'Workflow'}
            </div>
            <div className="text-[11px] text-foreground/55">
              {run.status} · {run.conclusion ?? '—'} · {run.event} · {run.branch ?? '—'} ·{' '}
              {run.actor}
            </div>

            {(run.status === 'in_progress' || run.status === 'queued') && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(() => window.api.github.cancelRun(project.id, run.id, repoRel))
                }
                className="w-full text-[11px] py-1.5 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-200 disabled:opacity-50"
              >
                Cancel run
              </button>
            )}

            {run.status === 'completed' && (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(() => window.api.github.rerunRun(project.id, run.id, repoRel))
                  }
                  className="flex-1 text-[11px] py-1.5 rounded-md bg-foreground/10 hover:bg-foreground/20 disabled:opacity-50"
                >
                  Re-run all
                </button>
                {run.conclusion === 'failure' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        window.api.github.rerunFailed(project.id, run.id, repoRel)
                      )
                    }
                    className="flex-1 text-[11px] py-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 disabled:opacity-50"
                  >
                    Re-run failed
                  </button>
                )}
              </div>
            )}

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-foreground/40">Jobs</div>
              {run.jobs.map((job) => (
                <div key={job.id} className="bg-foreground/5 rounded-md p-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <RunDot status={job.status} conclusion={job.conclusion} />
                    <span className="text-[12px] text-foreground/85 truncate flex-1">
                      {job.name}
                    </span>
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-foreground/45 hover:text-foreground"
                    >
                      logs ↗
                    </a>
                  </div>
                  {job.steps.length > 0 && (
                    <ul className="pl-3 space-y-0.5">
                      {job.steps.map((s) => (
                        <li
                          key={s.number}
                          className="flex items-center gap-1.5 text-[11px] text-foreground/65"
                        >
                          <RunDot status={s.status} conclusion={s.conclusion} />
                          <span className="truncate">{s.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

// ----- Dispatch workflow -----

function DispatchWorkflowForm({
  project,
  repoRel,
  gitInfo,
  onClose,
  onDispatched,
}: {
  project: Project
  repoRel: string
  gitInfo: GitInfo | null
  onClose: () => void
  onDispatched: () => void
}) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [ref, setRef] = useState(gitInfo?.branch ?? gitInfo?.defaultBranch ?? 'main')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api.github
      .listWorkflows(project.id, repoRel)
      .then((list) => {
        if (cancelled) return
        setWorkflows(list)
        setSelected(list[0]?.id ?? null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [project.id, repoRel])

  const submit = async () => {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      await window.api.github.dispatchWorkflow(project.id, selected, ref, undefined, repoRel)
      onDispatched()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="border-b border-accent/7">
      <div className="px-3 py-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-foreground/50 hover:text-foreground"
        >
          ← Back
        </button>
        <h3 className="text-[11px] uppercase tracking-wider text-foreground/45 font-medium flex-1 text-center">
          Trigger Workflow
        </h3>
        <span className="w-8" />
      </div>
      <div className="px-3 pb-3 space-y-2">
        {loading && <div className="text-[11px] text-foreground/40">Loading workflows…</div>}
        {error && (
          <div className="text-[11px] text-red-400 bg-red-500/10 px-2 py-1 rounded">
            {error}
          </div>
        )}
        {!loading && workflows.length === 0 && (
          <div className="text-[11px] text-foreground/40">No workflows in this repo.</div>
        )}
        {workflows.length > 0 && (
          <>
            <select
              value={selected ?? ''}
              onChange={(e) => setSelected(Number(e.target.value))}
              className="w-full bg-foreground/5 text-[12px] px-2 py-1.5 rounded-md outline-none"
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.path})
                </option>
              ))}
            </select>
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="ref (branch or tag)"
              className="w-full bg-foreground/5 text-[12px] px-2 py-1.5 rounded-md outline-none focus:bg-foreground/10 font-mono"
            />
            <div className="text-[10px] text-foreground/40">
              Only workflows with <code className="text-foreground/60">workflow_dispatch</code> will
              actually start.
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !selected || !ref.trim()}
              className="w-full text-[12px] py-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
            >
              {submitting ? 'Dispatching…' : 'Dispatch'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
