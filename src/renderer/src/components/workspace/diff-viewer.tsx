import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { languageForFilename } from '@renderer/lib/monaco-language'
import { diffSidesFor, type GitGroupKind, type GitRev } from '@renderer/lib/git-diff-sides'
import type { GitChangeRow } from '@renderer/lib/git-groups'

interface Props {
  projectId: string
  /** Repo path relative to the project root; '' for the project root. */
  repoRel: string
  row: GitChangeRow
  group: GitGroupKind
}

/**
 * Side-by-side diff for a Source Control row, rendered with Monaco's diff
 * editor. Which two revisions are compared is decided by `diffSidesFor`.
 */
export function DiffViewer({ projectId, repoRel, row, group }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const sides = diffSidesFor(row, group)

  useEffect(() => {
    let disposed = false

    const readSide = async (rev: GitRev | null): Promise<string> => {
      if (rev === null) return ''
      if (rev === 'worktree') {
        const full = repoRel ? `${repoRel}/${row.path}` : row.path
        return (await window.api.fs.readText(projectId, full)) ?? ''
      }
      return (await window.api.git.fileAtRev(projectId, repoRel, row.path, rev)) ?? ''
    }

    setLoading(true)
    setError(null)

    void Promise.all([readSide(sides.left), readSide(sides.right)])
      .then(([original, modified]) => {
        if (disposed || !hostRef.current) return

        const language = languageForFilename(row.path.split('/').pop() ?? row.path)
        const editor = monaco.editor.createDiffEditor(hostRef.current, {
          readOnly: true,
          automaticLayout: true,
          renderSideBySide: true,
          // VS Code hides unchanged regions in the SCM diff by default.
          hideUnchangedRegions: { enabled: true },
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          theme: 'vs-dark',
        })

        editor.setModel({
          original: monaco.editor.createModel(original, language),
          modified: monaco.editor.createModel(modified, language),
        })

        editorRef.current = editor
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (disposed) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      disposed = true
      const editor = editorRef.current
      if (editor) {
        // Models are created per mount, so dispose them with the editor to
        // avoid leaking one pair per diff opened.
        const model = editor.getModel()
        editor.dispose()
        model?.original.dispose()
        model?.modified.dispose()
        editorRef.current = null
      }
    }
  }, [projectId, repoRel, row.path, row.status, row.isUntracked, group, sides.left, sides.right])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="text-[12px] text-foreground/55">Couldn’t load diff: {error}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-1 text-[11px]"
        style={{
          borderColor: 'var(--vscode-panel-border)',
          color: 'var(--vscode-sideBar-foreground)',
        }}
      >
        <span className="truncate opacity-70">{row.path}</span>
        <span className="ml-auto shrink-0 opacity-50">
          {sides.leftLabel || '(none)'} ↔ {sides.rightLabel || '(none)'}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background text-[12px] text-foreground/45">
            Loading diff…
          </div>
        )}
        <div ref={hostRef} className="h-full w-full" />
      </div>
    </div>
  )
}
