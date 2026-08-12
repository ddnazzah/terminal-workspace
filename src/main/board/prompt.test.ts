import { describe, expect, it } from 'vitest'
import { DEFAULT_PROMPT_TEMPLATE } from '@shared/types'
import { buildStartupCommand, renderPrompt } from './prompt'

const vars = { number: 42, title: 'Fix resize', cardFile: '.wterm/card-42.md', branch: 'card/42' }

describe('renderPrompt', () => {
  it('substitutes every placeholder', () => {
    const out = renderPrompt('#{{number}} {{title}} in {{cardFile}} on {{branch}}', vars)

    expect(out).toBe('#42 Fix resize in .wterm/card-42.md on card/42')
  })

  it('substitutes repeated placeholders', () => {
    expect(renderPrompt('{{number}}-{{number}}', vars)).toBe('42-42')
  })

  it('leaves unknown placeholders untouched rather than emitting undefined', () => {
    expect(renderPrompt('{{nope}}', vars)).toBe('{{nope}}')
  })
})

describe('buildStartupCommand', () => {
  it('quotes the rendered prompt as a single argument', () => {
    const cmd = buildStartupCommand('claude', DEFAULT_PROMPT_TEMPLATE, vars)

    expect(cmd).toBe(
      'claude "Read .wterm/card-42.md and implement the task described there. You are on branch card/42."'
    )
  })

  it('escapes double quotes and backslashes in the prompt', () => {
    const cmd = buildStartupCommand('claude', 'say "hi" \\ bye', vars)

    expect(cmd).toBe('claude "say \\"hi\\" \\\\ bye"')
  })

  it('escapes shell expansion characters so a card body cannot run commands', () => {
    const cmd = buildStartupCommand('claude', 'cost is $(rm -rf /) and `whoami` and $HOME', vars)

    expect(cmd).toBe('claude "cost is \\$(rm -rf /) and \\`whoami\\` and \\$HOME"')
  })

  it('falls back to the default agent command when none is configured', () => {
    expect(buildStartupCommand('  ', '{{number}}', vars)).toBe('claude "42"')
  })
})
