// Naming for per-card worktrees and branches. Pure and path-only — the actual
// `git worktree` calls live in worktree.ts.

import { dirname } from 'node:path'

/**
 * Path/branch-safe slug. Strips the characters git refuses in a ref name
 * (`~ ^ : ? * [ \ ..`) along with anything else awkward in a directory name.
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'card'
}

/** Branch for a card, namespaced so `git branch --list 'card/*'` finds them all. */
export function branchForCard(cardNumber: number): string {
  return `card/${cardNumber}`
}

/** Directory name for a card's worktree, e.g. `wterm-card-42`. */
export function worktreeDirName(projectName: string, cardNumber: number): string {
  return `${slugify(projectName)}-card-${cardNumber}`
}

/**
 * Where worktrees are created. Defaults to the project's parent directory so
 * card worktrees land as siblings of the repo, the way they'd be made by hand.
 */
export function worktreeRootFor(configuredRoot: string, projectPath: string): string {
  const configured = configuredRoot.trim()
  return configured || dirname(projectPath)
}
