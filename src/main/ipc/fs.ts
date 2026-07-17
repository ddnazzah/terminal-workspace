import { ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { IPC, MAX_TEXT_FILE_BYTES, type FsEntry, type ProjectId, type WalkResult } from '@shared/types'
import { getProject } from '../store/state'
import { walkProjectFiles } from './walk-project'

// Hard cap on a single pasted/dropped blob — pastes from screenshot tools land
// here, and we never want a runaway clipboard payload to fill the disk.
const MAX_PASTE_BYTES = 25 * 1024 * 1024

const SAFE_EXT = /^[a-z0-9]{1,8}$/i

const MAX_TEXT_BYTES = MAX_TEXT_FILE_BYTES

/**
 * Ask git which of the given project-relative paths are ignored.
 * Returns an empty set if the directory isn't a git repo or git is unavailable.
 * Uses `git check-ignore -z --stdin` so directory ignores and nested-path rules
 * are honored exactly the way git itself sees them.
 */
async function getIgnoredPaths(cwd: string, relPaths: string[]): Promise<Set<string>> {
  const ignored = new Set<string>()
  if (relPaths.length === 0) return ignored
  return new Promise((resolveP) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('git', ['check-ignore', '-z', '--stdin'], {
        cwd,
        env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      })
    } catch {
      resolveP(ignored)
      return
    }
    let stdout = ''
    child.stdout?.on('data', (d) => {
      stdout += d.toString()
    })
    child.on('error', () => resolveP(ignored))
    child.on('close', () => {
      for (const p of stdout.split('\0')) {
        if (p) ignored.add(p)
      }
      resolveP(ignored)
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(relPaths.join('\0'))
  })
}

function resolveSafe(root: string, rel: string): string | null {
  const normRoot = resolve(root)
  const abs = resolve(normRoot, rel || '.')
  if (abs !== normRoot && !abs.startsWith(normRoot + sep)) return null
  return abs
}

function toRel(root: string, abs: string): string {
  const r = relative(resolve(root), abs)
  return r.split(sep).join('/')
}

function isHiddenSystem(name: string): boolean {
  // Hide the .git internals only; keep visible: .gitignore, .env, .vscode etc.
  return name === '.git' || name === '.DS_Store'
}

export function registerFsIpc(): void {
  ipcMain.handle(
    IPC.fs.list,
    async (_e, projectId: ProjectId, relPath: string): Promise<FsEntry[]> => {
      const project = getProject(projectId)
      if (!project) return []
      const abs = resolveSafe(project.path, relPath ?? '')
      if (!abs) return []
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs.readdir(abs, { withFileTypes: true })
      } catch {
        return []
      }
      const visible = entries
        .filter((e) => !isHiddenSystem(e.name))
        .map<FsEntry>((e) => ({
          name: e.name,
          path: toRel(project.path, join(abs, e.name)),
          isDirectory: e.isDirectory(),
        }))
      const ignored = await getIgnoredPaths(
        project.path,
        visible.map((e) => e.path)
      )
      return visible
        .map((e) => (ignored.has(e.path) ? { ...e, ignored: true } : e))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
    }
  )

  ipcMain.handle(
    IPC.fs.readText,
    async (_e, projectId: ProjectId, relPath: string): Promise<string | null> => {
      const project = getProject(projectId)
      if (!project) return null
      const abs = resolveSafe(project.path, relPath)
      if (!abs) return null
      try {
        const stat = await fs.stat(abs)
        if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) return null
        return await fs.readFile(abs, 'utf-8')
      } catch {
        return null
      }
    }
  )

  ipcMain.handle(
    IPC.fs.writeText,
    async (
      _e,
      projectId: ProjectId,
      relPath: string,
      content: string
    ): Promise<boolean> => {
      const project = getProject(projectId)
      if (!project) return false
      const abs = resolveSafe(project.path, relPath)
      if (!abs || abs === resolve(project.path)) return false
      try {
        await fs.mkdir(dirname(abs), { recursive: true })
        // Atomic write: stage to .tmp then rename.
        const tmp = `${abs}.${process.pid}.tmp`
        await fs.writeFile(tmp, content, 'utf-8')
        await fs.rename(tmp, abs)
        return true
      } catch (err) {
        console.error('[fs] write failed:', err)
        return false
      }
    }
  )

  ipcMain.handle(
    IPC.fs.createFile,
    async (_e, projectId: ProjectId, relPath: string): Promise<boolean> => {
      const project = getProject(projectId)
      if (!project) return false
      const abs = resolveSafe(project.path, relPath)
      if (!abs) return false
      try {
        await fs.mkdir(dirname(abs), { recursive: true })
        const fh = await fs.open(abs, 'wx')
        await fh.close()
        return true
      } catch {
        return false
      }
    }
  )

  ipcMain.handle(
    IPC.fs.createFolder,
    async (_e, projectId: ProjectId, relPath: string): Promise<boolean> => {
      const project = getProject(projectId)
      if (!project) return false
      const abs = resolveSafe(project.path, relPath)
      if (!abs) return false
      try {
        await fs.mkdir(abs, { recursive: false })
        return true
      } catch {
        return false
      }
    }
  )

  ipcMain.handle(
    IPC.fs.rename,
    async (_e, projectId: ProjectId, fromRel: string, toRel: string): Promise<boolean> => {
      const project = getProject(projectId)
      if (!project) return false
      const from = resolveSafe(project.path, fromRel)
      const to = resolveSafe(project.path, toRel)
      if (!from || !to) return false
      try {
        await fs.rename(from, to)
        return true
      } catch {
        return false
      }
    }
  )

  ipcMain.handle(
    IPC.fs.remove,
    async (_e, projectId: ProjectId, relPath: string): Promise<boolean> => {
      const project = getProject(projectId)
      if (!project) return false
      const abs = resolveSafe(project.path, relPath)
      if (!abs || abs === resolve(project.path)) return false
      try {
        // Send to trash so it's recoverable.
        await shell.trashItem(abs)
        return true
      } catch {
        return false
      }
    }
  )

  ipcMain.handle(
    IPC.fs.duplicate,
    async (_e, projectId: ProjectId, relPath: string): Promise<string | null> => {
      const project = getProject(projectId)
      if (!project) return null
      const src = resolveSafe(project.path, relPath)
      if (!src || src === resolve(project.path)) return null
      try {
        const dir = dirname(src)
        const base = basename(src)
        const dot = base.lastIndexOf('.')
        const stem = dot > 0 ? base.slice(0, dot) : base
        const ext = dot > 0 ? base.slice(dot) : ''
        // Find a free "name copy", "name copy 2", … alongside the original.
        let dest = ''
        for (let i = 1; i < 1000; i++) {
          const suffix = i === 1 ? ' copy' : ` copy ${i}`
          const candidate = join(dir, `${stem}${suffix}${ext}`)
          try {
            await fs.access(candidate)
          } catch {
            dest = candidate
            break
          }
        }
        if (!dest) return null
        await fs.cp(src, dest, { recursive: true, errorOnExist: true, force: false })
        return toRel(project.path, dest)
      } catch {
        return null
      }
    }
  )

  ipcMain.handle(
    IPC.fs.open,
    async (_e, projectId: ProjectId, relPath: string): Promise<boolean> => {
      const project = getProject(projectId)
      if (!project) return false
      const abs = resolveSafe(project.path, relPath)
      if (!abs) return false
      const err = await shell.openPath(abs)
      return err === ''
    }
  )

  ipcMain.handle(
    IPC.fs.reveal,
    async (_e, projectId: ProjectId, relPath: string): Promise<void> => {
      const project = getProject(projectId)
      if (!project) return
      const abs = resolveSafe(project.path, relPath)
      if (!abs) return
      shell.showItemInFolder(abs)
    }
  )

  ipcMain.handle(IPC.fs.walk, async (_e, projectId: ProjectId): Promise<WalkResult> => {
    const project = getProject(projectId)
    if (!project) return { files: [], truncated: false }
    return walkProjectFiles(project.path)
  })

  ipcMain.handle(
    IPC.fs.saveTempPaste,
    async (_e, data: ArrayBuffer | Uint8Array, ext: string): Promise<string | null> => {
      const safeExt = SAFE_EXT.test(ext) ? ext.toLowerCase() : 'bin'
      const buf = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(data)
      if (buf.byteLength === 0 || buf.byteLength > MAX_PASTE_BYTES) return null
      const dir = join(tmpdir(), 'wterm-paste')
      try {
        await fs.mkdir(dir, { recursive: true })
        const name = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
        const abs = join(dir, name)
        await fs.writeFile(abs, buf)
        return abs
      } catch (err) {
        console.error('[fs] saveTempPaste failed:', err)
        return null
      }
    }
  )
}
