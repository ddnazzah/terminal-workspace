import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export interface StoredAuth {
  token: string
  login: string | null
  source: 'pat' | 'device'
  avatarUrl?: string | null
}

interface DiskBlob {
  version: 1
  /** OAuth App client id used for device flow (plaintext — not a secret) */
  clientId: string | null
  /** base64 of safeStorage-encrypted JSON { token, login, source, avatarUrl } */
  authEnc: string | null
}

const FILE_VERSION: 1 = 1

/**
 * Client id of the wTerm GitHub OAuth App (Device Flow enabled). This is NOT a
 * secret — OAuth/GitHub App client ids are public by design — so it ships baked
 * in, letting "Sign in with GitHub" work out of the box with no PAT and no
 * per-user setup. A user-supplied client id (via setClientId) always overrides
 * this default.
 */
const DEFAULT_CLIENT_ID = 'Ov23lif1NhaAkVWpRiVM'

let cache: DiskBlob = { version: FILE_VERSION, clientId: null, authEnc: null }
let loaded = false

function filePath(): string {
  return join(app.getPath('userData'), 'github.json')
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const raw = await fs.readFile(filePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<DiskBlob>
    if (parsed?.version === FILE_VERSION) {
      cache = {
        version: FILE_VERSION,
        clientId: parsed.clientId ?? null,
        authEnc: parsed.authEnc ?? null,
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[github] failed to load auth file:', err)
    }
  }
}

async function persist(): Promise<void> {
  const target = filePath()
  const tmp = `${target}.tmp`
  await fs.mkdir(dirname(target), { recursive: true }).catch(() => {})
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf-8')
  await fs.rename(tmp, target)
}

export async function getClientId(): Promise<string | null> {
  await ensureLoaded()
  // Fall back to the baked-in app client id so device-flow login works without
  // any per-user configuration; an explicit user-set client id takes priority.
  return cache.clientId ?? DEFAULT_CLIENT_ID
}

export async function setClientId(clientId: string | null): Promise<void> {
  await ensureLoaded()
  cache.clientId = clientId && clientId.trim() ? clientId.trim() : null
  await persist()
}

export async function getAuth(): Promise<StoredAuth | null> {
  await ensureLoaded()
  if (!cache.authEnc) return null
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: we stored as JSON base64 (only happens if encryption was unavailable at write time)
    try {
      const json = Buffer.from(cache.authEnc, 'base64').toString('utf-8')
      return JSON.parse(json) as StoredAuth
    } catch {
      return null
    }
  }
  try {
    const buf = Buffer.from(cache.authEnc, 'base64')
    const decrypted = safeStorage.decryptString(buf)
    return JSON.parse(decrypted) as StoredAuth
  } catch (err) {
    console.error('[github] decrypt failed:', err)
    return null
  }
}

export async function setAuth(auth: StoredAuth | null): Promise<void> {
  await ensureLoaded()
  if (!auth) {
    cache.authEnc = null
  } else {
    const json = JSON.stringify(auth)
    if (safeStorage.isEncryptionAvailable()) {
      cache.authEnc = safeStorage.encryptString(json).toString('base64')
    } else {
      // Last-ditch fallback so the app still works on weird platforms.
      cache.authEnc = Buffer.from(json, 'utf-8').toString('base64')
    }
  }
  await persist()
}

// ----- Device flow -----

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const DEFAULT_SCOPE = 'repo workflow read:user'

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

export async function deviceCodeRequest(clientId: string): Promise<DeviceCodeResponse> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: DEFAULT_SCOPE }),
  })
  if (!res.ok) {
    throw new Error(`device-code request failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as DeviceCodeResponse
}

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'slow-down'; interval: number }
  | { status: 'authorized'; token: string }
  | { status: 'error'; error: string; description?: string }

export async function devicePollOnce(
  clientId: string,
  deviceCode: string
): Promise<DevicePollResult> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  if (!res.ok) {
    return { status: 'error', error: `http_${res.status}` }
  }
  const body = (await res.json()) as {
    access_token?: string
    error?: string
    error_description?: string
    interval?: number
  }
  if (body.access_token) return { status: 'authorized', token: body.access_token }
  switch (body.error) {
    case 'authorization_pending':
      return { status: 'pending' }
    case 'slow_down':
      return { status: 'slow-down', interval: body.interval ?? 5 }
    default:
      return {
        status: 'error',
        error: body.error ?? 'unknown_error',
        description: body.error_description,
      }
  }
}

export interface AuthenticatedUser {
  login: string
  avatarUrl: string | null
}

export async function fetchAuthenticatedUser(token: string): Promise<AuthenticatedUser | null> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { login?: string; avatar_url?: string | null }
    if (!body.login) return null
    return { login: body.login, avatarUrl: body.avatar_url ?? null }
  } catch (err) {
    console.error('[github] GET /user failed:', err)
    return null
  }
}
