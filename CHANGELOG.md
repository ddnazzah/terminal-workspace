# Changelog

## Unreleased

### Added

- **Explorer**: drag-and-drop move with indent guides; multi-select (shift range,
  cmd toggle, shift+arrow); delete acting on the whole selection; cut/copy/paste
  with Finder-style collision naming.
- **Editor**: preview for images, SVG, video, audio and PDF; VS Code-style
  breadcrumbs above the editor.
- **Source control**: staged / unstaged / merge groups with per-row stage,
  unstage and discard; a commit box; and a Monaco diff on click.
- **Commands**: global shortcuts routed through a keybinding registry with
  when-contexts, plus a ⌘⇧P command palette.
- **Search**: project-wide search panel backed by `git grep`, with match-case,
  whole-word and regex toggles, results grouped by file.

### Changed

- Editor adopts VS Code's own defaults — sticky scroll, bracket-pair
  colorization, indent guides, `detectIndentation`. Note a file that clearly
  uses tabs now keeps them even when the configured default is spaces.
- Chrome uses VS Code codicons and design tokens taken from the upstream repo.
- The file modal sizes to the viewport (78% x 82%, width capped at 1800px)
  instead of a fixed 900x600, and re-fits on window resize.

### Fixed

- **Terminals losing all user config** (no aliases, default prompt, missing
  PATH) after roughly three days of app uptime. Launching wTerm from inside a
  wTerm tab leaked that tab's `ZDOTDIR` — one of our own tmp wrapper dirs — into
  the app environment, where it was treated as the user's real config dir. Each
  relaunch chained a level deeper, and once macOS purged the older dir the shell
  booted with nothing.
- `pnpm install` failing after the pnpm 11 upgrade: build approvals moved from
  the `pnpm` field in `package.json` to `pnpm-workspace.yaml`.

## 0.5.0

See the GitHub release.
