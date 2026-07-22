import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { WalkResult } from '@shared/types'

/** Hard cap on files returned to the renderer to bound payload size. */
export const MAX_FILES = 20_000

/** Parse `git ls-files -z` output into a list of relative paths. */
export function parseLsFilesZ(output: string): string[] {
  return output.split('\0').filter((p) => p !== '')
}

/** Directory names the fallback walk never descends into. */
export function shouldPruneDir(name: string): boolean {
  return name === 'node_modules' || name.startsWith('.')
}

/**
 * List tracked + untracked-but-not-ignored files in one git process. Resolves
 * null when the directory is not a git repo or git is unavailable, so the
 * caller can fall back to a manual walk.
 */
function gitLsFiles(root: string): Promise<string[] | null> {
  return new Promise((resolveP) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      })
    } catch {
      resolveP(null)
      return
    }
    let stdout = ''
    child.stdout?.on('data', (d) => {
      stdout += d.toString()
    })
    child.on('error', () => resolveP(null))
    child.on('close', (code) => resolveP(code === 0 ? parseLsFilesZ(stdout) : null))
  })
}

/** Recursive fallback walk that prunes heavy/hidden directories. */
async function walkDir(root: string, dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (shouldPruneDir(entry.name)) continue
      await walkDir(root, abs, out)
    } else if (entry.isFile()) {
      out.push(relative(root, abs).split(sep).join('/'))
    }
  }
}

/** Enumerate project files: git for repos, pruning walk otherwise. */
export async function walkProjectFiles(root: string): Promise<WalkResult> {
  const gitFiles = await gitLsFiles(root)
  if (gitFiles) {
    const truncated = gitFiles.length > MAX_FILES
    return { files: truncated ? gitFiles.slice(0, MAX_FILES) : gitFiles, truncated }
  }
  const out: string[] = []
  await walkDir(root, root, out)
  return { files: out, truncated: out.length >= MAX_FILES }
}
