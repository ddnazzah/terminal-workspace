import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubSettings } from '@shared/types'

const SETTINGS: GitHubSettings = {
  clientId: 'Ov23example',
  hasToken: true,
  login: 'ddnazzah',
  source: 'device',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
}

function stubApi(getSettings: () => Promise<GitHubSettings>): void {
  vi.stubGlobal('window', { api: { github: { getSettings } } })
}

describe('useGithub', () => {
  // The store module is stateful; re-import per test for isolation.
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('starts with null settings', async () => {
    stubApi(vi.fn().mockResolvedValue(SETTINGS))
    const { useGithub } = await import('./github')

    expect(useGithub.getState().settings).toBeNull()
  })

  it('stores settings after refresh', async () => {
    stubApi(vi.fn().mockResolvedValue(SETTINGS))
    const { useGithub } = await import('./github')

    await useGithub.getState().refresh()

    expect(useGithub.getState().settings).toEqual(SETTINGS)
  })

  it('keeps the previous settings when refresh fails', async () => {
    const getSettings = vi
      .fn()
      .mockResolvedValueOnce(SETTINGS)
      .mockRejectedValueOnce(new Error('ipc down'))
    stubApi(getSettings)
    const { useGithub } = await import('./github')

    await useGithub.getState().refresh()
    await useGithub.getState().refresh()

    expect(useGithub.getState().settings).toEqual(SETTINGS)
  })
})
