import { useCallback, useEffect, useMemo, useState } from 'react'
import { MAX_TEXT_FILE_LABEL } from '@shared/types'
import { tabKey, useWorkspace, type OpenedFile } from '@renderer/state/store'
import { useSettings } from '@renderer/state/settings'
import { formattableParser, formatText } from '@renderer/lib/formatter'
import { isVirtualTab, noteTabPath, parseTabPath } from '@renderer/lib/tab-uri'
import { BoardTab } from '../board/board-tab'
import { NotesTab } from '../board/notes-tab'
import { MonacoEditor, gcMonacoModels } from './monaco-editor'
import { MarkdownPreview } from './markdown-preview'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'])
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

  // Load content for any tab still in 'loading' state. Board and note tabs have
  // no file behind them, so they never enter this path.
  useEffect(() => {
    for (const file of projectTabs) {
      if (isVirtualTab(file.path)) continue
      const state = fileStates[tabKey(file)]
      if (state?.kind !== 'loading') continue
      const ext = extOf(file.path)
      if (IMAGE_EXTS.has(ext)) {
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
          <TabPane file={activeFile} projectId={projectId} onSave={save} onChange={setFileContent} />
        ) : (
          <div className="text-[12px] text-foreground/40 p-4">No file selected.</div>
        )}
      </div>
    </div>
  )
}

/**
 * Route a tab to its surface. Board and note tabs share the file tab strip via a
 * reserved `wterm://` path (see lib/tab-uri.ts) but have no file behind them.
 */
function TabPane({
  file,
  projectId,
  onSave,
  onChange,
}: {
  file: OpenedFile
  projectId: string
  onSave: (file: OpenedFile, text: string) => Promise<void>
  onChange: (file: OpenedFile, content: string) => void
}) {
  const openFile = useWorkspace((s) => s.openFile)
  const target = parseTabPath(file.path)

  if (target.kind === 'board') return <BoardTab projectId={projectId} />
  if (target.kind === 'note') {
    return (
      <NotesTab
        projectId={projectId}
        noteId={target.noteId}
        onOpenNote={(noteId) => openFile({ projectId, path: noteTabPath(noteId) })}
      />
    )
  }
  return <EditorPane file={file} onSave={onSave} onChange={onChange} />
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
