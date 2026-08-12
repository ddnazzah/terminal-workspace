import { execFile } from 'node:child_process'

/**
 * Candidate paths for the Tailscale CLI, in probe order.
 *
 * The bare name is first so a CLI already on PATH wins, but we cannot rely on
 * it: macOS launches GUI apps from Finder/Dock with a minimal
 * `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, which contains neither Homebrew prefix.
 * So we also probe the well-known absolute install locations — the GUI app
 * bundle, and both Homebrew prefixes (`/opt/homebrew` on Apple Silicon,
 * `/usr/local` on Intel, which is also where manual installs land).
 */
export function tailscaleCandidates(platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') {
    return [
      'tailscale',
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      '/opt/homebrew/bin/tailscale',
      '/usr/local/bin/tailscale',
    ]
  }
  if (platform === 'win32') {
    return ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe']
  }
  return ['tailscale']
}

function run(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 4000 }, (err, stdout) => {
      resolve(err ? null : stdout)
    })
  })
}

/**
 * Best-effort: derive the device's MagicDNS HTTPS origin (e.g.
 * `https://mac.tailnet-name.ts.net`). Returns null when Tailscale isn't
 * installed/running. The phone must reach the bridge over this HTTPS origin
 * (served via `tailscale serve`) so the PWA gets a secure context for service
 * workers + Web Push — a raw 100.x IP would not qualify.
 */
export async function getTailscaleOrigin(
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  for (const bin of tailscaleCandidates(platform)) {
    const out = await run(bin, ['status', '--json'])
    if (!out) continue
    try {
      const status = JSON.parse(out) as { Self?: { DNSName?: string } }
      const dns = status.Self?.DNSName
      if (dns) return `https://${dns.replace(/\.$/, '')}`
    } catch {
      // try the next candidate
    }
  }
  return null
}
