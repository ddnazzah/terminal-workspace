# wTerm 0.4.0

A feature release for wTerm — a multi-project, multi-terminal workspace IDE. This build adds **session activity detection with desktop notifications**, makes **GitHub sign-in work out of the box**, refreshes the **terminal colors**, and makes the **phone companion terminal genuinely usable on a touchscreen**.

## Downloads

- **macOS (Apple Silicon)** — `wTerm-0.4.0-arm64.dmg`
- **Windows (x64)** — `wTerm-0.4.0-x64-setup.exe`

If you're on 0.1.3 or later, the app updates itself — you'll get 0.4.0 automatically.

## What's changed in 0.4.0

- **Session activity + desktop notifications.** wTerm now watches your terminals for agent activity — it can tell when a long-running agent is working versus when it has finished or is waiting for your input, and fires a desktop notification so you don't have to babysit the window. Detection runs in the main process off the terminal stream (OSC-aware), with a tunable notify policy; a **Notifications** test row in Settings lets you fire a sample notification to confirm your OS permissions.
- **GitHub sign-in works out of the box.** "Sign in with GitHub" no longer requires manually pasting an OAuth App client id first — wTerm ships with its own client id baked in, so device-flow login works on a fresh install with zero setup. You can still supply your own client id to override it.
- **Vibrant terminal colors.** The Halcyon foreground and ANSI palette were muddy on the dark surface (the normal blue all but disappeared). Both the desktop terminal and the phone companion now use a tuned, high-contrast 16-color palette where blue is distinct from cyan and every bright color is genuinely brighter than its normal, so colored and bold output actually pops.
- **Phone companion, now touch-friendly.** On the mobile bridge you can finally **swipe to scroll** the terminal (including in `vim`/`less`/`htop`, where the swipe drives the app itself), the **iOS keyboard no longer covers what you're typing** (the layout tracks the visible viewport), page **rubber-band bounce is gone**, and the on-screen key bar gained a keyboard toggle plus arrow keys that respect application-cursor mode.

## macOS install instructions

The macOS build is signed with an Apple **Developer ID** certificate and **notarized by Apple**, so it opens normally — no Gatekeeper workarounds needed.

1. Open the DMG and drag **wTerm** to **Applications**.
2. Launch it from Applications or Spotlight.

That's it — the first launch goes straight through, and the app keeps itself up to date from here on.

## Windows first-launch instructions

The Windows installer is **unsigned**. SmartScreen will show "Windows protected your PC" on first launch:

1. Click **More info**.
2. Click **Run anyway**.

The installer (`wTerm-0.4.0-x64-setup.exe`) is a standard NSIS installer — pick an install location and it'll create Start Menu and desktop shortcuts.

## What's in this build

See the [README](./README.md) for the full feature list. Highlights:

- Session activity detection with desktop notifications
- Phone companion over Tailscale with Web Push — now touch-scroll and keyboard-aware
- Agent session restore for any agent (`claude`, `cursor-agent`, `aider`, …)
- Zero-setup GitHub sign-in (device flow) plus built-in GitHub integration
- Window zoom, redesigned settings, side-by-side docked editor
- Monaco code editor with docked / floating / full-screen view modes
- Git-aware file tree with keyboard navigation
- Drag-to-reorder projects
- Auto-update from GitHub Releases
- Multi-project, multi-terminal workspace with persistent layout
- Single hand-tuned Halcyon theme across app chrome, terminal, and editor

## Known limitations

- macOS: Apple Silicon only (no Intel build)
- Windows: x64 only (no ARM build)
- No Linux build
- The phone companion needs wTerm running on an awake Mac, plus Tailscale on both ends.
- Agent restore only reopens tabs that had a mapped agent **running** at quit; a tab idling at a prompt restores nothing. Two agent tabs in the same folder resume that folder's latest conversation.

## Verifying the download (optional)

```bash
# macOS / Linux
shasum -a 256 wTerm-0.4.0-arm64.dmg

# Windows (PowerShell)
Get-FileHash wTerm-0.4.0-x64-setup.exe -Algorithm SHA256
```

Compare against the SHA in the release asset list.
