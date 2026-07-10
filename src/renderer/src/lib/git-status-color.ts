import type { GitFileStatus } from '@shared/types'

export function statusColor(s?: GitFileStatus): string | undefined {
  switch (s) {
    case 'modified':
      return 'var(--git-modified)'
    case 'added':
    case 'untracked':
      return 'var(--git-added)'
    case 'deleted':
      return 'var(--git-deleted)'
    case 'conflict':
      return 'var(--git-conflict)'
    default:
      return undefined
  }
}
