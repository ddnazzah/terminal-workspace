import { useCallback, useEffect, useState } from 'react'
import type { GitInfo, Project, PullRequestDetail, PullRequestSummary } from '@shared/types'
import { CollapsibleSection } from './collapsible-section'

interface Props {
  project: Project
  repoRel: string
  gitInfo: GitInfo | null
  onRequestPush: () => Promise<void>
  pushing: boolean
}

type Filter = 'open' | 'closed' | 'all'

export function PrSection({ project, repoRel, gitInfo, onRequestPush, pushing }: Props) {
  const [prs, setPrs] = useState<PullRequestSummary[]>([])
  const [filter, setFilter] = useState<Filter>('open')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.api.github.listPullRequests(project.id, filter, repoRel)
      setPrs(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [project.id, filter, repoRel])

  useEffect(() => {
    void reload()
  }, [reload])

  if (creating) {
    return (
      <CreatePrForm
        project={project}
        repoRel={repoRel}
        gitInfo={gitInfo}
        pushing={pushing}
        onRequestPush={onRequestPush}
        onClose={() => setCreating(false)}
        onCreated={(pr) => {
          setCreating(false)
          setOpen(pr.number)
          void reload()
        }}
      />
    )
  }

  if (open !== null) {
    return (
      <PrDetailView
        project={project}
        repoRel={repoRel}
        number={open}
        onBack={() => {
          setOpen(null)
          void reload()
        }}
      />
    )
  }

  return (
    <CollapsibleSection
      title="Pull Requests"
      count={loading ? undefined : prs.length}
      actions={
        <>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="text-[11px] bg-foreground/5 text-foreground/80 px-1.5 py-0.5 rounded outline-none"
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
          <button
            type="button"
            onClick={() => setCreating(true)}
            title="Create PR from current branch"
            className="text-[11px] px-2 py-0.5 rounded-md bg-foreground/10 hover:bg-foreground/20 text-foreground/85"
          >
            + New
          </button>
        </>
      }
    >
      {loading && (
        <div className="text-[11px] text-foreground/40 px-3 py-2">Loading…</div>
      )}
      {error && (
        <div className="text-[11px] text-red-400 px-3 py-2">{error}</div>
      )}
      {!loading && prs.length === 0 && !error && (
        <div className="text-[11px] text-foreground/40 px-3 py-2">No pull requests.</div>
      )}
      <ul className="pb-2">
        {prs.map((pr) => (
          <li key={pr.number}>
            <button
              type="button"
              onClick={() => setOpen(pr.number)}
              className="flex flex-col gap-0.5 w-full px-3 py-1.5 hover:bg-foreground/5 text-left"
            >
              <div className="flex items-center gap-1.5">
                <PrStateDot pr={pr} />
                <span className="text-[12px] text-foreground/85 truncate flex-1">
                  {pr.title}
                </span>
                <span className="text-[11px] text-foreground/40 tabular-nums">
                  #{pr.number}
                </span>
              </div>
              <div className="text-[10px] text-foreground/45 truncate pl-3.5">
                {pr.author} · {pr.headRef} → {pr.baseRef}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  )
}

function PrStateDot({ pr }: { pr: PullRequestSummary }) {
  let cls = 'bg-emerald-400'
  let title = 'Open'
  if (pr.merged) {
    cls = 'bg-purple-400'
    title = 'Merged'
  } else if (pr.state === 'closed') {
    cls = 'bg-red-400'
    title = 'Closed'
  } else if (pr.draft) {
    cls = 'bg-foreground/30'
    title = 'Draft'
  }
  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-block w-2 h-2 rounded-full ${cls} flex-shrink-0`}
    />
  )
}

// ----- Create PR form -----

function CreatePrForm({
  project,
  repoRel,
  gitInfo,
  pushing,
  onRequestPush,
  onClose,
  onCreated,
}: {
  project: Project
  repoRel: string
  gitInfo: GitInfo | null
  pushing: boolean
  onRequestPush: () => Promise<void>
  onClose: () => void
  onCreated: (pr: PullRequestSummary) => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState(gitInfo?.defaultBranch ?? 'main')
  const [draft, setDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const head = gitInfo?.branch ?? ''
  const needsPush = !gitInfo?.hasUpstream

  const submit = async () => {
    setError(null)
    setSubmitting(true)
    try {
      const pr = await window.api.github.createPullRequest({
        projectId: project.id,
        repoRel,
        title: title.trim(),
        body,
        head,
        base,
        draft,
      })
      onCreated(pr)
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
          New Pull Request
        </h3>
        <span className="w-8" />
      </div>

      <div className="px-3 pb-3 space-y-2">
        <div className="text-[11px] text-foreground/55">
          From <span className="text-foreground/85 font-mono">{head || '—'}</span> into{' '}
          <span className="text-foreground/85 font-mono">{base}</span>
        </div>

        {needsPush && (
          <div className="text-[11px] text-amber-300 bg-amber-500/10 px-2 py-1.5 rounded-md flex items-center gap-2">
            <span className="flex-1">Branch has no upstream — push it first.</span>
            <button
              type="button"
              onClick={() => void onRequestPush()}
              disabled={pushing}
              className="text-[11px] px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-50"
            >
              {pushing ? 'Pushing…' : 'Push'}
            </button>
          </div>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full bg-foreground/5 text-[13px] px-2 py-1.5 rounded-md outline-none focus:bg-foreground/10"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Description (markdown)"
          rows={6}
          className="w-full bg-foreground/5 text-[12px] px-2 py-1.5 rounded-md outline-none focus:bg-foreground/10 resize-y font-mono"
        />
        <input
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="base branch"
          className="w-full bg-foreground/5 text-[12px] px-2 py-1.5 rounded-md outline-none focus:bg-foreground/10 font-mono"
        />
        <label className="flex items-center gap-2 text-[12px] text-foreground/70">
          <input
            type="checkbox"
            checked={draft}
            onChange={(e) => setDraft(e.target.checked)}
          />
          Create as draft
        </label>

        {error && (
          <div className="text-[11px] text-red-400 bg-red-500/10 px-2 py-1 rounded">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting || needsPush || !title.trim() || !head}
          className="w-full text-[13px] py-2 rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Creating…' : 'Create pull request'}
        </button>
      </div>
    </section>
  )
}

// ----- PR detail -----

function PrDetailView({
  project,
  repoRel,
  number,
  onBack,
}: {
  project: Project
  repoRel: string
  number: number
  onBack: () => void
}) {
  const [pr, setPr] = useState<PullRequestDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [merging, setMerging] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const detail = await window.api.github.getPullRequest(project.id, number, repoRel)
      setPr(detail)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [project.id, number, repoRel])

  useEffect(() => {
    void load()
  }, [load])

  const postComment = async () => {
    if (!comment.trim()) return
    setPosting(true)
    try {
      await window.api.github.commentPullRequest(project.id, number, comment.trim(), repoRel)
      setComment('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPosting(false)
    }
  }

  const merge = async (method: 'merge' | 'squash' | 'rebase') => {
    setMerging(true)
    try {
      await window.api.github.mergePullRequest(project.id, number, method, repoRel)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMerging(false)
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
          PR #{number}
        </h3>
        {pr && (
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-foreground/50 hover:text-foreground"
          >
            Open ↗
          </a>
        )}
      </div>
      <div className="px-3 pb-3 space-y-3 overflow-y-auto">
        {loading && <div className="text-[11px] text-foreground/40">Loading…</div>}
        {error && (
          <div className="text-[11px] text-red-400 bg-red-500/10 px-2 py-1 rounded">
            {error}
          </div>
        )}
        {pr && (
          <>
            <div className="text-[13px] font-medium text-foreground/90">{pr.title}</div>
            <div className="text-[11px] text-foreground/55">
              {pr.author} · {pr.headRef} → {pr.baseRef} · +{pr.additions} −{pr.deletions} in{' '}
              {pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'}
            </div>

            {pr.body && (
              <div className="text-[12px] text-foreground/75 whitespace-pre-wrap bg-foreground/5 rounded-md p-2 max-h-48 overflow-y-auto">
                {pr.body}
              </div>
            )}

            {pr.checks.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-foreground/40">
                  Checks
                </div>
                {pr.checks.slice(0, 8).map((c, i) => (
                  <div key={`${c.name}-${i}`} className="flex items-center gap-1.5 text-[11px]">
                    <CheckDot status={c.status} conclusion={c.conclusion} />
                    <span className="truncate flex-1 text-foreground/80">{c.name}</span>
                    <span className="text-foreground/45">{c.conclusion ?? c.status}</span>
                  </div>
                ))}
              </div>
            )}

            {pr.state === 'open' && !pr.merged && (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={merging}
                  onClick={() => merge('squash')}
                  className="flex-1 text-[11px] py-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 disabled:opacity-50"
                >
                  Squash
                </button>
                <button
                  type="button"
                  disabled={merging}
                  onClick={() => merge('merge')}
                  className="flex-1 text-[11px] py-1.5 rounded-md bg-foreground/10 hover:bg-foreground/20 disabled:opacity-50"
                >
                  Merge
                </button>
                <button
                  type="button"
                  disabled={merging}
                  onClick={() => merge('rebase')}
                  className="flex-1 text-[11px] py-1.5 rounded-md bg-foreground/10 hover:bg-foreground/20 disabled:opacity-50"
                >
                  Rebase
                </button>
              </div>
            )}

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-foreground/40">
                Comments ({pr.comments.length})
              </div>
              {pr.comments.slice(-4).map((c) => (
                <div key={c.id} className="text-[11px] bg-foreground/5 rounded-md p-2">
                  <div className="text-foreground/55 mb-0.5">{c.author}</div>
                  <div className="text-foreground/80 whitespace-pre-wrap">{c.body}</div>
                </div>
              ))}
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment…"
                rows={3}
                className="w-full bg-foreground/5 text-[12px] px-2 py-1.5 rounded-md outline-none focus:bg-foreground/10 resize-y"
              />
              <button
                type="button"
                onClick={postComment}
                disabled={posting || !comment.trim()}
                className="w-full text-[12px] py-1.5 rounded-md bg-foreground/10 hover:bg-foreground/20 disabled:opacity-40"
              >
                {posting ? 'Posting…' : 'Comment'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function CheckDot({ status, conclusion }: { status: string; conclusion: string | null }) {
  let cls = 'bg-foreground/30'
  if (status !== 'completed') cls = 'bg-amber-400 animate-pulse'
  else if (conclusion === 'success') cls = 'bg-emerald-400'
  else if (conclusion === 'failure' || conclusion === 'timed_out') cls = 'bg-red-400'
  else if (conclusion === 'cancelled' || conclusion === 'skipped') cls = 'bg-foreground/30'
  else if (conclusion === 'neutral') cls = 'bg-sky-300'
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} flex-shrink-0`} />
}
