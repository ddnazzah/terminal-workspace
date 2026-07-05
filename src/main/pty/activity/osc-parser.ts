import type { OscEvent } from './types'

const OSC_START = '\x1b]'
const BEL = '\x07'
// Cap the retained tail: the longest thing we ever need to hold is a partial
// OSC sequence. Titles can be long, but we don't need giant ones — 4 KiB is
// plenty and bounds memory if a stream never terminates a sequence.
const MAX_PENDING = 4096

/** Parse one OSC body (the text between `\x1b]` and the terminator). */
function parseBody(body: string): OscEvent | null {
  // 133;C | 133;D[;code]
  if (body === '133;C') return { kind: 'commandStart' }
  if (body === '133;D') return { kind: 'commandEnd', exitCode: null }
  if (body.startsWith('133;D;')) {
    const n = Number.parseInt(body.slice('133;D;'.length), 10)
    return { kind: 'commandEnd', exitCode: Number.isFinite(n) ? n : null }
  }
  // 9;4;state;pct → busy while state is 1 (normal) or 2 (error/indeterminate)
  if (body.startsWith('9;4;')) {
    const state = body.split(';')[2]
    return { kind: 'progress', active: state === '1' || state === '2' }
  }
  // 0;title | 2;title
  if (body.startsWith('0;') || body.startsWith('2;')) {
    return { kind: 'title', text: body.slice(2) }
  }
  return null
}

export class OscParser {
  private pending = ''

  push(chunk: string): OscEvent[] {
    const events: OscEvent[] = []
    let buf = this.pending + chunk
    this.pending = ''

    for (;;) {
      const start = buf.indexOf(OSC_START)
      if (start === -1) {
        // No OSC opener. Keep only a short tail in case `\x1b` arrives split.
        this.pending = buf.slice(-1) === '\x1b' ? '\x1b' : ''
        break
      }
      const bodyStart = start + OSC_START.length
      // Find the terminator: BEL or ESC-backslash (ST).
      const bel = buf.indexOf(BEL, bodyStart)
      const st = buf.indexOf('\x1b\\', bodyStart)
      let end = -1
      let termLen = 0
      if (bel !== -1 && (st === -1 || bel < st)) {
        end = bel
        termLen = 1
      } else if (st !== -1) {
        end = st
        termLen = 2
      }
      if (end === -1) {
        // Incomplete OSC — retain from the opener, capped.
        buf = buf.slice(start)
        this.pending = buf.length > MAX_PENDING ? buf.slice(-MAX_PENDING) : buf
        break
      }
      const body = buf.slice(bodyStart, end)
      const event = parseBody(body)
      if (event) events.push(event)
      buf = buf.slice(end + termLen)
    }
    return events
  }
}
