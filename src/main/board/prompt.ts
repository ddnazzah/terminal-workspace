// Rendering a card into the startup command that launches its worker.

import { DEFAULT_BOARD_SETTINGS } from '@shared/types'

export interface PromptVars {
  number: number
  title: string
  /** project-relative path of the card markdown file written into the worktree */
  cardFile: string
  branch: string
}

/**
 * Substitute `{{name}}` placeholders. Unknown placeholders are left verbatim
 * rather than becoming "undefined", so a typo in a user template is visible.
 */
export function renderPrompt(template: string, vars: PromptVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = (vars as unknown as Record<string, unknown>)[key]
    return value === undefined ? match : String(value)
  })
}

/**
 * Escape a string for embedding in a double-quoted shell word. Backslash first,
 * then the characters the shell still expands inside double quotes — a card body
 * is arbitrary user text and must never reach the shell as code.
 */
function shellQuote(value: string): string {
  return `"${value.replace(/[\\"$`]/g, (ch) => `\\${ch}`)}"`
}

/**
 * The command a dispatched worker tab runs. The prompt references the card's
 * markdown *file* rather than inlining the body, which keeps arbitrary markdown
 * out of the command line entirely.
 */
export function buildStartupCommand(
  agentCommand: string,
  template: string,
  vars: PromptVars
): string {
  const agent = agentCommand.trim() || DEFAULT_BOARD_SETTINGS.agentCommand
  return `${agent} ${shellQuote(renderPrompt(template, vars))}`
}
