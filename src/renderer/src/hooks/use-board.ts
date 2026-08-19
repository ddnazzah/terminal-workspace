import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_BOARD_SETTINGS, type BoardSnapshot, type ProjectId } from '@shared/types'

const EMPTY: BoardSnapshot = { cards: [], notes: [], settings: DEFAULT_BOARD_SETTINGS }

/**
 * The board's read model. Main owns board state (the scheduler mutates it with
 * no renderer involvement), so this re-reads the snapshot on every `board:changed`
 * push rather than mirroring it locally.
 */
export function useBoard(projectId: ProjectId | null): {
  snapshot: BoardSnapshot
  refresh: () => void
} {
  const [snapshot, setSnapshot] = useState<BoardSnapshot>(EMPTY)

  const refresh = useCallback(() => {
    if (!projectId) {
      setSnapshot(EMPTY)
      return
    }
    window.api.board
      .snapshot(projectId)
      .then(setSnapshot)
      .catch((err: unknown) => {
        console.error('[board] snapshot failed:', err)
        setSnapshot(EMPTY)
      })
  }, [projectId])

  useEffect(() => {
    refresh()
    return window.api.board.onChanged(refresh)
  }, [refresh])

  return { snapshot, refresh }
}
