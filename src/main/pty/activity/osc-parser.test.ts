import { describe, expect, it } from 'vitest'
import { OscParser } from './osc-parser'
import type { OscEvent } from './types'

function feedAll(chunks: string[]): OscEvent[] {
  const p = new OscParser()
  const out: OscEvent[] = []
  for (const c of chunks) out.push(...p.push(c))
  return out
}

const BEL = '\x07'
const OSC = '\x1b]'

describe('OscParser', () => {
  it('parses command start / end with exit code (BEL-terminated)', () => {
    expect(feedAll([`${OSC}133;C${BEL}`])).toEqual([{ kind: 'commandStart' }])
    expect(feedAll([`${OSC}133;D;0${BEL}`])).toEqual([{ kind: 'commandEnd', exitCode: 0 }])
    expect(feedAll([`${OSC}133;D;130${BEL}`])).toEqual([{ kind: 'commandEnd', exitCode: 130 }])
  })

  it('parses command end with no code as null', () => {
    expect(feedAll([`${OSC}133;D${BEL}`])).toEqual([{ kind: 'commandEnd', exitCode: null }])
  })

  it('accepts ESC-backslash (ST) terminator', () => {
    expect(feedAll([`${OSC}133;C\x1b\\`])).toEqual([{ kind: 'commandStart' }])
  })

  it('parses titles from OSC 0 and OSC 2', () => {
    expect(feedAll([`${OSC}0;hello${BEL}`])).toEqual([{ kind: 'title', text: 'hello' }])
    expect(feedAll([`${OSC}2;✳ Claude Code${BEL}`])).toEqual([
      { kind: 'title', text: '✳ Claude Code' },
    ])
  })

  it('parses OSC 9;4 progress active vs inactive', () => {
    expect(feedAll([`${OSC}9;4;1;40${BEL}`])).toEqual([{ kind: 'progress', active: true }])
    expect(feedAll([`${OSC}9;4;0;0${BEL}`])).toEqual([{ kind: 'progress', active: false }])
  })

  it('reassembles a sequence split across chunks', () => {
    expect(feedAll([`${OSC}13`, `3;D;`, `0${BEL}`])).toEqual([{ kind: 'commandEnd', exitCode: 0 }])
  })

  it('ignores plain text and unrelated OSC', () => {
    expect(feedAll(['just some output\n', `${OSC}7;file:///x${BEL}`, 'more'])).toEqual([])
  })

  it('does not grow unbounded on an unterminated OSC', () => {
    const p = new OscParser()
    for (let i = 0; i < 1000; i++) p.push(`${OSC}133;C`.repeat(50)) // never terminated
    // A well-formed sequence still parses afterward.
    expect(p.push(`${BEL}${OSC}133;D;0${BEL}`)).toContainEqual({
      kind: 'commandEnd',
      exitCode: 0,
    })
  })
})
