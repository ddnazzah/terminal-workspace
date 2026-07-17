export interface FuzzyResult {
  score: number
  /** Indices in the target string that matched, in order. */
  matchedIndices: number[]
}

const START_BONUS = 8
const BOUNDARY_BONUS = 10
const CONSECUTIVE_BONUS = 12
const EARLINESS_WEIGHT = 0.1

function isBoundary(target: string, index: number): boolean {
  if (index === 0) return true
  const prev = target[index - 1]!
  if (prev === '/' || prev === '_' || prev === '-' || prev === '.' || prev === ' ') return true
  // camelCase boundary: previous char lower, current char upper
  const cur = target[index]!
  return prev.toLowerCase() === prev && cur.toUpperCase() === cur && cur.toLowerCase() !== cur
}

/**
 * Greedy case-insensitive subsequence match. Every char of `query` must appear
 * in `target` in order or the result is null. Score rewards matches at word
 * boundaries, consecutive runs, and matches that start early in the target.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (query === '') return { score: 0, matchedIndices: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  const matchedIndices: number[] = []
  let score = 0
  let qi = 0
  let prevMatch = -2

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue
    let charScore = 1
    if (ti === 0) charScore += START_BONUS
    if (isBoundary(target, ti)) charScore += BOUNDARY_BONUS
    if (ti === prevMatch + 1) charScore += CONSECUTIVE_BONUS
    score += charScore
    matchedIndices.push(ti)
    prevMatch = ti
    qi++
  }

  if (qi < q.length) return null
  score -= matchedIndices[0]! * EARLINESS_WEIGHT
  return { score, matchedIndices }
}
