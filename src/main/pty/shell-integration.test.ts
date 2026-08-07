import { existsSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { prepareShellIntegration } from './shell-integration'

const HOME = '/home/test'
const baseEnv = { HOME }

describe('prepareShellIntegration (zsh)', () => {
  test('points ZDOTDIR at a wrapper dir containing .zshenv and .zshrc', () => {
    const { env } = prepareShellIntegration('/bin/zsh', baseEnv)

    expect(env.ZDOTDIR).toBeTruthy()
    expect(env._TW_USER_ZDOTDIR).toBe(HOME)
    expect(existsSync(join(env.ZDOTDIR, '.zshenv'))).toBe(true)
    expect(existsSync(join(env.ZDOTDIR, '.zshrc'))).toBe(true)
    expect(readFileSync(join(env.ZDOTDIR, '.zshrc'), 'utf8')).toContain('__tw_preexec')
  })

  test('recreates wrapper files deleted between spawns (macOS tmp purge)', () => {
    const first = prepareShellIntegration('/bin/zsh', baseEnv)
    unlinkSync(join(first.env.ZDOTDIR, '.zshenv'))
    unlinkSync(join(first.env.ZDOTDIR, '.zshrc'))

    const second = prepareShellIntegration('/bin/zsh', baseEnv)

    expect(existsSync(join(second.env.ZDOTDIR, '.zshenv'))).toBe(true)
    expect(existsSync(join(second.env.ZDOTDIR, '.zshrc'))).toBe(true)
  })

  test('recreates the wrapper when the whole dir was deleted', () => {
    const first = prepareShellIntegration('/bin/zsh', baseEnv)
    rmSync(first.env.ZDOTDIR, { recursive: true, force: true })

    const second = prepareShellIntegration('/bin/zsh', baseEnv)

    expect(existsSync(join(second.env.ZDOTDIR, '.zshrc'))).toBe(true)
  })
})

describe('prepareShellIntegration (bash)', () => {
  test('recreates the rcfile deleted between spawns', () => {
    const first = prepareShellIntegration('/bin/bash', baseEnv)
    const rcPath = first.args[first.args.indexOf('--rcfile') + 1]
    expect(existsSync(rcPath)).toBe(true)
    unlinkSync(rcPath)

    const second = prepareShellIntegration('/bin/bash', baseEnv)
    const rcPath2 = second.args[second.args.indexOf('--rcfile') + 1]

    expect(existsSync(rcPath2)).toBe(true)
  })
})

describe('prepareShellIntegration (fish)', () => {
  test('recreates the init file deleted between spawns', () => {
    const first = prepareShellIntegration('/usr/local/bin/fish', baseEnv)
    const confPath = first.args[first.args.indexOf('--init-command') + 1].replace(/^source /, '')
    expect(existsSync(confPath)).toBe(true)
    unlinkSync(confPath)

    const second = prepareShellIntegration('/usr/local/bin/fish', baseEnv)
    const confPath2 = second.args[second.args.indexOf('--init-command') + 1].replace(/^source /, '')

    expect(existsSync(confPath2)).toBe(true)
  })
})

describe('prepareShellIntegration (zsh) — inherited ZDOTDIR', () => {
  test('ignores an inherited ZDOTDIR that is one of our own wrapper dirs', () => {
    // Launching wTerm from inside a wTerm tab leaks that tab's ZDOTDIR into
    // process.env. Treating it as "the user's" makes the new wrapper source the
    // OLD wrapper's .zshrc instead of ~/.zshrc — and once $TMPDIR purges that
    // old dir, the shell boots with no user config at all.
    const first = prepareShellIntegration('/bin/zsh', { HOME })

    const nested = prepareShellIntegration('/bin/zsh', {
      HOME,
      ZDOTDIR: first.env.ZDOTDIR,
    })

    expect(nested.env._TW_USER_ZDOTDIR).toBe(HOME)
    expect(nested.env._TW_USER_ZDOTDIR).not.toBe(first.env.ZDOTDIR)
  })

  test('still honours a genuine user ZDOTDIR', () => {
    const { env } = prepareShellIntegration('/bin/zsh', {
      HOME,
      ZDOTDIR: '/home/test/.config/zsh',
    })

    expect(env._TW_USER_ZDOTDIR).toBe('/home/test/.config/zsh')
  })

  test('prefers an already-captured _TW_USER_ZDOTDIR over a wrapper ZDOTDIR', () => {
    // Two levels of nesting: the original user dir was captured on the first
    // hop, so it must survive rather than being lost to the wrapper path.
    const first = prepareShellIntegration('/bin/zsh', { HOME })

    const nested = prepareShellIntegration('/bin/zsh', {
      HOME,
      ZDOTDIR: first.env.ZDOTDIR,
      _TW_USER_ZDOTDIR: '/home/test/.config/zsh',
    })

    expect(nested.env._TW_USER_ZDOTDIR).toBe('/home/test/.config/zsh')
  })

  test('falls back to HOME when the inherited ZDOTDIR is a wrapper and HOME is all we have', () => {
    const first = prepareShellIntegration('/bin/zsh', { HOME })

    const nested = prepareShellIntegration('/bin/zsh', { HOME, ZDOTDIR: first.env.ZDOTDIR })

    expect(nested.env._TW_USER_ZDOTDIR).toBe(HOME)
  })
})
