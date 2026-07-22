# wTerm 0.5.0

A feature release for wTerm — a multi-project, multi-terminal workspace IDE. This build adds a **VS Code-style ⌘P quick-open** for jumping to any file in your project by name.

## Downloads

- **macOS (Apple Silicon)** — `wTerm-0.5.0-arm64.dmg`
- **Windows (x64)** — `wTerm-0.5.0-x64-setup.exe`

If you're on 0.1.3 or later, the app updates itself — you'll get 0.5.0 automatically.

## What's changed in 0.5.0

- **Filename quick-open (⌘P).** Press **⌘P** (Ctrl+P on Windows) to open a fast, fuzzy file finder over every file in the current project. Type part of a name and results rank by how well they match, with the matched characters highlighted and the containing folder shown alongside. Navigate with **↑/↓** (the selection scrolls into view and wraps), press **Enter** to open the file in the editor, and **Esc** or a click outside to dismiss. The file list is git-ignore aware — it lists tracked and untracked-but-not-ignored files via git for repositories, and falls back to a directory walk for plain folders, so `node_modules`, `.git`, and other ignored paths never clutter the results.

## macOS install instructions

The macOS build is signed with an Apple **Developer ID** certificate and **notarized by Apple**, so it opens normally — no Gatekeeper workarounds needed.

1. Open the DMG and drag **wTerm** to **Applications**.
2. Launch it from Applications or Spotlight.

That's it — the first launch goes straight through, and the app keeps itself up to date from here on.

## Windows first-launch instructions

The Windows installer is **unsigned**. SmartScreen will show "Windows protected your PC" on first launch:

1. Click **More info**.
2. Click **Run anyway**.

The installer (`wTerm-0.5.0-x64-setup.exe`) is a standard NSIS installer — pick an install location and it'll create Start Menu and desktop shortcuts.

## What's in this build

See the [README](./README.md) for the full feature list. Highlights:

- **Filename quick-open (⌘P)** — fuzzy file finder scoped to the current project
- Session activity detection with desktop notifications
- Phone companion over Tailscale with Web Push — touch-scroll and keyboard-aware
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
shasum -a 256 wTerm-0.5.0-arm64.dmg

# Windows (PowerShell)
Get-FileHash wTerm-0.5.0-x64-setup.exe -Algorithm SHA256
```

Compare against the SHA in the release asset list.
