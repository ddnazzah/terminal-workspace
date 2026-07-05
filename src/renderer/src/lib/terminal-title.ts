// Strip the leading decoration from an agent window title before showing it in
// the sidebar: the animated spinner glyph (braille frames U+2800–U+28FF or the
// ✳ marker) and any bullet/middle-dot separator (·•‣⋅) that follows it, plus
// surrounding whitespace. The braille glyph cycles every frame, so left in it
// reads as a dot skittering next to the terminal name; the pulsing halo already
// signals work, so the text only needs the task.
export function stripSpinner(title: string): string {
  return title.replace(/^[✳⠀-⣿·•‣⋅\s]+/, '')
}
