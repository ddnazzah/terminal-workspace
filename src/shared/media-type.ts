/**
 * File-type detection for the previewable formats, mirroring what VS Code
 * renders natively rather than handing off to an external app.
 *
 * SVG is deliberately its own kind: it is an image, but it is also text, and
 * the viewer offers a source toggle for it.
 */

export type MediaKind = 'image' | 'svg' | 'video' | 'audio' | 'pdf'

const IMAGE_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

const VIDEO_MIMES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
}

const AUDIO_MIMES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
}

const SVG_MIME = 'image/svg+xml'
const PDF_MIME = 'application/pdf'

/**
 * Lowercased extension of a path's final segment, or '' when there is none.
 *
 * Splits on '/' first so a directory containing a dot (`some.png/notes.txt`)
 * cannot be mistaken for an extension on the file.
 */
function extensionOf(pathOrName: string): string {
  const base = pathOrName.split('/').pop() ?? pathOrName
  const dot = base.lastIndexOf('.')

  // `dot <= 0` also covers dotfiles like '.gitignore', which have no extension.
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** Which preview a file should get, or null when it should open as text. */
export function mediaKindFor(pathOrName: string): MediaKind | null {
  const ext = extensionOf(pathOrName)
  if (ext === '') return null

  if (ext === 'svg') return 'svg'
  if (ext === 'pdf') return 'pdf'
  if (ext in IMAGE_MIMES) return 'image'
  if (ext in VIDEO_MIMES) return 'video'
  if (ext in AUDIO_MIMES) return 'audio'

  return null
}

/** MIME type for a path, falling back to a generic binary type. */
export function mimeTypeFor(pathOrName: string): string {
  const ext = extensionOf(pathOrName)

  if (ext === 'svg') return SVG_MIME
  if (ext === 'pdf') return PDF_MIME

  return (
    IMAGE_MIMES[ext] ?? VIDEO_MIMES[ext] ?? AUDIO_MIMES[ext] ?? 'application/octet-stream'
  )
}
