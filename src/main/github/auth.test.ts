import { beforeEach, describe, expect, it, vi } from 'vitest'

// auth.ts imports `electron` and `node:fs` at module scope. Mock both so the
// module is exercisable in a plain node test environment with no real disk I/O.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/wterm-auth-test-userdata' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
}))

vi.mock('node:fs', () => ({
  promises: {
    // Simulate a fresh install: no github.json on disk yet.
    readFile: vi.fn().mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    ),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}))

// The baked-in wTerm OAuth App client id (device flow enabled). Public by design.
const DEFAULT_CLIENT_ID = 'Ov23lif1NhaAkVWpRiVM'

describe('getClientId', () => {
  // auth.ts caches load state in module scope; reset it between cases.
  beforeEach(() => vi.resetModules())

  it('falls back to the baked-in default client id when none is configured', async () => {
    const { getClientId } = await import('./auth')

    const clientId = await getClientId()

    expect(clientId).toBe(DEFAULT_CLIENT_ID)
  })

  it('returns the user-set client id when one is configured', async () => {
    const { getClientId, setClientId } = await import('./auth')

    await setClientId('Iv1.usersuppliedid')
    const clientId = await getClientId()

    expect(clientId).toBe('Iv1.usersuppliedid')
  })
})
