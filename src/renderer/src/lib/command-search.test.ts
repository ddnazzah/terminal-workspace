import { describe, expect, test } from 'vitest'
import { rankCommands, type CommandDescriptor } from './command-search'

const commands: CommandDescriptor[] = [
  { id: 'workbench.toggleSidebar', category: 'View', title: 'Toggle Primary Side Bar' },
  { id: 'workbench.togglePanel', category: 'View', title: 'Toggle Panel' },
  { id: 'terminal.new', category: 'Terminal', title: 'Create New Terminal' },
  { id: 'workbench.openSettings', category: 'Preferences', title: 'Open Settings' },
]

describe('rankCommands', () => {
  test('returns everything, alphabetically, for an empty query', () => {
    const ranked = rankCommands('', commands)

    expect(ranked).toHaveLength(4)
    expect(ranked.map((r) => r.command.title)).toEqual([
      'Create New Terminal',
      'Open Settings',
      'Toggle Panel',
      'Toggle Primary Side Bar',
    ])
  })

  test('filters to matches on the title', () => {
    expect(rankCommands('panel', commands).map((r) => r.command.id)).toEqual([
      'workbench.togglePanel',
    ])
  })

  test('matches on the category too, so "terminal" finds its commands', () => {
    expect(rankCommands('terminal', commands).map((r) => r.command.id)).toContain('terminal.new')
  })

  test('matches a subsequence, not just a substring', () => {
    // "tps" -> Toggle Primary Side Bar
    expect(rankCommands('tps', commands).map((r) => r.command.id)).toContain(
      'workbench.toggleSidebar'
    )
  })

  test('ranks a title match above a category-only match', () => {
    // "Open Settings" matches on title; "Preferences" would only match the
    // category. The title hit must come first.
    const withDecoy: CommandDescriptor[] = [
      { id: 'x.open', category: 'Open', title: 'Something Else' },
      { id: 'prefs.open', category: 'Preferences', title: 'Open Settings' },
    ]

    expect(rankCommands('open settings', withDecoy)[0].command.id).toBe('prefs.open')
  })

  test('is case insensitive', () => {
    expect(rankCommands('PANEL', commands).map((r) => r.command.id)).toEqual([
      'workbench.togglePanel',
    ])
  })

  test('returns nothing when no command matches', () => {
    expect(rankCommands('zzzz', commands)).toEqual([])
  })

  test('reports which title characters matched so they can be highlighted', () => {
    const [hit] = rankCommands('panel', commands)

    expect(hit.titleIndices.length).toBeGreaterThan(0)
    const matched = hit.titleIndices.map((i) => hit.command.title[i]).join('').toLowerCase()
    expect(matched).toBe('panel')
  })

  test('ignores surrounding whitespace in the query', () => {
    expect(rankCommands('  panel  ', commands).map((r) => r.command.id)).toEqual([
      'workbench.togglePanel',
    ])
  })
})
