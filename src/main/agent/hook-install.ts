import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { hooksInstalled, installHooks, uninstallHooks } from './hook-settings'

// Reading and writing the user's Claude Code settings file.
//
// This is the one place wTerm touches a file outside its own data directory, so
// it takes the care that deserves: a one-time backup before the first edit, a
// full parse-and-rewrite (never a text patch), and an uninstall that puts the
// file back the way it was found.

/** Kept next to the original so it is obvious what it is and where it came from. */
const BACKUP_SUFFIX = '.wterm-backup'

export interface HookInstallStatus {
  installed: boolean
  settingsPath: string
  /** Set when the settings file exists but could not be read or parsed. */
  error: string | null
}

export function settingsPath(): string {
  return join(homedir(), '.claude', 'settings.json')
}

/**
 * Read and parse the settings file. A missing file is an empty object — that is
 * a valid starting point. Malformed JSON throws, because silently replacing a
 * file wTerm could not understand would destroy the user's configuration.
 */
async function readSettings(path: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  if (text.trim().length === 0) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${path} is not valid JSON — fix or move it, then try again`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} does not contain a JSON object`)
  }
  return parsed as Record<string, unknown>
}

/** Copy the file aside once, so the pre-wTerm version is always recoverable. */
async function backupOnce(path: string): Promise<void> {
  const backup = `${path}${BACKUP_SUFFIX}`
  try {
    await fs.access(backup)
    return // already have one; never overwrite it with an edited version
  } catch {
    // no backup yet
  }
  try {
    await fs.copyFile(path, backup)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    // Nothing to back up — wTerm is creating the file.
  }
}

async function writeSettings(path: string, settings: Record<string, unknown>): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

/** Whether wTerm's relay is currently wired into the user's settings. */
export async function hookStatus(relayPath: string): Promise<HookInstallStatus> {
  const path = settingsPath()
  try {
    const settings = await readSettings(path)
    return { installed: hooksInstalled(settings, relayPath), settingsPath: path, error: null }
  } catch (err) {
    return { installed: false, settingsPath: path, error: (err as Error).message }
  }
}

/** Wire the relay into every event wTerm listens for. Idempotent. */
export async function installAgentHooks(relayPath: string): Promise<void> {
  const path = settingsPath()
  const settings = await readSettings(path)
  if (hooksInstalled(settings, relayPath)) return
  await backupOnce(path)
  await writeSettings(path, installHooks(settings, relayPath))
}

/** Remove every wTerm-written entry, leaving the user's own hooks in place. */
export async function removeAgentHooks(): Promise<void> {
  const path = settingsPath()
  const settings = await readSettings(path)
  await writeSettings(path, uninstallHooks(settings))
}
