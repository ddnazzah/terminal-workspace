import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SearchHit } from '@shared/types'
import { useWorkspace } from '@renderer/state/store'
import { Codicon } from '../codicon'
import { FileIcon } from './file-icon'

interface Props {
  projectId: string
  /** Repo path relative to the project root; '' for the project root. */
  repoRel?: string
}

interface FileGroup {
  path: string
  hits: SearchHit[]
}

/** Debounce so a query is not fired on every keystroke. */
const DEBOUNCE_MS = 200

/**
 * VS Code's search view: query the project, grouped by file, click to open.
 *
 * Results come from `git grep`, which already honours .gitignore and skips
 * binaries — matching what VS Code's search excludes by default.
 */
export function SearchPanel({ projectId, repoRel = '' }: Props) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [replaceNote, setReplaceNote] = useState<string | null>(null)
  const openFile = useWorkspace((s) => s.openFile)

  // Guards against an older, slower query overwriting a newer result.
  const runIdRef = useRef(0)

  const run = useCallback(
    async (q: string) => {
      const runId = ++runIdRef.current
      if (q.trim() === '') {
        setHits([])
        setTruncated(false)
        return
      }

      setBusy(true)
      try {
        const res = await window.api.git.search(projectId, repoRel, q, {
          caseSensitive,
          wholeWord,
          regex,
        })
        if (runId !== runIdRef.current) return
        setHits(res.hits)
        setTruncated(res.truncated)
      } finally {
        if (runId === runIdRef.current) setBusy(false)
      }
    },
    [projectId, repoRel, caseSensitive, wholeWord, regex]
  )

  useEffect(() => {
    setReplaceNote(null)
    const id = setTimeout(() => void run(query), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query, run])

  const groups = useMemo<FileGroup[]>(() => {
    const byPath = new Map<string, SearchHit[]>()
    for (const hit of hits) {
      const list = byPath.get(hit.path)
      if (list) list.push(hit)
      else byPath.set(hit.path, [hit])
    }
    return [...byPath.entries()].map(([path, list]) => ({ path, hits: list }))
  }, [hits])

  const replaceAll = async (paths: string[]): Promise<void> => {
    if (query.trim() === '' || paths.length === 0) return
    setBusy(true)
    setReplaceNote(null)
    try {
      const res = await window.api.git.replace(projectId, repoRel, paths, query, replacement, {
        regex,
        caseSensitive,
        wholeWord,
      })
      setReplaceNote(
        `Replaced ${res.replacements} occurrence${res.replacements === 1 ? '' : 's'} in ${res.filesChanged} file${res.filesChanged === 1 ? '' : 's'}`
      )
      // Re-run so the results reflect what is now on disk.
      await run(query)
    } finally {
      setBusy(false)
    }
  }

  const open = (hit: SearchHit): void => {
    const full = repoRel ? `${repoRel}/${hit.path}` : hit.path
    openFile({ projectId, path: full })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start gap-1 px-2 py-2">
        <button
          type="button"
          onClick={() => setShowReplace((v) => !v)}
          title={showReplace ? 'Hide Replace' : 'Toggle Replace'}
          aria-label="Toggle Replace"
          aria-expanded={showReplace}
          className="mt-1 shrink-0 rounded p-0.5 hover:bg-[var(--vscode-list-hoverBackground)]"
          style={{ color: 'var(--vscode-icon-foreground)' }}
        >
          <Codicon name={showReplace ? 'chevron-down' : 'chevron-right'} size={16} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search in project"
          className="min-w-0 flex-1 rounded px-2 py-1 text-[13px] outline-none"
          style={{
            background: 'var(--vscode-input-background)',
            border: '1px solid var(--vscode-input-border)',
            color: 'var(--vscode-input-foreground)',
          }}
        />
        <Toggle active={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} label="Match Case">
          Aa
        </Toggle>
        <Toggle active={wholeWord} onClick={() => setWholeWord((v) => !v)} label="Match Whole Word">
          ab
        </Toggle>
        <Toggle active={regex} onClick={() => setRegex((v) => !v)} label="Use Regular Expression">
          .*
        </Toggle>
        </div>

        {showReplace && (
          <div className="flex items-center gap-1">
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replace"
              aria-label="Replace with"
              className="min-w-0 flex-1 rounded px-2 py-1 text-[13px] outline-none"
              style={{
                background: 'var(--vscode-input-background)',
                border: '1px solid var(--vscode-input-border)',
                color: 'var(--vscode-input-foreground)',
              }}
            />
            <button
              type="button"
              disabled={busy || hits.length === 0}
              onClick={() => void replaceAll(groups.map((g) => g.path))}
              title="Replace All"
              aria-label="Replace All"
              className="shrink-0 rounded px-2 py-1 text-[11px] disabled:opacity-35"
              style={{
                background: 'var(--vscode-button-background)',
                color: 'var(--vscode-button-foreground)',
              }}
            >
              All
            </button>
          </div>
        )}
        </div>
      </div>

      <div className="px-3 pb-1 text-[11px] opacity-50">
        {replaceNote
          ? replaceNote
          : busy
          ? 'Searching…'
          : query.trim() === ''
            ? ''
            : hits.length === 0
              ? 'No results'
              : `${hits.length}${truncated ? '+' : ''} result${hits.length === 1 ? '' : 's'} in ${groups.length} file${groups.length === 1 ? '' : 's'}`}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.map((group) => (
          <FileResults key={group.path} group={group} onOpen={open} />
        ))}
      </div>
    </div>
  )
}

function FileResults({ group, onOpen }: { group: FileGroup; onOpen: (hit: SearchHit) => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const name = group.path.split('/').pop() ?? group.path
  const dir = group.path.slice(0, Math.max(0, group.path.length - name.length - 1))

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1 px-2 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
        style={{ height: 22, color: 'var(--vscode-sideBar-foreground)' }}
      >
        <Codicon name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} />
        <FileIcon name={name} isDirectory={false} />
        <span className="truncate text-[13px]">{name}</span>
        <span className="truncate text-[13px] opacity-45">{dir}</span>
        <span className="ml-auto shrink-0 text-[11px] opacity-60">{group.hits.length}</span>
      </button>

      {!collapsed &&
        group.hits.map((hit) => (
          <button
            key={`${hit.line}:${hit.column}`}
            type="button"
            onClick={() => onOpen(hit)}
            title={`${hit.path}:${hit.line}`}
            className="flex w-full items-center gap-2 pl-8 pr-2 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
            style={{ height: 22 }}
          >
            <span className="shrink-0 text-[11px] opacity-40">{hit.line}</span>
            {/* trimStart so deeply indented matches stay readable in a narrow panel */}
            <span className="truncate font-mono text-[12px] opacity-80">{hit.text.trimStart()}</span>
          </button>
        ))}
    </div>
  )
}

function Toggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className="shrink-0 rounded px-1.5 py-1 text-[11px]"
      style={{
        background: active ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
        color: active
          ? 'var(--vscode-list-activeSelectionForeground)'
          : 'var(--vscode-icon-foreground)',
      }}
    >
      {children}
    </button>
  )
}
