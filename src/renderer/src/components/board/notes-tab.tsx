import { useEffect, useRef, useState } from 'react'
import type { Note, ProjectId } from '@shared/types'
import { useBoard } from '@renderer/hooks/use-board'
import { MarkdownPreview } from '../workspace/markdown-preview'

interface Props {
  projectId: ProjectId
  /** Note to focus; null shows the list with nothing selected. */
  noteId: string | null
  onOpenNote: (noteId: string) => void
}

const AUTOSAVE_MS = 500

export function NotesTab({ projectId, noteId, onOpenNote }: Props) {
  const { snapshot, refresh } = useBoard(projectId)
  const [preview, setPreview] = useState(false)
  const note = snapshot.notes.find((n) => n.id === noteId) ?? null

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="w-[200px] flex-shrink-0 flex flex-col border-r border-accent/14">
        <div className="flex items-center h-9 px-2.5 flex-shrink-0 border-b border-accent/14">
          <span className="text-[11px] text-foreground/50">Notes</span>
          <button
            type="button"
            aria-label="New note"
            onClick={() => {
              void window.api.board.createNote(projectId).then((created) => {
                refresh()
                if (created) onOpenNote(created.id)
              })
            }}
            className="ml-auto w-5 h-5 rounded text-foreground/40 hover:text-foreground hover:bg-foreground/10"
          >
            +
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col gap-1">
          {snapshot.notes.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onOpenNote(n.id)}
              className={[
                'text-left px-2 py-1.5 rounded text-[12px] truncate transition-colors',
                n.id === noteId
                  ? 'bg-foreground/10 text-foreground'
                  : 'text-foreground/65 hover:bg-foreground/5',
              ].join(' ')}
            >
              {n.title || 'Untitled note'}
            </button>
          ))}
          {snapshot.notes.length === 0 && (
            <p className="px-2 py-3 text-[11px] text-foreground/35">
              No notes yet. Jot something, then promote it to a card.
            </p>
          )}
        </div>
      </aside>

      {note ? (
        <NoteEditor
          key={note.id}
          note={note}
          isPreview={preview}
          onTogglePreview={() => setPreview((v) => !v)}
          onChanged={refresh}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-[12px] text-foreground/35">
          Select a note, or create one.
        </div>
      )}
    </div>
  )
}

interface EditorProps {
  note: Note
  isPreview: boolean
  onTogglePreview: () => void
  onChanged: () => void
}

function NoteEditor({ note, isPreview, onTogglePreview, onChanged }: EditorProps) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced autosave. Notes have no dirty-tab concept, so the save must not
  // depend on blur — closing the tab mid-typing still persists.
  useEffect(() => {
    if (title === note.title && body === note.body) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void window.api.board.updateNote(note.id, { title, body }).then(onChanged)
    }, AUTOSAVE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [title, body, note.id, note.title, note.body, onChanged])

  const promote = (): void => {
    void window.api.board.promoteNote(note.id).then(onChanged)
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-2 h-9 px-3 flex-shrink-0 border-b border-accent/14">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Note title"
          className="flex-1 min-w-0 bg-transparent text-[12px] text-foreground outline-none"
        />
        <button
          type="button"
          onClick={onTogglePreview}
          className="text-[11px] text-foreground/50 hover:text-foreground"
        >
          {isPreview ? 'Edit' : 'Preview'}
        </button>
        <button
          type="button"
          onClick={promote}
          title="Create a backlog card from this note"
          className="px-2 py-0.5 rounded bg-foreground/10 hover:bg-foreground/15 text-[11px]"
        >
          Make card
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {isPreview ? (
          <MarkdownPreview content={body} />
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Markdown."
            aria-label="Note body"
            className="w-full h-full bg-transparent px-3 py-2 text-[12px] font-mono text-foreground/85 outline-none resize-none"
          />
        )}
      </div>
    </div>
  )
}
