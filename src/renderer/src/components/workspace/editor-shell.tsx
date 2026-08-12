import { useWorkspace } from '@renderer/state/store'
import { EditorChrome } from './editor-chrome'
import { FileTabs } from './file-tabs'
import { Breadcrumbs } from './breadcrumbs'
import { FileViewer } from './file-viewer'

interface Props {
  projectId: string
  onClose: () => void
}

export function EditorShell({ projectId, onClose }: Props) {
  const viewMode = useWorkspace((s) => s.editorViewMode)
  return (
    <div
      data-editor-surface
      className="flex flex-col h-full w-full min-h-0 bg-surface overflow-hidden"
    >
      {/* One unified toolbar: tabs (with the filename) on the left, view-mode
          switch + close on the right. No separate title row, so the filename
          is never shown twice. */}
      <div
        className={[
          'flex items-stretch h-9 border-b border-accent/14 bg-surface/80 flex-shrink-0',
          // In fullscreen the toolbar sits at the window's top edge — leave room
          // for the macOS traffic lights at top-left.
          viewMode === 'fullscreen' ? 'pl-[76px]' : '',
        ].join(' ')}
      >
        <div className="flex-1 min-w-0 overflow-hidden">
          <FileTabs projectId={projectId} />
        </div>
        <EditorChrome onClose={onClose} />
      </div>
      <Breadcrumbs projectId={projectId} />
      <div className="flex-1 min-h-0">
        <FileViewer projectId={projectId} />
      </div>
    </div>
  )
}
