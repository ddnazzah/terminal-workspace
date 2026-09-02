import { useEffect, useState } from 'react'
import { fileChangeFor, repoRelForPath } from '@renderer/lib/file-change-view'
import type { GitChangeRow } from '@renderer/lib/git-groups'

export interface FileChange {
  /** Repo the file belongs to, relative to the project root; '' for the root. */
  repoRel: string
  /** The file's overall change against HEAD. */
  row: GitChangeRow
}

/**
 * The uncommitted change on one open file, or null when it has none.
 *
 * There is no push channel for git status, so this pulls — on mount, and again
 * whenever `revision` changes. Pass the file's last-saved content as the
 * revision so saving re-checks: a file can gain or lose its Changes pane with
 * a single ⌘S.
 */
export function useFileChange(
  projectId: string,
  projectPath: string,
  revision: string
): FileChange | null {
  const [change, setChange] = useState<FileChange | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async (): Promise<void> => {
      const repos = await window.api.git.repos(projectId)
      const repoRel = repoRelForPath(projectPath, repos)
      if (cancelled) return
      // Not under version control — there is nothing to diff against.
      if (repoRel === null) {
        setChange(null)
        return
      }

      const entries = await window.api.git.statusEntries(projectId, repoRel)
      if (cancelled) return

      // Status entries are relative to the repo, tab paths to the project.
      const repoPath = repoRel === '' ? projectPath : projectPath.slice(repoRel.length + 1)
      const row = fileChangeFor(entries, repoPath)
      setChange(row ? { repoRel, row } : null)
    }

    void load().catch((err: unknown) => {
      // A failed status read must not take the editor down with it: fall back
      // to "no changes" so the tab still shows the file.
      console.warn('[file-change] could not read git status:', err)
      if (!cancelled) setChange(null)
    })

    return () => {
      cancelled = true
    }
  }, [projectId, projectPath, revision])

  return change
}
