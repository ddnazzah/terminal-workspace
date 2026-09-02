import type { GitChangeStatus, GitFileStatus } from '@shared/types'

export function statusColor(s?: GitFileStatus | GitChangeStatus): string | undefined {
  switch (s) {
    case 'modified':
      return 'var(--git-modified)'
    case 'added':
    case 'untracked':
    // VS Code paints renames with the same green as additions.
    case 'renamed':
      return 'var(--git-added)'
    case 'deleted':
      return 'var(--git-deleted)'
    case 'conflict':
      return 'var(--git-conflict)'
    default:
      return undefined
  }
}
