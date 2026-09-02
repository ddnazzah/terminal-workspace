import { useEffect, useRef } from 'react'
import { useWorkspace } from '@renderer/state/store'
import { monaco, ensureThemes } from '@renderer/lib/monaco-setup'
import { languageForFilename } from '@renderer/lib/monaco-language'
import { useTheme } from '@renderer/lib/theme'
import { useSettings, type EditorSettings } from '@renderer/state/settings'

interface Props {
  /** Stable per-file key (tabKey). */
  fileKey: string
  filename: string
  initialContent: string
  onChange: (text: string) => void
  onSave: (text: string) => void
  format?: (text: string) => Promise<string | null>
  readOnly?: boolean
}

// One model per fileKey so undo history + view state survive remounts/mode switches.
const models = new Map<string, monaco.editor.ITextModel>()
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

function modelFor(fileKey: string, filename: string, content: string): monaco.editor.ITextModel {
  let m = models.get(fileKey)
  if (!m || m.isDisposed()) {
    const lang = languageForFilename(filename)
    const uri = monaco.Uri.parse(`inmemory://file/${encodeURIComponent(fileKey)}`)
    m = monaco.editor.createModel(content, lang, uri)
    models.set(fileKey, m)
  }
  return m
}

// Keys whose model is currently set on a mounted editor. Guards against GC
// disposing a model the editor still holds (e.g. mid-remount on a mode switch).
const attachedKeys = new Set<string>()

export function disposeMonacoModel(fileKey: string): void {
  models.get(fileKey)?.dispose()
  models.delete(fileKey)
  viewStates.delete(fileKey)
}

/** Dispose models whose fileKey is no longer open and not attached to an editor. */
export function gcMonacoModels(liveKeys: Set<string>): void {
  for (const key of models.keys()) {
    if (!liveKeys.has(key) && !attachedKeys.has(key)) disposeMonacoModel(key)
  }
}

function optionsFrom(s: EditorSettings): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    fontSize: s.fontSize,
    fontFamily: s.fontFamily,
    tabSize: s.tabSize,
    insertSpaces: s.insertSpaces,
    wordWrap: s.wordWrap ? 'on' : 'off',
    lineNumbers: s.lineNumbers ? 'on' : 'off',
    minimap: { enabled: s.minimap },
    automaticLayout: true,
    scrollBeyondLastLine: false,

    // Defaults lifted from VS Code's own editor config so the editing surface
    // behaves like the real thing rather than bare Monaco. Sources:
    //   src/vs/editor/common/config/editorOptions.ts
    //   src/vs/editor/common/core/misc/textModelDefaults.ts

    // EditorStickyScroll defaults: enabled, maxLineCount 5, scrollWithEditor.
    stickyScroll: { enabled: true, maxLineCount: 5, scrollWithEditor: true },

    // EDITOR_MODEL_DEFAULTS.bracketPairColorizationOptions.
    bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: false },

    // InternalGuidesOptions defaults — note bracketPairs is off but the ACTIVE
    // pair is still highlighted, which is what makes nesting readable without
    // the full rainbow of guides.
    guides: {
      bracketPairs: false,
      bracketPairsHorizontal: 'active',
      highlightActiveBracketPair: true,
      indentation: true,
      highlightActiveIndentation: true,
    },

    // detectIndentation is on in VS Code, so a file that uses tabs keeps them
    // regardless of the configured default.
    detectIndentation: true,
    trimAutoWhitespace: true,
    largeFileOptimizations: true,
  }
}

export function MonacoEditor({ fileKey, filename, initialContent, onChange, onSave, format, readOnly }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const currentKeyRef = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const formatRef = useRef(format)
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    formatRef.current = format
  })

  const settings = useSettings((s) => s.editor)
  const { theme } = useTheme()

  // Create the editor once (recreate only when readOnly flips).
  useEffect(() => {
    if (!hostRef.current) return
    ensureThemes()
    const editor = monaco.editor.create(hostRef.current, {
      ...optionsFrom(useSettings.getState().editor),
      theme: 'wterm-dark',
      readOnly,
    })
    editorRef.current = editor
    const sub = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const run = (text: string) => onSaveRef.current(text)
      const fmt = formatRef.current
      if (fmt) {
        void fmt(editor.getValue()).then((f) => {
          const model = editor.getModel()
          if (f && model && f !== model.getValue()) {
            // Replace via executeEdits (not setValue) to preserve undo history + cursor.
            editor.executeEdits('format', [{ range: model.getFullModelRange(), text: f }])
            editor.pushUndoStop()
          }
          run(editor.getValue())
        })
      } else {
        run(editor.getValue())
      }
    })
    return () => {
      sub.dispose()
      // Save before disposing, not only on the fileKey swap above: the editor
      // is now unmounted whenever a tab flips to its Changes pane, and losing
      // the cursor and scroll position on every toggle is jarring.
      if (currentKeyRef.current) {
        viewStates.set(currentKeyRef.current, editor.saveViewState())
        attachedKeys.delete(currentKeyRef.current)
      }
      editor.dispose()
      editorRef.current = null
      currentKeyRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  // Swap model when the open file changes, preserving view state. Depends only on
  // fileKey so it does NOT re-run on every keystroke (initialContent/filename are
  // read only when the model is first created).
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const prevKey = currentKeyRef.current
    if (prevKey && prevKey !== fileKey) {
      viewStates.set(prevKey, editor.saveViewState())
      attachedKeys.delete(prevKey)
    }
    const model = modelFor(fileKey, filename, initialContent)
    if (editor.getModel() !== model) editor.setModel(model)
    const vs = viewStates.get(fileKey)
    if (vs) editor.restoreViewState(vs)
    currentKeyRef.current = fileKey
    attachedKeys.add(fileKey)
    editor.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey])

  // React to settings changes without recreating the editor.
  useEffect(() => {
    editorRef.current?.updateOptions(optionsFrom(settings))
  }, [settings])

  // Apply a pending reveal — quick-open's `:line`, or a search result being
  // opened at its match — then clear it so a repeat jump to the same line
  // fires again.
  const pendingReveal = useWorkspace((s) => s.pendingReveal)
  const clearPendingReveal = useWorkspace((s) => s.clearPendingReveal)
  useEffect(() => {
    const editor = editorRef.current
    if (!pendingReveal || !editor) return

    // A reveal aimed at a specific file must wait for THAT file's editor.
    // Opening a search result sets the reveal before the new tab has mounted,
    // so without this the still-visible previous file would scroll instead.
    if (pendingReveal.fileKey && pendingReveal.fileKey !== fileKey) return

    const model = editor.getModel()
    if (!model) return

    // Clamp: the file may be shorter than the requested line.
    const line = Math.min(pendingReveal.line, model.getLineCount())
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: pendingReveal.column })
    editor.focus()
    clearPendingReveal()
    // fileKey is a dependency so the reveal is retried once the target file's
    // editor has actually mounted its model.
  }, [pendingReveal, clearPendingReveal, fileKey])

  // React to theme changes.
  useEffect(() => {
    monaco.editor.setTheme('wterm-dark')
    void theme
  }, [theme])

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />
}
