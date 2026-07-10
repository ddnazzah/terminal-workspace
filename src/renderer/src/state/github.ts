import { create } from 'zustand'
import type { GitHubSettings } from '@shared/types'

interface GitHubState {
  /** null until the first refresh resolves. */
  settings: GitHubSettings | null
  /**
   * Re-fetch auth settings from main. Every auth mutation (sign in, sign out,
   * PAT/client-id save) funnels through this so all consumers stay in sync.
   * Keeps the last known value on failure.
   */
  refresh: () => Promise<void>
}

export const useGithub = create<GitHubState>((set) => ({
  settings: null,
  refresh: async () => {
    try {
      const settings = await window.api.github.getSettings()
      set({ settings })
    } catch (err) {
      console.error('[github] failed to load settings:', err)
    }
  },
}))
