import { beforeEach, describe, expect, it, vi } from 'vitest'

// tailscale.ts shells out to the Tailscale CLI. Mock execFile so we can simulate
// the environment a macOS GUI app actually runs in: Finder/Dock launch it with
// PATH=/usr/bin:/bin:/usr/sbin:/sbin, so a bare `tailscale` never resolves and
// only an absolute path to the installed binary works.
const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}))

import { getTailscaleOrigin } from './tailscale'

const STATUS_JSON = JSON.stringify({ Self: { DNSName: 'my-mac.tail06f682.ts.net.' } })
const EXPECTED_ORIGIN = 'https://my-mac.tail06f682.ts.net'

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void

/** Simulate a machine where the Tailscale CLI exists only at `availableBins`. */
function cliInstalledAt(...availableBins: string[]): void {
  execFileMock.mockImplementation(
    (bin: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      if (availableBins.includes(bin)) return cb(null, STATUS_JSON, '')
      cb(Object.assign(new Error(`spawn ${bin} ENOENT`), { code: 'ENOENT' }), '', '')
    }
  )
}

describe('getTailscaleOrigin', () => {
  // Block body on purpose: an arrow returning the mock would be treated by
  // vitest as a teardown callback and invoked with no arguments.
  beforeEach(() => {
    execFileMock.mockReset()
  })

  it('finds the CLI installed by Homebrew on Apple Silicon when it is not on PATH', async () => {
    // Arrange — the common macOS setup: `brew install tailscale`, no GUI app,
    // and /opt/homebrew/bin absent from the GUI app's minimal PATH.
    cliInstalledAt('/opt/homebrew/bin/tailscale')

    // Act
    const origin = await getTailscaleOrigin('darwin')

    // Assert
    expect(origin).toBe(EXPECTED_ORIGIN)
  })

  it('finds the CLI installed by Homebrew on Intel when it is not on PATH', async () => {
    cliInstalledAt('/usr/local/bin/tailscale')

    const origin = await getTailscaleOrigin('darwin')

    expect(origin).toBe(EXPECTED_ORIGIN)
  })

  it('finds the CLI shipped inside the Tailscale GUI app bundle', async () => {
    cliInstalledAt('/Applications/Tailscale.app/Contents/MacOS/Tailscale')

    const origin = await getTailscaleOrigin('darwin')

    expect(origin).toBe(EXPECTED_ORIGIN)
  })

  it('uses the bare PATH lookup when the CLI is already on PATH', async () => {
    cliInstalledAt('tailscale')

    const origin = await getTailscaleOrigin('linux')

    expect(origin).toBe(EXPECTED_ORIGIN)
  })

  it('strips the trailing dot from the MagicDNS name', async () => {
    cliInstalledAt('tailscale')

    const origin = await getTailscaleOrigin('linux')

    expect(origin).not.toContain('.ts.net.')
  })

  it('returns null when Tailscale is not installed anywhere', async () => {
    cliInstalledAt()

    const origin = await getTailscaleOrigin('darwin')

    expect(origin).toBeNull()
  })

  it('returns null when the CLI responds but reports no MagicDNS name', async () => {
    // Tailscale is installed but logged out — Self.DNSName is absent.
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, JSON.stringify({ Self: {} }), '')
      }
    )

    const origin = await getTailscaleOrigin('darwin')

    expect(origin).toBeNull()
  })
})
