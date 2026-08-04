/**
 * A glyph from VS Code's icon font (`@vscode/codicons`).
 *
 * Names are the codicon ids without the `codicon-` prefix, e.g. `add`,
 * `discard`, `chevron-right`. The full set is browsable in
 * `node_modules/@vscode/codicons/dist/codicon.html`.
 */

/** Codicon ids used in the app. Keeping this a union catches typos at build time. */
export type CodiconName =
  | 'add'
  | 'remove'
  | 'discard'
  | 'go-to-file'
  | 'check'
  | 'chevron-right'
  | 'chevron-down'
  | 'refresh'
  | 'git-commit'
  | 'new-file'
  | 'new-folder'
  | 'collapse-all'
  | 'ellipsis'
  | 'close'
  | 'cloud-upload'
  | 'warning'

interface Props {
  name: CodiconName
  /** Font size in px. VS Code draws toolbar and tree icons at 16. */
  size?: number
  className?: string
}

export function Codicon({ name, size = 16, className = '' }: Props) {
  return (
    <span
      aria-hidden
      className={`codicon codicon-${name} ${className}`}
      style={{ fontSize: size, lineHeight: `${size}px`, width: size, height: size }}
    />
  )
}
