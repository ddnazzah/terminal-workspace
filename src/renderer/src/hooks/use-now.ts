import { useEffect, useState } from 'react'

/**
 * A clock that ticks on an interval, for UI that ages — "waiting for 6 minutes"
 * has to become true without anything else changing. Coarse on purpose: nothing
 * here is worth a per-second re-render of every terminal row.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
