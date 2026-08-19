import { useCallback, useEffect, useMemo, useState } from 'react'
import { MAX_TEXT_FILE_LABEL } from '@shared/types'
import { tabKey, useWorkspace, type OpenedFile } from '@renderer/state/store'
import { useSettings } from '@renderer/state/settings'
import { formattableParser, formatText } from '@renderer/lib/formatter'
import { MonacoEditor, gcMonacoModels } from './monaco-editor'
import { MarkdownPreview } from './markdown-preview'
import { MediaViewer } from './media-viewer'
import { mediaKindFor } from '@shared/media-type'
import { DiffViewer } from './diff-viewer'
import { decodeDiffTab, isDiffTab } from '@renderer/lib/diff-tab'

const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown'])

interface Props {
  projectId: string
}

export function FileViewer({ projectId }: Props) {
  const openFiles = useWorkspace((s) => s.openFiles)
  const fileStates = useWorkspace((s) => s.fileStates)
  const activeFileByProject = useWorkspace((s) => s.activeFileByProject)
  const setFileState = useWorkspace((s) => s.setFileState)
  const setFileContent = useWorkspace((s) => s.setFileContent)
  const markFileSaved = useWorkspace((s) => s.markFileSaved)

  const projectTabs = useMemo(
    () => openFiles.filter((f) => f.projectId === projectId),
    [openFiles, projectId]
  )
  const activePath = activeFileByProject[projectId] ?? null
  const activeFile: OpenedFile | null =
    (activePath && projectTabs.find((f) => f.path === activePath)) || null

  // Load content for any tab still in 'loading' state.
  useEffect(() => {
    for (const file of projectTabs) {
      const state = fileStates[tabKey(file)]
      if (state?.kind !== 'loading') continue
      // Diff tabs fetch both sides themselves; there is no single file to load.
      if (isDiffTab(file.path)) {
        setFileState(file, { kind: 'binary' })
        continue
      }

      // SVG is text as well as an image, so it takes the normal text path and
      // gets a preview/source toggle. Every other media kind is loaded by the
      // media viewer itself, straight from bytes.
      const media = mediaKindFor(file.path)
      if (media !== null && media !== 'svg') {
        setFileState(file, { kind: 'binary' })
        continue
      }
      void window.api.fs
        .readText(file.projectId, file.path)
        .then((text) => {
          if (text === null) setFileState(file, { kind: 'binary' })
          else setFileState(file, { kind: 'text', current: text, saved: text })
        })
        .catch((err: unknown) => {
          setFileState(file, {
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          })
        })
    }
  }, [projectTabs, fileStates, setFileState])

  const save = useCallback(
    async (file: OpenedFile, text: string) => {
      const ok = await window.api.fs.writeText(file.projectId, file.path, text)
      if (ok) markFileSaved(file, text)
    },
    [markFileSaved]
  )

  // Keep main's watcher in step with what this project has open.
  const applyExternalChange = useWorkspace((s) => s.applyExternalChange)
  useEffect(() => {
    const paths = projectTabs.filter((f) => !isDiffTab(f.path)).map((f) => f.path)
    void window.api.fs.watchOpen(projectId, paths)
  }, [projectId, projectTabs])

  useEffect(() => {
    return window.api.fs.onExternalChange(({ projectId: pid, path, content }) => {
      applyExternalChange({ projectId: pid, path }, content)
    })
  }, [applyExternalChange])

  // Dispose Monaco models for files that are no longer open (any project).
  useEffect(() => {
    const live = new Set(openFiles.map(tabKey))
    gcMonacoModels(live)
  }, [openFiles])

  if (projectTabs.length === 0) return null

  return (
    <div className="flex flex-col h-full w-full bg-background min-w-0">
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeFile ? (
          <EditorPane file={activeFile} onSave={save} onChange={setFileContent} />
        ) : (
          <div className="text-[12px] text-foreground/40 p-4">No file selected.</div>
        )}
      </div>
    </div>
  )
}

function EditorPane({
  file,
  onSave,
  onChange,
}: {
  file: OpenedFile
  onSave: (file: OpenedFile, text: string) => Promise<void>
  onChange: (file: OpenedFile, content: string) => void
}) {
  const state = useWorkspace((s) => s.fileStates[tabKey(file)])
  const editorSettings = useSettings((s) => s.editor)

  const diff = decodeDiffTab(file.path)
  if (diff) {
    return (
      <DiffViewer
        projectId={file.projectId}
        repoRel={diff.repoRel}
        row={{ path: diff.path, status: diff.status, isUntracked: diff.isUntracked }}
        group={diff.group}
      />
    )
  }

  // Media renders straight from bytes — it never waits on the text state.
  const media = mediaKindFor(file.path)
  if (media !== null && media !== 'svg') {
    return <MediaViewer projectId={file.projectId} path={file.path} kind={media} />
  }

  if (!state || state.kind === 'loading') {
    return <div className="text-[12px] text-foreground/45 p-4">Loading…</div>
  }
  if (state.kind === 'binary') {
    return (
      <Placeholder
        title="Binary or large file"
        hint={`This file is over ${MAX_TEXT_FILE_LABEL} or not text. Use “Open externally” from the tree to view it.`}
      />
    )
  }
  if (state.kind === 'error') {
    return <Placeholder title="Couldn’t open file" hint={state.message} />
  }

  const name = file.path.split('/').pop() ?? file.path

  if (media === 'svg') {
    return (
      <SvgPane
        name={name}
        content={state.current}
        fileKey={tabKey(file)}
        onSave={(t) => void onSave(file, t)}
        onChange={(t) => onChange(file, t)}
      />
    )
  }

  const isMarkdown = MARKDOWN_EXTS.has(extOf(file.path))
  if (isMarkdown) {
    return <MarkdownPane name={name} content={state.current} onSave={(t) => void onSave(file, t)} onChange={(t) => onChange(file, t)} fileKey={tabKey(file)} />
  }
  const formattable = formattableParser(name) !== null

  const format = formattable
    ? async (text: string) => {
        try {
          return await formatText(text, name, {
            tabWidth: editorSettings.tabSize,
            useTabs: !editorSettings.insertSpaces,
          })
        } catch (err) {
          console.warn('[format] failed:', err)
          return null
        }
      }
    : undefined

  if (state.conflictWith !== undefined && state.conflictWith !== null) {
    return (
      <div className="flex h-full flex-col">
        <ConflictBanner
          onKeepMine={() => onChange(file, state.current)}
          onUseDisk={() => {
            // Adopt the on-disk text as both current and saved, clearing the
            // conflict without writing anything back.
            onChange(file, state.conflictWith as string)
            void onSave(file, state.conflictWith as string)
          }}
        />
        <div className="min-h-0 flex-1">
          <MonacoEditor
            fileKey={tabKey(file)}
            filename={name}
            initialContent={state.current}
            onChange={(text) => onChange(file, text)}
            onSave={(text) => void onSave(file, text)}
            format={format}
          />
        </div>
      </div>
    )
  }

  if (state.conflictWith === null) {
    return (
      <div className="flex h-full flex-col">
        <DeletedBanner />
        <div className="min-h-0 flex-1">
          <MonacoEditor
            fileKey={tabKey(file)}
            filename={name}
            initialContent={state.current}
            onChange={(text) => onChange(file, text)}
            onSave={(text) => void onSave(file, text)}
            format={format}
          />
        </div>
      </div>
    )
  }

  return (
    <MonacoEditor
      fileKey={tabKey(file)}
      filename={name}
      initialContent={state.current}
      onChange={(text) => onChange(file, text)}
      onSave={(text) => void onSave(file, text)}
      format={format}
    />
  )
}

/**
 * SVG gets both views. The preview is built from the in-editor text rather than
 * re-read from disk, so unsaved edits render live.
 */
function SvgPane({
  name,
  content,
  fileKey,
  onSave,
  onChange,
}: {
  name: string
  content: string
  fileKey: string
  onSave: (text: string) => void
  onChange: (text: string) => void
}) {
  const [mode, setMode] = useState<'preview' | 'code'>('preview')

  const previewUrl = useMemo(
    () => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(content)))}`,
    [content]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-foreground/7 px-2 py-1">
        <ModeButton active={mode === 'preview'} onClick={() => setMode('preview')}>
          Preview
        </ModeButton>
        <ModeButton active={mode === 'code'} onClick={() => setMode('code')}>
          Code
        </ModeButton>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'preview' ? (
          <div className="flex h-full items-center justify-center overflow-auto p-6">
            <img src={previewUrl} alt={name} className="max-h-full max-w-full" />
          </div>
        ) : (
          <MonacoEditor
            fileKey={fileKey}
            filename={name}
            initialContent={content}
            onChange={onChange}
            onSave={onSave}
          />
        )}
      </div>
    </div>
  )
}

function MarkdownPane({
  name,
  content,
  fileKey,
  onSave,
  onChange,
}: {
  name: string
  content: string
  fileKey: string
  onSave: (text: string) => void
  onChange: (text: string) => void
}) {
  const [mode, setMode] = useState<'preview' | 'code'>('preview')
  const editorSettings = useSettings((s) => s.editor)

  const format = useCallback(
    async (text: string) => {
      try {
        return await formatText(text, name, {
          tabWidth: editorSettings.tabSize,
          useTabs: !editorSettings.insertSpaces,
        })
      } catch (err) {
        console.warn('[format] failed:', err)
        return null
      }
    },
    [name, editorSettings.tabSize, editorSettings.insertSpaces]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-foreground/7 px-2 py-1">
        <ModeButton active={mode === 'preview'} onClick={() => setMode('preview')}>
          Preview
        </ModeButton>
        <ModeButton active={mode === 'code'} onClick={() => setMode('code')}>
          Code
        </ModeButton>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'preview' ? (
          <MarkdownPreview content={content} />
        ) : (
          <MonacoEditor
            fileKey={fileKey}
            filename={name}
            initialContent={content}
            onChange={onChange}
            onSave={onSave}
            format={format}
          />
        )}
      </div>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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

function Placeholder({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="text-[13px] text-foreground/70">{title}</div>
      {hint && <div className="text-[11px] text-foreground/45 max-w-md">{hint}</div>}
    </div>
  )
}

function extOf(p: string): string {
  const name = p.split('/').pop() ?? p
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

function ConflictBanner({
  onKeepMine,
  onUseDisk,
}: {
  onKeepMine: () => void
  onUseDisk: () => void
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-[12px]"
      style={{
        background: 'var(--vscode-input-background)',
        borderBottom: '1px solid var(--vscode-gitDecoration-conflictingResourceForeground)',
        color: 'var(--vscode-sideBar-foreground)',
      }}
    >
      <span>This file changed on disk while you had unsaved edits.</span>
      <button
        type="button"
        onClick={onUseDisk}
        className="ml-auto shrink-0 rounded px-2 py-0.5 text-[11px]"
        style={{
          background: 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
        }}
      >
        Use version on disk
      </button>
      <button
        type="button"
        onClick={onKeepMine}
        className="shrink-0 rounded px-2 py-0.5 text-[11px]"
        style={{ background: 'var(--vscode-list-hoverBackground)' }}
      >
        Keep mine
      </button>
    </div>
  )
}

function DeletedBanner() {
  return (
    <div
      className="shrink-0 px-3 py-1.5 text-[12px]"
      style={{
        background: 'var(--vscode-input-background)',
        borderBottom: '1px solid var(--vscode-gitDecoration-deletedResourceForeground)',
        color: 'var(--vscode-sideBar-foreground)',
      }}
    >
      This file was deleted on disk. Saving will recreate it.
    </div>
  )
}
