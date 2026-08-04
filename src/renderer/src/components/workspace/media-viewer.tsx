import { useEffect, useState } from 'react'
import { MAX_MEDIA_FILE_LABEL, type MediaPayload } from '@shared/types'
import type { MediaKind } from '@shared/media-type'
import { Codicon } from '../codicon'

/** Zoom stops, mirroring VS Code's image preview. */
const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 20] as const

interface Props {
  projectId: string
  path: string
  kind: MediaKind
}

/**
 * Preview for the file types that are not text: images, SVG, video, audio and
 * PDF. Bytes arrive as a `data:` URL over IPC, so nothing here touches the
 * filesystem or needs a custom protocol.
 */
export function MediaViewer({ projectId, path, kind }: Props) {
  const [payload, setPayload] = useState<MediaPayload | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPayload(null)
    setFailed(false)

    void window.api.fs
      .readMedia(projectId, path)
      .then((result) => {
        if (cancelled) return
        if (result) setPayload(result)
        else setFailed(true)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [projectId, path])

  if (failed) {
    return (
      <Centered>
        <div className="text-[13px] text-foreground/70">Couldn’t preview this file</div>
        <div className="max-w-md text-[11px] text-foreground/45">
          It may be larger than {MAX_MEDIA_FILE_LABEL}, or no longer on disk. Use “Open
          externally” from the tree to view it.
        </div>
      </Centered>
    )
  }

  if (!payload) {
    return <div className="p-4 text-[12px] text-foreground/45">Loading…</div>
  }

  if (kind === 'image' || kind === 'svg') {
    return <ImagePane payload={payload} name={path} />
  }

  if (kind === 'video') {
    return (
      <Centered>
        <video
          src={payload.dataUrl}
          controls
          className="max-h-full max-w-full rounded-md"
        />
        <SizeLabel bytes={payload.byteLength} />
      </Centered>
    )
  }

  if (kind === 'audio') {
    return (
      <Centered>
        <div className="truncate text-[13px] text-foreground/80">{basenameOf(path)}</div>
        <audio src={payload.dataUrl} controls className="w-[min(28rem,80%)]" />
        <SizeLabel bytes={payload.byteLength} />
      </Centered>
    )
  }

  // PDF — Chromium renders this natively inside Electron.
  return (
    <embed
      src={payload.dataUrl}
      type="application/pdf"
      className="h-full w-full"
      title={basenameOf(path)}
    />
  )
}

function ImagePane({ payload, name }: { payload: MediaPayload; name: string }) {
  // null = fit to the pane; a number = explicit zoom factor.
  const [zoom, setZoom] = useState<number | null>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)

  const stepZoom = (direction: 1 | -1): void => {
    const current = zoom ?? 1
    const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001)
    const nextIndex = Math.min(
      ZOOM_STEPS.length - 1,
      Math.max(0, (index === -1 ? ZOOM_STEPS.length - 1 : index) + direction)
    )
    setZoom(ZOOM_STEPS[nextIndex])
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-foreground/7 px-2 py-1">
        <ToolbarButton onClick={() => stepZoom(-1)} label="Zoom out">
          <Codicon name="remove" size={16} />
        </ToolbarButton>
        <ToolbarButton onClick={() => stepZoom(1)} label="Zoom in">
          <Codicon name="add" size={16} />
        </ToolbarButton>
        <ToolbarButton onClick={() => setZoom(null)} active={zoom === null} label="Fit to window">
          Fit
        </ToolbarButton>
        <ToolbarButton onClick={() => setZoom(1)} active={zoom === 1} label="Actual size">
          100%
        </ToolbarButton>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex min-h-full items-center justify-center">
          <img
            src={payload.dataUrl}
            alt={basenameOf(name)}
            onLoad={(e) =>
              setNatural({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
            // Checkerboard so transparent images read correctly, as in VS Code.
            style={{
              backgroundImage:
                'linear-gradient(45deg,#80808020 25%,transparent 25%,transparent 75%,#80808020 75%),linear-gradient(45deg,#80808020 25%,transparent 25%,transparent 75%,#80808020 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 8px 8px',
              ...(zoom === null
                ? { maxWidth: '100%', maxHeight: '100%' }
                : natural
                  ? { width: natural.width * zoom, height: natural.height * zoom, maxWidth: 'none' }
                  : {}),
            }}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-foreground/7 px-3 py-1 text-[11px] text-foreground/45">
        {natural && (
          <span>
            {natural.width} × {natural.height}
          </span>
        )}
        <span>{formatBytes(payload.byteLength)}</span>
        <span className="ml-auto">{zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
      </div>
    </div>
  )
}

function ToolbarButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void
  active?: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        'rounded-md px-2.5 py-1 text-[11px] transition-colors',
        active
          ? 'bg-foreground/10 text-foreground'
          : 'text-foreground/55 hover:bg-foreground/5 hover:text-foreground/80',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
    </div>
  )
}

function SizeLabel({ bytes }: { bytes: number }) {
  return <div className="text-[11px] text-foreground/45">{formatBytes(bytes)}</div>
}

function basenameOf(path: string): string {
  return path.split('/').pop() ?? path
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
