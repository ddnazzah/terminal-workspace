// Strip the leading decoration from an agent window title before showing it in
// the sidebar (desktop) or the mobile tab bar: the animated spinner glyph
// (braille frames U+2800–U+28FF or the ✳ marker) and any bullet/middle-dot
// separator (·•‣⋅) that follows it, plus surrounding whitespace. The braille
// glyph cycles every frame, so left in it reads as a dot skittering next to the
// terminal name; the pulsing halo already signals work, so the text only needs
// the task.
export function stripSpinner(title: string): string {
  return title.replace(/^[✳⠀-⣿·•‣⋅\s]+/, '')
}

/**
 * Normalize a derived window title for display as a tab label: strip the
 * spinner decoration and collapse a blank result to null so the caller falls
 * back to the terminal's persisted name (e.g. "Terminal 1") instead of an empty
 * label.
 */
export function cleanTitle(title: string | null | undefined): string | null {
  if (!title) return null
  const stripped = stripSpinner(title).trim()
  return stripped.length > 0 ? stripped : null
}
