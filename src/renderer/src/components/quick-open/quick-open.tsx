import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectId, WalkResult } from '@shared/types'
import { useWorkspace } from '@renderer/state/store'
import { rankFiles, type RankedFile } from '@renderer/lib/fuzzy-match'
import { FileIcon } from '../right-sidebar/file-icon'

interface QuickOpenProps {
  open: boolean
  projectId: ProjectId
  onClose: () => void
}

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** Render a basename with matched characters highlighted in the accent color. */
function Highlighted({ name, indices }: { name: string; indices: number[] }) {
  if (indices.length === 0) return <>{name}</>
  const set = new Set(indices)
  return (
    <>
      {[...name].map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="text-accent font-medium">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </>
  )
}

export function QuickOpen({ open, projectId, onClose }: QuickOpenProps) {
  const openFile = useWorkspace((s) => s.openFile)
  const [query, setQuery] = useState('')
  const [walk, setWalk] = useState<WalkResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load the file list once per open; reset transient state each time.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(0)
    setWalk(null)
    setLoading(true)
    let cancelled = false
    window.api.fs
      .walk(projectId)
      .then((result) => {
        if (!cancelled) setWalk(result)
      })
      .catch(() => {
        if (!cancelled) setWalk({ files: [], truncated: false })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const results: RankedFile[] = useMemo(
    () => (walk ? rankFiles(query, walk.files) : []),
    [walk, query]
  )

  const active = results.length === 0 ? 0 : Math.min(selected, results.length - 1)

  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const choose = (file: RankedFile | undefined): void => {
    if (!file) return
    openFile({ projectId, path: file.path })
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (results.length > 0) setSelected((active + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length > 0) setSelected((active - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active])
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Go to file"
        className="w-full max-w-[560px] rounded-lg bg-background/95 border border-foreground/10 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Go to file…"
          aria-label="Search files"
          className="w-full px-3 py-2.5 bg-transparent text-[13px] text-foreground/90 outline-none border-b border-foreground/10"
        />
        <ul ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {loading && (
            <li className="px-3 py-2 text-[11px] text-foreground/40">Loading files…</li>
          )}
          {!loading && results.length === 0 && (
            <li className="px-3 py-2 text-[11px] text-foreground/40">No files match.</li>
          )}
          {results.map((r, i) => {
            const name = basename(r.path)
            const dir = dirname(r.path)
            return (
              <li
                key={r.path}
                title={r.path}
                onMouseEnter={() => setSelected(i)}
                onClick={() => choose(r)}
                className={`flex items-center gap-1.5 px-3 py-1 text-[12px] cursor-pointer ${
                  i === active ? 'bg-foreground/10' : 'hover:bg-foreground/5'
                }`}
              >
                <FileIcon name={name} isDirectory={false} size={14} />
                <span className="text-foreground/90 shrink-0">
                  <Highlighted name={name} indices={r.matchedIndices} />
                </span>
                {dir && <span className="truncate text-[11px] text-foreground/40 min-w-0">{dir}</span>}
              </li>
            )
          })}
          {!loading && walk?.truncated && (
            <li className="px-3 py-1.5 text-[10px] text-foreground/30">
              Showing the first {walk.files.length} files.
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
