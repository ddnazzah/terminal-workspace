# Changelog

## 0.7.2

### Added

- **Changes | File tabs**: opening a file with uncommitted work gives its tab a
  strip of two panes — Changes (the diff) first and selected by default, then
  File (the editable source). An unchanged file renders exactly as before. The
  diff is HEAD against the working tree, so the answer to "what changed since
  the last commit?" does not depend on what is staged; Source Control keeps its
  narrower per-group diffs.

### Fixed

- **Side-by-side mode**: the docked editor's left slot was a plain block, so the
  terminal collapsed to a 16px sliver and the split looked empty. The terminal
  now fills its half.
- **Floating editor size**: 92% x 92% of the viewport instead of 78% x 82%, and
  a size saved from a smaller window is now grown instead of sticking.
- **Confirm dialog** is centred rather than pinned near the top.
- **Editor position** survives toggling between a file's Changes and File panes.

## 0.7.1

### Fixed

- **Agent titles**: the spinner stripper knew braille frames and `✳` but not the
  circle frames (`◐◑◒◓`) current Claude Code animates with, so a working agent
  rendered as "◐ OK" in the sidebar with the glyph flickering beside the name.
  The detector and the stripper now share one alphabet and cannot drift apart.

### Changed

- **Session indicator**: `working` is a hollow ring instead of a filled dot.
  Shape now carries the meaning — hollow means work is in flight, filled means
  something wants you — so it no longer rests on telling accent yellow from
  orange in an 8px circle.

## 0.7.0

### Added

- **Project board**: cards with auto-dispatch to Claude workers, plus notes.
  Board and note tabs ride the normal tab machinery under a `wterm://` scheme,
  so ordering, ⌘1–9, drag-reorder and close all work unchanged.
- **Agent signals**: a local hook server Claude Code posts lifecycle events to,
  installable from Settings → Agent Signals, so session activity comes from the
  agent itself rather than terminal-output heuristics. One shared indicator
  function keeps the sidebar, project row and bottom dock in agreement.
- **Close confirmation**: ⌘W asks before ending a shell and whatever runs in it.

- **Explorer**: drag-and-drop move with indent guides; multi-select (shift range,
  cmd toggle, shift+arrow); delete acting on the whole selection; cut/copy/paste
  with Finder-style collision naming.
- **Editor**: preview for images, SVG, video, audio and PDF; VS Code-style
  breadcrumbs above the editor.
- **Source control**: staged / unstaged / merge groups with per-row stage,
  unstage and discard; a commit box; and a Monaco diff on click.
- **Commands**: global shortcuts routed through a keybinding registry with
  when-contexts, plus a ⌘⇧P command palette. Quick open understands VS Code's
  prefixes — `>` for commands, `:42` (or `:42:8`) to jump to a line. Shortcuts
  are rebindable from Settings → Keyboard Shortcuts.
- **Search**: project-wide search panel backed by `git grep`, with match-case,
  whole-word and regex toggles, results grouped by file, replace-in-files, and clicking a result opens the
  file scrolled to the matching line.

- **Editor**: open files are watched for external changes. A clean tab reloads
  silently; a tab with unsaved edits shows a conflict banner offering the disk
  version or your own. Useful when an agent edits a file you have open.

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
